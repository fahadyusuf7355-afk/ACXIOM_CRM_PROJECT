const mongoose = require('mongoose');
const { Customer, Lead, Opportunity, FollowUp, AuditLog, User, Role } = require('../models');
const customerService = require('./customerService');
const leadService = require('./leadService');
const opportunityService = require('./opportunityService');
const followUpService = require('./followUpService');
const { scopeFilter, scopeUserIds } = require('./scopeService');
const { parseListQuery, pageMeta, resolveRange, dateFilter, isValidId, escapeRegex } = require('../utils/helpers');
const { toCustomerDTO, toLeadDTO, toOpportunityDTO, toFollowUpDTO, toAuditDTO } = require('../dtos');
const { LEAD_STATUSES, OPPORTUNITY_STAGES, FOLLOWUP_STATUSES } = require('../config/constants');

const EXPORT_LIMIT = 10000;
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** Runs a paginated (or full, for export) query and maps rows through a DTO. */
async function run(model, filter, populate, q, sortable, defaultSort, mapper, exportAll) {
  const { page, limit, skip, sort } = parseListQuery(q, sortable, defaultSort);
  const query = model.find(filter).populate(populate).sort(sort);
  const [docs, total] = await Promise.all([
    exportAll ? query.limit(EXPORT_LIMIT) : query.skip(skip).limit(limit),
    model.countDocuments(filter)
  ]);
  return { rows: docs.map((d) => mapper(d)), meta: pageMeta(page, limit, total) };
}

// ---------------- 1. Customer Report ----------------
async function customers(user, q, exportAll) {
  const filter = await customerService.buildFilter(user, q);
  const data = await run(Customer, filter, [{ path: 'owner', select: 'name' }], q,
    ['customerCode', 'customerName', 'status', 'createdDate', 'city'], '-createdDate', (c) => toCustomerDTO(c), exportAll);
  const byStatus = await Customer.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  return {
    ...data,
    summary: { total: data.meta.total, byStatus: byStatus.map((s) => ({ label: s._id, count: s.count })) },
    columns: [
      { key: 'customerCode', label: 'Code' }, { key: 'customerName', label: 'Customer' }, { key: 'companyName', label: 'Company' },
      { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status' },
      { key: 'owner', label: 'Owner', value: (r) => r.owner?.name }, { key: 'createdDate', label: 'Created', value: (r) => fmtDate(r.createdDate) }
    ]
  };
}

// ---------------- 2. Lead Report ----------------
async function leads(user, q, exportAll) {
  const filter = await leadService.buildFilter(user, q);
  const data = await run(Lead, filter, [{ path: 'assignedTo', select: 'name' }], q,
    ['leadCode', 'leadName', 'source', 'status', 'expectedValue', 'createdDate'], '-createdDate', (l) => toLeadDTO(l), exportAll);
  const [bySource, byStatus] = await Promise.all([
    Lead.aggregate([{ $match: filter }, { $group: { _id: '$source', count: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'Converted'] }, 1, 0] } } } }, { $sort: { count: -1 } }]),
    Lead.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }])
  ]);
  const converted = byStatus.find((s) => s._id === 'Converted')?.count || 0;
  return {
    ...data,
    summary: {
      total: data.meta.total, converted,
      conversionRate: data.meta.total ? Math.round((converted / data.meta.total) * 1000) / 10 : 0,
      byStatus: LEAD_STATUSES.map((s) => ({ label: s, count: byStatus.find((x) => x._id === s)?.count || 0 })),
      bySource: bySource.map((s) => ({ label: s._id, count: s.count, converted: s.converted }))
    },
    columns: [
      { key: 'leadCode', label: 'Code' }, { key: 'leadName', label: 'Lead' }, { key: 'companyName', label: 'Company' },
      { key: 'source', label: 'Source' }, { key: 'status', label: 'Status' }, { key: 'priority', label: 'Priority' },
      { key: 'expectedValue', label: 'Expected Value' }, { key: 'assignedTo', label: 'Owner', value: (r) => r.assignedTo?.name },
      { key: 'converted', label: 'Converted On', value: (r) => fmtDate(r.conversion?.convertedAt) },
      { key: 'createdDate', label: 'Created', value: (r) => fmtDate(r.createdDate) }
    ]
  };
}

