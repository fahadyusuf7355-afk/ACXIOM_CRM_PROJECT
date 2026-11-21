const { Customer, Lead, Opportunity, FollowUp, Activity, User, AuditLog } = require('../models');
const { scopeFilter, scopeUserIds } = require('./scopeService');
const { resolveRange, dateFilter, addDays, startOfToday } = require('../utils/helpers');
const { toFollowUpDTO, toActivityDTO, toAuditDTO } = require('../dtos');
const { LEAD_STATUSES, LEAD_OPEN_STATUSES, OPPORTUNITY_STAGES, ROLES } = require('../config/constants');
const config = require('../config');

const sumAmount = async (filter) => {
  const r = await Opportunity.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amount' }, weighted: { $sum: { $divide: [{ $multiply: ['$amount', '$probability'] }, 100] } } } }]);
  return { amount: r[0]?.amount || 0, weighted: Math.round((r[0]?.weighted || 0) * 100) / 100 };
};

/** Monthly won/lost outcome totals for the reporting period (default: last 12 months). */
async function monthlySales(oppScope, range) {
  const to = range.to || addDays(startOfToday(), 1);
  const from = range.from || new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth() + 1, 1));
  const rows = await Opportunity.aggregate([
    { $match: { ...oppScope, isDeleted: false, status: { $in: ['Won', 'Lost'] }, closedDate: { $gte: from, $lt: to } } },
    { $group: {
      _id: { month: { $dateToString: { format: '%Y-%m', date: '$closedDate', timezone: config.timezone } }, status: '$status' },
      amount: { $sum: '$amount' }, count: { $sum: 1 }
    } }
  ]);
  // Build a continuous month axis
  const months = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor < to && months.length < 36) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months.map((m) => {
    const won = rows.find((r) => r._id.month === m && r._id.status === 'Won');
    const lost = rows.find((r) => r._id.month === m && r._id.status === 'Lost');
    return { month: m, wonAmount: won?.amount || 0, wonCount: won?.count || 0, lostAmount: lost?.amount || 0, lostCount: lost?.count || 0 };
  });
}

