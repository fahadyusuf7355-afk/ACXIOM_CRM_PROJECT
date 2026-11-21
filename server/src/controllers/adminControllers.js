const userService = require('../services/userService');
const roleService = require('../services/roleService');
const dashboardService = require('../services/dashboardService');
const reports = require('../services/reportService');
const audit = require('../services/auditService');
const { Customer, Lead, Opportunity } = require('../models');
const { scopeFilter } = require('../services/scopeService');
const { escapeRegex, toCsv } = require('../utils/helpers');
const { hasPermission } = require('../middleware/auth');
const AppError = require('../utils/AppError');
const C = require('../config/constants');
const config = require('../config');
const { toUserDTO, toRoleDTO } = require('../dtos');

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });

// ---------- Users ----------
exports.users = {
  list: async (req, res) => { const r = await userService.list(req.user, req.query); ok(res, r.items, { meta: r.meta }); },
  assignable: async (req, res) => ok(res, await userService.assignable(req.user)),
  get: async (req, res) => ok(res, toUserDTO(await userService.getById(req.user, req.params.id))),
  create: async (req, res) => res.status(201).json({ success: true, message: 'User created. They must change the password at first login.', data: toUserDTO(await userService.create(req.user, req.body, req)) }),
  update: async (req, res) => ok(res, toUserDTO(await userService.update(req.user, req.params.id, req.body, req)), { message: 'User updated successfully.' }),
  status: async (req, res) => ok(res, toUserDTO(await userService.setStatus(req.user, req.params.id, req.body.isActive, req)), { message: `User ${req.body.isActive ? 'activated' : 'deactivated'}.` }),
  resetPassword: async (req, res) => ok(res, toUserDTO(await userService.resetPassword(req.user, req.params.id, req.body.newPassword, req)), { message: 'Temporary password set. The user must change it at next login.' }),
  unlock: async (req, res) => ok(res, toUserDTO(await userService.unlock(req.user, req.params.id, req)), { message: 'Account unlocked.' })
};

// ---------- Roles & permissions ----------
exports.roles = {
  list: async (req, res) => ok(res, (await roleService.list()).map(toRoleDTO), { permissions: roleService.catalogue() }),
  updatePermissions: async (req, res) => ok(res, toRoleDTO(await roleService.updatePermissions(req.params.id, req.body.permissions, req)), { message: 'Permissions updated. Affected users get the new permissions on their next request.' })
};

// ---------- Dashboard / search / meta ----------
exports.dashboard = async (req, res) => ok(res, await dashboardService.getDashboard(req.user, req.query));

exports.search = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return ok(res, { customers: [], leads: [], opportunities: [] });
  const rx = new RegExp(escapeRegex(q), 'i');
  const u = req.user;
  const [customers, leads, opportunities] = await Promise.all([
    hasPermission(u, 'customers:read') ? Customer.find({ isDeleted: false, ...(await scopeFilter(u, 'owner')), $or: [{ customerName: rx }, { email: rx }, { phone: rx }, { companyName: rx }, { customerCode: rx }] }).limit(5) : [],
    hasPermission(u, 'leads:read') ? Lead.find({ isDeleted: false, ...(await scopeFilter(u, 'assignedTo')), $or: [{ leadName: rx }, { companyName: rx }, { email: rx }, { leadCode: rx }] }).limit(5) : [],
    hasPermission(u, 'opportunities:read') ? Opportunity.find({ isDeleted: false, ...(await scopeFilter(u, 'assignedTo')), $or: [{ opportunityName: rx }, { opportunityCode: rx }] }).limit(5) : []
  ]);
  ok(res, {
    customers: customers.map((c) => ({ id: c._id, title: c.customerName, subtitle: `${c.customerCode} · ${c.companyName || c.email}` })),
    leads: leads.map((l) => ({ id: l._id, title: l.leadName, subtitle: `${l.leadCode} · ${l.status}` })),
    opportunities: opportunities.map((o) => ({ id: o._id, title: o.opportunityName, subtitle: `${o.opportunityCode} · ${o.stage}` }))
  });
};