// ---------------- 3. Follow-Up Report ----------------
async function followUps(user, q, exportAll) {
  const filter = await followUpService.buildFilter(user, q);
  const populate = [{ path: 'assignedTo', select: 'name' }, { path: 'customer', select: 'customerName' }, { path: 'lead', select: 'leadName' }, { path: 'opportunity', select: 'opportunityName' }];
  const data = await run(FollowUp, filter, populate, q, ['followUpDate', 'status', 'followUpType', 'subject'], '-followUpDate', (f) => toFollowUpDTO(f), exportAll);
  const now = new Date();
  const [byStatus, overdue] = await Promise.all([
    FollowUp.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    FollowUp.countDocuments({ ...filter, status: 'Planned', followUpDate: { ...(filter.followUpDate || {}), $lt: now } })
  ]);
  return {
    ...data,
    summary: { total: data.meta.total, overdue, byStatus: FOLLOWUP_STATUSES.map((s) => ({ label: s, count: byStatus.find((x) => x._id === s)?.count || 0 })) },
    columns: [
      { key: 'followUpDate', label: 'Date', value: (r) => fmtDate(r.followUpDate) }, { key: 'subject', label: 'Subject' },
      { key: 'followUpType', label: 'Type' }, { key: 'status', label: 'Status' },
      { key: 'isOverdue', label: 'Overdue', value: (r) => (r.isOverdue ? 'Yes' : 'No') },
      { key: 'related', label: 'Related To', value: (r) => `${r.relatedType}: ${r.relatedName || ''}` },
      { key: 'assignedTo', label: 'Owner', value: (r) => r.assignedTo?.name }
    ]
  };
}

// ---------------- 4. Opportunity Report ----------------
async function opportunities(user, q, exportAll) {
  const filter = await opportunityService.buildFilter(user, q);
  const populate = [{ path: 'customer', select: 'customerName customerCode' }, { path: 'assignedTo', select: 'name' }];
  const data = await run(Opportunity, filter, populate, q, ['opportunityName', 'stage', 'amount', 'probability', 'expectedCloseDate', 'createdDate'], 'expectedCloseDate', (o) => toOpportunityDTO(o), exportAll);
  const tot = await Opportunity.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amount' }, weighted: { $sum: { $divide: [{ $multiply: ['$amount', '$probability'] }, 100] } } } }]);
  return {
    ...data,
    summary: { total: data.meta.total, totalAmount: tot[0]?.amount || 0, weightedAmount: Math.round((tot[0]?.weighted || 0) * 100) / 100 },
    columns: [
      { key: 'opportunityCode', label: 'Code' }, { key: 'opportunityName', label: 'Opportunity' },
      { key: 'customer', label: 'Customer', value: (r) => r.customer?.name }, { key: 'stage', label: 'Stage' },
      { key: 'amount', label: 'Amount' }, { key: 'probability', label: 'Probability %' }, { key: 'weightedAmount', label: 'Weighted' },
      { key: 'expectedCloseDate', label: 'Expected Close', value: (r) => fmtDate(r.expectedCloseDate) },
      { key: 'assignedTo', label: 'Owner', value: (r) => r.assignedTo?.name }, { key: 'status', label: 'Status' }
    ]
  };
}

