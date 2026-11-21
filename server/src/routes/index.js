const express = require('express');
const { asyncHandler: h } = require('../utils/helpers');
const validate = require('../middleware/validate');
const { authenticate, requirePasswordCurrent, requirePermission: can } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const v = require('../validators');
const auth = require('../controllers/authController');
const crm = require('../controllers/crmControllers');
const admin = require('../controllers/adminControllers');

const router = express.Router();

// ---------- Authentication (public endpoints are rate limited) ----------
router.get('/auth/csrf', auth.csrf);
router.post('/auth/register', authLimiter, validate(v.register), h(auth.register));
router.post('/auth/login', authLimiter, validate(v.login), h(auth.login));
router.post('/auth/token', authLimiter, validate(v.login), h(auth.token));
router.post('/auth/logout', authenticate, h(auth.logout));
router.get('/auth/me', authenticate, auth.me);
router.post('/auth/change-password', authenticate, authLimiter, validate(v.changePassword), h(auth.changePassword));

router.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

// ---------- Everything below requires an authenticated, current session ----------
router.use(authenticate, requirePasswordCurrent);

router.get('/meta', admin.meta);
router.get('/dashboard', can('dashboard:view'), h(admin.dashboard));
router.get('/search', h(admin.search));
router.get('/notifications', can('followups:read'), h(crm.followUps.notifications));

// Customers
const C = crm.customers;
router.get('/customers', can('customers:read'), h(C.list));
router.get('/customers/lookup', can('customers:read'), h(C.lookup));
router.post('/customers', can('customers:create'), validate(v.customer), h(C.create));
router.get('/customers/:id', can('customers:read'), h(C.get));
router.get('/customers/:id/details', can('customers:read'), h(C.details));
router.put('/customers/:id', can('customers:update'), validate(v.customer), h(C.update));
router.delete('/customers/:id', can('customers:delete'), h(C.remove));

// Leads
const L = crm.leads;
router.get('/leads', can('leads:read'), h(L.list));
router.get('/leads/lookup', can('leads:read'), h(L.lookup));
router.post('/leads', can('leads:create'), validate(v.leadCreate), h(L.create));
router.get('/leads/:id', can('leads:read'), h(L.get));
router.get('/leads/:id/details', can('leads:read'), h(L.details));
router.put('/leads/:id', can('leads:update'), validate(v.leadUpdate), h(L.update));
router.patch('/leads/:id/status', can('leads:update'), validate(v.leadStatus), h(L.status));
router.patch('/leads/:id/assign', can('leads:assign'), validate(v.leadAssign), h(L.assign));
router.post('/leads/:id/convert', can('leads:convert'), validate(v.leadConvert), h(L.convert));
router.delete('/leads/:id', can('leads:delete'), h(L.remove));

// Opportunities
const O = crm.opportunities;
router.get('/opportunities', can('opportunities:read'), h(O.list));
router.get('/opportunities/lookup', can('opportunities:read'), h(O.lookup));
router.get('/opportunities/pipeline', can('opportunities:read'), h(O.pipeline));
router.post('/opportunities', can('opportunities:create'), validate(v.opportunity), h(O.create));
router.get('/opportunities/:id', can('opportunities:read'), h(O.get));
router.get('/opportunities/:id/details', can('opportunities:read'), h(O.details));
router.put('/opportunities/:id', can('opportunities:update'), validate(v.opportunity), h(O.update));
router.patch('/opportunities/:id/stage', can('opportunities:update'), validate(v.opportunityStage), h(O.stage));
router.delete('/opportunities/:id', can('opportunities:delete'), h(O.remove));

// Follow-ups
const F = crm.followUps;
router.get('/followups', can('followups:read'), h(F.list));
router.post('/followups', can('followups:create'), validate(v.followUp), h(F.create));
router.get('/followups/:id', can('followups:read'), h(F.get));
router.put('/followups/:id', can('followups:update'), validate(v.followUpUpdate), h(F.update));
router.patch('/followups/:id/complete', can('followups:update'), validate(v.followUpComplete), h(F.complete));
router.patch('/followups/:id/missed', can('followups:update'), validate(v.followUpNote), h(F.missed));
router.patch('/followups/:id/cancel', can('followups:update'), validate(v.followUpNote), h(F.cancel));
router.patch('/followups/:id/reschedule', can('followups:update'), validate(v.followUpReschedule), h(F.reschedule));
router.delete('/followups/:id', can('followups:delete'), h(F.remove));

// Activities (Call / Meeting / Email / Task)
const A = crm.activities;
router.get('/activities', can('activities:read'), h(A.list));
router.post('/activities', can('activities:create'), validate(v.activity), h(A.create));
router.get('/activities/:id', can('activities:read'), h(A.get));
router.put('/activities/:id', can('activities:update'), validate(v.activity), h(A.update));
router.delete('/activities/:id', can('activities:delete'), h(A.remove));

// Users & roles
const U = admin.users;
router.get('/users/assignable', h(U.assignable));
router.get('/users', can('users:read', 'users:manage'), h(U.list));
router.post('/users', can('users:manage'), validate(v.userCreate), h(U.create));
router.get('/users/:id', can('users:read', 'users:manage'), h(U.get));
router.put('/users/:id', can('users:manage'), validate(v.userUpdate), h(U.update));
router.patch('/users/:id/status', can('users:manage'), validate(v.userStatus), h(U.status));
router.post('/users/:id/reset-password', can('users:manage'), validate(v.resetPassword), h(U.resetPassword));
router.post('/users/:id/unlock', can('users:manage'), h(U.unlock));
router.get('/roles', can('roles:manage', 'users:read', 'users:manage'), h(admin.roles.list));
router.put('/roles/:id/permissions', can('roles:manage'), validate(v.rolePermissions), h(admin.roles.updatePermissions));

// Audit log (read-only – there are intentionally no write/delete endpoints)
router.get('/audit-logs', can('audit:read'), h(admin.auditLogs));

// Reports
router.get('/reports', can('reports:view', 'audit:read'), admin.reportCatalogue);
router.get('/reports/:type', h(admin.report));

module.exports = router;