exports.meta = (req, res) => ok(res, {
  roles: Object.values(C.ROLES),
  customerStatuses: C.CUSTOMER_STATUSES,
  leadStatuses: C.LEAD_STATUSES, leadSources: C.LEAD_SOURCES, priorities: C.PRIORITIES, leadTransitions: C.LEAD_TRANSITIONS,
  opportunityStages: C.OPPORTUNITY_STAGES, opportunityStatuses: C.OPPORTUNITY_STATUSES, stageProbability: C.STAGE_DEFAULT_PROBABILITY,
  followUpStatuses: C.FOLLOWUP_STATUSES, followUpTypes: C.FOLLOWUP_TYPES, relatedTypes: C.RELATED_TYPES,
  activityTypes: C.ACTIVITY_TYPES, activityStatuses: C.ACTIVITY_STATUSES, auditActions: C.AUDIT_ACTIONS,
  limits: config.limits, phonePattern: config.phonePattern.source, timezone: config.timezone,
  passwordPolicy: { minLength: config.passwordPolicy.minLength, requireUppercase: true, requireLowercase: true, requireDigit: true, requireSpecial: true, historyCount: config.passwordPolicy.historyCount },
  lockout: config.lockout
});

// ---------- Audit log ----------
exports.auditLogs = async (req, res) => {
  const r = await reports.audit(req.user, req.query, false);
  ok(res, r.rows, { meta: r.meta, filters: r.filters });
};

// ---------- Reports ----------
const REPORTS = {
  customers: { perm: ['reports:view'], fn: reports.customers, paged: true, title: 'Customer Report' },
  leads: { perm: ['reports:view'], fn: reports.leads, paged: true, title: 'Lead Report' },
  followups: { perm: ['reports:view'], fn: reports.followUps, paged: true, title: 'Follow-Up Report' },
  opportunities: { perm: ['reports:view'], fn: reports.opportunities, paged: true, title: 'Opportunity Report' },
  pipeline: { perm: ['reports:view'], fn: reports.pipeline, paged: false, title: 'Pipeline Report' },
  conversion: { perm: ['reports:view'], fn: reports.conversion, paged: false, title: 'Sales / Conversion Report' },
  'user-activity': { perm: ['reports:management', 'audit:read'], fn: reports.userActivity, paged: false, title: 'User Activity Report' },
  audit: { perm: ['audit:read'], fn: reports.audit, paged: true, title: 'Audit Report' }
};

exports.report = async (req, res) => {
  const def = REPORTS[req.params.type];
  if (!def) throw AppError.notFound('Report');
  if (!def.perm.some((p) => hasPermission(req.user, p))) {
    await audit.log(req, { action: 'AccessDenied', entityName: 'Report', result: 'Failure', details: `Report ${req.params.type}` });
    throw AppError.forbidden('You do not have access to this report.');
  }
  const isCsv = req.query.format === 'csv';
  const result = await def.fn(req.user, req.query, isCsv);

  if (isCsv) {
    let csv;
    if (req.params.type === 'pipeline') {
      csv = req.query.groupBy === 'owner' ? toCsv(result.byOwner, result.ownerColumns) : toCsv(result.byStage, result.stageColumns);
    } else if (req.params.type === 'conversion') {
      csv = toCsv(result.byOwner, result.columns);
    } else {
      csv = toCsv(result.rows, result.columns);
    }
    await audit.log(req, { action: 'Export', entityName: 'Report', details: `${def.title} exported as CSV` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`﻿${csv}`);
  }

  const strip = (cols) => cols?.map(({ key, label }) => ({ key, label }));
  ok(res, {
    title: def.title,
    ...result,
    columns: strip(result.columns),
    stageColumns: strip(result.stageColumns),
    ownerColumns: strip(result.ownerColumns)
  });
};

exports.reportCatalogue = (req, res) => ok(res, Object.entries(REPORTS)
  .filter(([, d]) => d.perm.some((p) => hasPermission(req.user, p)))
  .map(([key, d]) => ({ key, title: d.title })));