// ---------------- 5. Pipeline Report ----------------
async function pipeline(user, q) {
  const filter = await opportunityService.buildFilter(user, q);
  const weighted = { $sum: { $divide: [{ $multiply: ['$amount', '$probability'] }, 100] } };
  const [byStage, byOwnerRaw] = await Promise.all([
    Opportunity.aggregate([{ $match: filter }, { $group: { _id: '$stage', count: { $sum: 1 }, amount: { $sum: '$amount' }, weighted } }]),
    Opportunity.aggregate([{ $match: { ...filter, status: 'Open' } }, { $group: { _id: { owner: '$assignedTo', stage: '$stage' }, count: { $sum: 1 }, amount: { $sum: '$amount' }, weighted } }])
  ]);
  const ownerIds = [...new Set(byOwnerRaw.map((r) => String(r._id.owner)))];
  const owners = await User.find({ _id: { $in: ownerIds } }).select('name');
  const byOwner = owners.map((o) => {
    const rows = byOwnerRaw.filter((r) => String(r._id.owner) === String(o._id));
    const stages = {};
    ['Qualification', 'Proposal', 'Negotiation'].forEach((s) => { stages[s] = rows.find((r) => r._id.stage === s)?.amount || 0; });
    return {
      ownerId: o._id.toString(), owner: o.name, ...stages,
      count: rows.reduce((s, r) => s + r.count, 0),
      amount: rows.reduce((s, r) => s + r.amount, 0),
      weighted: Math.round(rows.reduce((s, r) => s + r.weighted, 0) * 100) / 100
    };
  }).sort((a, b) => b.amount - a.amount);
  const stageRows = OPPORTUNITY_STAGES.map((s) => {
    const r = byStage.find((x) => x._id === s);
    return { stage: s, count: r?.count || 0, amount: r?.amount || 0, weighted: Math.round((r?.weighted || 0) * 100) / 100 };
  });
  const open = stageRows.filter((r) => !['Won', 'Lost'].includes(r.stage));
  return {
    byStage: stageRows,
    byOwner,
    summary: {
      openAmount: open.reduce((s, r) => s + r.amount, 0),
      weightedPipeline: Math.round(open.reduce((s, r) => s + r.weighted, 0) * 100) / 100,
      openCount: open.reduce((s, r) => s + r.count, 0)
    },
    stageColumns: [{ key: 'stage', label: 'Stage' }, { key: 'count', label: 'Opportunities' }, { key: 'amount', label: 'Amount' }, { key: 'weighted', label: 'Weighted (Amount × Probability / 100)' }],
    ownerColumns: [{ key: 'owner', label: 'Owner' }, { key: 'Qualification', label: 'Qualification' }, { key: 'Proposal', label: 'Proposal' }, { key: 'Negotiation', label: 'Negotiation' }, { key: 'count', label: 'Open Count' }, { key: 'amount', label: 'Open Amount' }, { key: 'weighted', label: 'Weighted' }]
  };
}

// ---------------- 6. Sales / Conversion Report ----------------
async function conversion(user, q) {
  const range = resolveRange(q);
  const leadFilter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')), ...dateFilter('createdDate', range) };
  const oppFilter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')), ...dateFilter('createdDate', range) };
  const [leadByOwner, oppByOwner, leadBySource] = await Promise.all([
    Lead.aggregate([{ $match: leadFilter }, { $group: { _id: '$assignedTo', total: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'Converted'] }, 1, 0] } }, lost: { $sum: { $cond: [{ $in: ['$status', ['Lost', 'Unqualified']] }, 1, 0] } } } }]),
    Opportunity.aggregate([{ $match: oppFilter }, { $group: {
      _id: '$assignedTo', total: { $sum: 1 },
      won: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, 1, 0] } }, lost: { $sum: { $cond: [{ $eq: ['$status', 'Lost'] }, 1, 0] } },
      open: { $sum: { $cond: [{ $eq: ['$status', 'Open'] }, 1, 0] } }, wonAmount: { $sum: { $cond: [{ $eq: ['$status', 'Won'] }, '$amount', 0] } }
    } }]),
    Lead.aggregate([{ $match: leadFilter }, { $group: { _id: '$source', total: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'Converted'] }, 1, 0] } } } }, { $sort: { total: -1 } }])
  ]);
  const ownerIds = [...new Set([...leadByOwner, ...oppByOwner].map((r) => String(r._id)))];
  const owners = await User.find({ _id: { $in: ownerIds } }).select('name');
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const byOwner = owners.map((o) => {
    const l = leadByOwner.find((x) => String(x._id) === String(o._id)) || {};
    const p = oppByOwner.find((x) => String(x._id) === String(o._id)) || {};
    return {
      owner: o.name, leads: l.total || 0, converted: l.converted || 0, notConverted: (l.total || 0) - (l.converted || 0),
      conversionRate: pct(l.converted || 0, l.total || 0),
      opportunities: p.total || 0, won: p.won || 0, lost: p.lost || 0, open: p.open || 0,
      winRate: pct(p.won || 0, (p.won || 0) + (p.lost || 0)), wonAmount: p.wonAmount || 0
    };
  });
  const sum = (k) => byOwner.reduce((s, r) => s + r[k], 0);
  return {
    byOwner,
    bySource: leadBySource.map((s) => ({ source: s._id, leads: s.total, converted: s.converted, conversionRate: pct(s.converted, s.total) })),
    summary: {
      leads: sum('leads'), converted: sum('converted'), notConverted: sum('notConverted'), conversionRate: pct(sum('converted'), sum('leads')),
      opportunities: sum('opportunities'), won: sum('won'), lost: sum('lost'), open: sum('open'),
      winRate: pct(sum('won'), sum('won') + sum('lost')), wonAmount: sum('wonAmount')
    },
    columns: [
      { key: 'owner', label: 'Owner' }, { key: 'leads', label: 'Leads' }, { key: 'converted', label: 'Converted' }, { key: 'notConverted', label: 'Not Converted' },
      { key: 'conversionRate', label: 'Conversion %' }, { key: 'opportunities', label: 'Opportunities' }, { key: 'won', label: 'Won' },
      { key: 'lost', label: 'Lost' }, { key: 'winRate', label: 'Win %' }, { key: 'wonAmount', label: 'Won Amount' }
    ]
  };
}