async function getDashboard(user, q) {
  const range = resolveRange(q);
  const created = dateFilter('createdDate', range);
  const custScope = { isDeleted: false, ...(await scopeFilter(user, 'owner')) };
  const leadScope = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  const oppScope = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  const fuScope = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  const actScope = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  const now = new Date();

  const [
    totalCustomers, totalLeads, openLeads, totalOpps, openOpps, wonOpps, lostOpps,
    pipelineValue, wonValue, pendingFollowUps, overdueFollowUps,
    leadStatusRaw, pipelineRaw, monthly, upcoming, recentActivities
  ] = await Promise.all([
    Customer.countDocuments({ ...custScope, ...created }),
    Lead.countDocuments({ ...leadScope, ...created }),
    Lead.countDocuments({ ...leadScope, ...created, status: { $in: LEAD_OPEN_STATUSES } }),
    Opportunity.countDocuments({ ...oppScope, ...created }),
    Opportunity.countDocuments({ ...oppScope, ...created, status: 'Open' }),
    Opportunity.countDocuments({ ...oppScope, status: 'Won', ...dateFilter('closedDate', range) }),
    Opportunity.countDocuments({ ...oppScope, status: 'Lost', ...dateFilter('closedDate', range) }),
    sumAmount({ ...oppScope, ...created, status: 'Open' }),
    sumAmount({ ...oppScope, status: 'Won', ...dateFilter('closedDate', range) }),
    FollowUp.countDocuments({ ...fuScope, status: 'Planned', ...dateFilter('followUpDate', range) }),
    FollowUp.countDocuments({ ...fuScope, status: 'Planned', followUpDate: { $lt: now } }),
    Lead.aggregate([{ $match: { ...leadScope, ...created } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Opportunity.aggregate([{ $match: { ...oppScope, ...created } }, { $group: { _id: '$stage', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    monthlySales(oppScope, range),
    FollowUp.find({ ...fuScope, status: 'Planned', followUpDate: { $gte: startOfToday() } })
      .populate([{ path: 'assignedTo', select: 'name' }, { path: 'customer', select: 'customerName' }, { path: 'lead', select: 'leadName' }, { path: 'opportunity', select: 'opportunityName' }])
      .sort('followUpDate').limit(6),
    Activity.find(actScope).populate([{ path: 'assignedTo', select: 'name' }, { path: 'customer', select: 'customerName' }, { path: 'lead', select: 'leadName' }]).sort('-activityDate').limit(6)
  ]);

  const result = {
    role: user.role.roleName,
    scope: user.role.scope,
    range: { from: range.from || null, to: range.to || null },
    cards: {
      totalCustomers, totalLeads, openLeads,
      totalOpportunities: totalOpps, openOpportunities: openOpps, wonOpportunities: wonOpps, lostOpportunities: lostOpps,
      totalPipelineValue: pipelineValue.amount, weightedPipelineValue: pipelineValue.weighted, wonValue: wonValue.amount,
      pendingFollowUps, overdueFollowUps,
      winRate: wonOpps + lostOpps ? Math.round((wonOpps / (wonOpps + lostOpps)) * 1000) / 10 : 0
    },
    charts: {
      leadStatus: LEAD_STATUSES.map((s) => ({ status: s, count: leadStatusRaw.find((r) => r._id === s)?.count || 0 })),
      opportunityPipeline: OPPORTUNITY_STAGES.map((s) => {
        const r = pipelineRaw.find((x) => x._id === s);
        return { stage: s, count: r?.count || 0, amount: r?.amount || 0 };
      }),
      monthlySales: monthly
    },
    upcomingFollowUps: upcoming.map((f) => toFollowUpDTO(f)),
    recentActivities: recentActivities.map(toActivityDTO)
  };

  // Manager/Admin: team performance by owner
  if (user.role.roleName !== ROLES.SALES) {
    const ids = await scopeUserIds(user);
    const owners = await User.find(ids ? { _id: { $in: ids } } : { isActive: true }).populate('role').select('name role');
    const perf = await Opportunity.aggregate([
      { $match: { ...oppScope } },
      { $group: {
        _id: '$assignedTo',
        openAmount: { $sum: { $cond: [{ $eq: ['$status', 'Open'] }, '$amount', 0] } },
        wonAmount: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, '$amount', 0] } },
        open: { $sum: { $cond: [{ $eq: ['$status', 'Open'] }, 1, 0] } },
        won: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$status', 'Lost'] }, 1, 0] } }
      } }
    ]);
    const leadCounts = await Lead.aggregate([{ $match: leadScope }, { $group: { _id: '$assignedTo', leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'Converted'] }, 1, 0] } } } }]);
    result.teamPerformance = owners
      .filter((o) => o.role.roleName !== ROLES.ADMIN)
      .map((o) => {
        const p = perf.find((x) => String(x._id) === String(o._id)) || {};
        const l = leadCounts.find((x) => String(x._id) === String(o._id)) || {};
        return { userId: o._id.toString(), name: o.name, role: o.role.roleName, leads: l.leads || 0, convertedLeads: l.converted || 0, open: p.open || 0, won: p.won || 0, lost: p.lost || 0, openAmount: p.openAmount || 0, wonAmount: p.wonAmount || 0 };
      });
  }

  // Admin: user / security statistics
  if (user.role.roleName === ROLES.ADMIN) {
    const weekAgo = addDays(now, -7);
    const [totalUsers, activeUsers, lockedUsers, failedLogins, logins, recentAudit] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ lockoutEnd: { $gt: now } }),
      AuditLog.countDocuments({ action: { $in: ['LoginFailed', 'AccountLocked'] }, createdDate: { $gte: weekAgo } }),
      AuditLog.countDocuments({ action: 'Login', createdDate: { $gte: weekAgo } }),
      AuditLog.find().sort('-createdDate').limit(8)
    ]);
    result.security = { totalUsers, activeUsers, lockedUsers, failedLoginsLast7Days: failedLogins, loginsLast7Days: logins, recentAudit: recentAudit.map(toAuditDTO) };
  }
  return result;
}

module.exports = { getDashboard };