// ---------------- 7. User Activity Report ----------------
async function userActivity(user, q) {
  const range = resolveRange(q);
  const ids = await scopeUserIds(user);
  const match = { user: { $ne: null }, ...dateFilter('createdDate', range) };
  if (ids) match.user = { $in: ids };
  if (q.userId && isValidId(q.userId)) {
    if (!ids || ids.some((i) => String(i) === q.userId)) match.user = new mongoose.Types.ObjectId(q.userId);
    else match.user = { $in: [] };
  }
  const rows = await AuditLog.aggregate([
    { $match: match },
    { $group: { _id: { user: '$user', action: '$action' }, count: { $sum: 1 }, last: { $max: '$createdDate' } } }
  ]);
  const userIds = [...new Set(rows.map((r) => String(r._id.user)))];
  const users = await User.find({ _id: { $in: userIds } }).populate('role').select('name username role');
  const actions = [...new Set(rows.map((r) => r._id.action))].sort();
  const data = users.map((u) => {
    const mine = rows.filter((r) => String(r._id.user) === String(u._id));
    const counts = Object.fromEntries(actions.map((a) => [a, mine.find((r) => r._id.action === a)?.count || 0]));
    return {
      userId: u._id.toString(), user: u.name, username: u.username, role: u.role?.roleName,
      total: mine.reduce((s, r) => s + r.count, 0),
      lastActivity: mine.reduce((m, r) => (r.last > m ? r.last : m), new Date(0)),
      ...counts
    };
  }).sort((a, b) => b.total - a.total);
  return {
    rows: data, actions,
    columns: [{ key: 'user', label: 'User' }, { key: 'role', label: 'Role' }, { key: 'total', label: 'Total Actions' },
      ...actions.map((a) => ({ key: a, label: a })), { key: 'lastActivity', label: 'Last Activity', value: (r) => fmtDate(r.lastActivity) }]
  };
}

// ---------------- 8. Audit Report / Audit Log ----------------
async function buildAuditFilter(q) {
  const filter = { ...dateFilter('createdDate', resolveRange(q.range ? q : { ...q, range: q.from || q.to ? 'custom' : undefined })) };
  if (q.userId && isValidId(q.userId)) filter.user = q.userId;
  if (q.user) filter.userName = new RegExp(escapeRegex(q.user), 'i');
  if (q.module) filter.entityName = String(q.module);
  if (q.action) filter.action = String(q.action);
  if (q.result) filter.result = String(q.result);
  if (q.recordId) filter.recordId = String(q.recordId);
  return filter;
}

async function audit(user, q, exportAll) {
  const filter = await buildAuditFilter(q);
  const data = await run(AuditLog, filter, [], q, ['createdDate', 'action', 'entityName', 'userName', 'result'], '-createdDate', toAuditDTO, exportAll);
  const [modules, actions] = await Promise.all([AuditLog.distinct('entityName'), AuditLog.distinct('action')]);
  return {
    ...data,
    filters: { modules: modules.sort(), actions: actions.sort() },
    columns: [
      { key: 'createdDate', label: 'Timestamp', value: (r) => new Date(r.createdDate).toISOString() }, { key: 'userName', label: 'User' },
      { key: 'action', label: 'Action' }, { key: 'entityName', label: 'Module' }, { key: 'recordId', label: 'Record Id' },
      { key: 'result', label: 'Result' }, { key: 'details', label: 'Details' }, { key: 'ipAddress', label: 'IP Address' },
      { key: 'oldValue', label: 'Old Value', value: (r) => (r.oldValue ? JSON.stringify(r.oldValue) : '') },
      { key: 'newValue', label: 'New Value', value: (r) => (r.newValue ? JSON.stringify(r.newValue) : '') }
    ]
  };
}

module.exports = { customers, leads, followUps, opportunities, pipeline, conversion, userActivity, audit, buildAuditFilter, Role };
