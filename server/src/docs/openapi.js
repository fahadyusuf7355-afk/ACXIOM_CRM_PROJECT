/**
 * OpenAPI 3 documentation for the AcxiomCRM REST API (served at /api/docs).
 * Endpoints, request/response models and error responses are documented here.
 */
const C = require('../config/constants');

const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema) => ({ 'application/json': { schema } });
const okData = (schema, paged = false) => ({
  description: 'OK',
  content: json({ type: 'object', properties: { success: { type: 'boolean', example: true }, data: schema, ...(paged ? { meta: ref('PageMeta') } : {}) } })
});
const created = (schema) => ({ ...okData(schema), description: 'Created' });
const E = (code, description) => ({ [code]: { description, content: json(ref('Error')) } });
const errors = (...codes) => Object.assign({}, ...codes.map((c) => E(c, {
  400: 'Validation / business rule failure (field details included)', 401: 'Not authenticated or session expired',
  403: 'Authenticated but not authorized (role, permission, record scope, or anti-forgery token)', 404: 'Record not found',
  409: 'Conflict (duplicate email/phone/customer, invalid state)', 423: 'Account locked', 429: 'Rate limited'
}[c])));
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Record id (24-char hex)' };
const q = (name, description, schema = { type: 'string' }) => ({ name, in: 'query', schema, description });
const listParams = [q('page', 'Page number', { type: 'integer', default: 1 }), q('limit', 'Page size (max 100)', { type: 'integer', default: 10 }),
  q('sort', 'Sort field, prefix with - for descending (e.g. -createdDate)'), q('search', 'Free text search'),
  q('range', 'Date filter', { type: 'string', enum: ['today', 'week', 'month', 'custom'] }), q('from', 'Custom range start (YYYY-MM-DD)'), q('to', 'Custom range end (YYYY-MM-DD)')];
const sec = [{ cookieAuth: [] }, { bearerAuth: [] }];

function crud(base, tag, schemaIn, schemaOut, extraListParams = [], perms = '') {
  return {
    [base]: {
      get: { tags: [tag], summary: `List/search ${tag.toLowerCase()} (scoped to the caller)`, security: sec, parameters: [...listParams, ...extraListParams], responses: { 200: okData({ type: 'array', items: ref(schemaOut) }, true), ...errors(401, 403) } },
      post: { tags: [tag], summary: `Create ${tag.toLowerCase().replace(/s$/, '')}`, description: perms, security: sec, requestBody: { required: true, content: json(ref(schemaIn)) }, responses: { 201: created(ref(schemaOut)), ...errors(400, 401, 403, 409) } }
    },
    [`${base}/{id}`]: {
      get: { tags: [tag], summary: 'Get by id', security: sec, parameters: [idParam], responses: { 200: okData(ref(schemaOut)), ...errors(401, 403, 404) } },
      put: { tags: [tag], summary: 'Update', security: sec, parameters: [idParam], requestBody: { required: true, content: json(ref(schemaIn)) }, responses: { 200: okData(ref(schemaOut)), ...errors(400, 401, 403, 404, 409) } },
      delete: { tags: [tag], summary: 'Delete (soft delete, audited)', security: sec, parameters: [idParam], responses: { 200: okData({ nullable: true }), ...errors(401, 403, 404, 409) } }
    }
  };
}

const UserRef = { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } };

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'AcxiomCRM REST API',
    version: '1.0.0',
    description: `Secured REST API for AcxiomCRM.

**Authentication** – Browser clients call \`POST /api/auth/login\` which sets an httpOnly, SameSite=Strict session cookie. Every state-changing request must echo the \`XSRF-TOKEN\` cookie in the \`X-XSRF-TOKEN\` header (anti-forgery). API clients may instead call \`POST /api/auth/token\` and send \`Authorization: Bearer <token>\` (no anti-forgery token needed).

**Errors** – all errors use \`{ success:false, error:{ code, message, details?:[{field,message}] } }\`. Stack traces and database details are never returned.

**Scope** – Admin sees all records, Manager sees own + team, SalesExecutive sees own/assigned records. Out-of-scope records return 403.`
  },
  servers: [{ url: '/' }],
  tags: ['Auth', 'Dashboard', 'Customers', 'Leads', 'Opportunities', 'FollowUps', 'Activities', 'Users', 'Roles', 'Audit', 'Reports'].map((name) => ({ name })),
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'acx_session' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      csrf: { type: 'apiKey', in: 'header', name: 'X-XSRF-TOKEN' }
    },
    schemas: {
      Error: { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string', example: 'One or more fields are invalid.' }, details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string', example: 'amount' }, message: { type: 'string', example: 'Opportunity Amount must be greater than 0.' } } } } } } } },
      PageMeta: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
      LoginRequest: { type: 'object', required: ['login', 'password'], properties: { login: { type: 'string', example: 'admin', description: 'Username or email' }, password: { type: 'string', format: 'password' } } },
      RegisterRequest: { type: 'object', required: ['name', 'username', 'email', 'password', 'confirmPassword'], properties: { name: { type: 'string' }, username: { type: 'string' }, email: { type: 'string', format: 'email' }, phone: { type: 'string', pattern: '^[6-9]\\d{9}$' }, password: { type: 'string', format: 'password', description: 'Min 8 chars, upper, lower, digit, special' }, confirmPassword: { type: 'string', format: 'password' } } },
      Session: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, username: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: Object.values(C.ROLES) }, scope: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } }, mustChangePassword: { type: 'boolean' } } },
      CustomerInput: { type: 'object', required: ['customerName', 'email', 'phone', 'status'], properties: { customerName: { type: 'string', maxLength: 100 }, email: { type: 'string', format: 'email' }, phone: { type: 'string', pattern: '^[6-9]\\d{9}$', example: '9876543210' }, companyName: { type: 'string', maxLength: 150 }, address: { type: 'string', maxLength: 250 }, city: { type: 'string' }, state: { type: 'string' }, status: { type: 'string', enum: C.CUSTOMER_STATUSES }, ownerId: { type: 'string', description: 'Assigned sales executive (defaults to caller)' }, notes: { type: 'string', maxLength: 2000 } } },
      Customer: { type: 'object', properties: { id: { type: 'string' }, customerCode: { type: 'string', example: 'CUST-00001' }, customerName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, companyName: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, status: { type: 'string' }, owner: UserRef, notes: { type: 'string' }, createdBy: UserRef, createdDate: { type: 'string', format: 'date-time' }, modifiedDate: { type: 'string', format: 'date-time' } } },
      LeadInput: { type: 'object', required: ['leadName', 'source', 'priority'], properties: { leadName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, companyName: { type: 'string' }, source: { type: 'string', enum: C.LEAD_SOURCES }, status: { type: 'string', enum: C.LEAD_STATUSES }, priority: { type: 'string', enum: C.PRIORITIES }, expectedValue: { type: 'number', minimum: 0, maximum: 1000000000 }, assignedToId: { type: 'string' }, notes: { type: 'string' } } },
      Lead: { type: 'object', properties: { id: { type: 'string' }, leadCode: { type: 'string', example: 'LEAD-00001' }, leadName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, companyName: { type: 'string' }, source: { type: 'string' }, status: { type: 'string', enum: C.LEAD_STATUSES }, priority: { type: 'string' }, expectedValue: { type: 'number' }, assignedTo: UserRef, conversion: { type: 'object', nullable: true }, createdDate: { type: 'string', format: 'date-time' } } },
      LeadConvert: { type: 'object', properties: { existingCustomerId: { type: 'string' }, customer: ref('CustomerInput'), createOpportunity: { type: 'boolean' }, opportunity: { type: 'object', properties: { opportunityName: { type: 'string' }, amount: { type: 'number' }, probability: { type: 'number' }, expectedCloseDate: { type: 'string', format: 'date' } } } } },
      OpportunityInput: { type: 'object', required: ['opportunityName', 'customerId', 'amount', 'stage', 'expectedCloseDate'], properties: { opportunityName: { type: 'string' }, customerId: { type: 'string' }, leadId: { type: 'string' }, amount: { type: 'number', description: 'Must be > 0 for active opportunities' }, probability: { type: 'number', minimum: 0, maximum: 100 }, stage: { type: 'string', enum: C.OPPORTUNITY_STAGES }, expectedCloseDate: { type: 'string', format: 'date', description: 'Cannot be in the past for active opportunities' }, source: { type: 'string' }, assignedToId: { type: 'string' }, outcomeReason: { type: 'string' }, notes: { type: 'string' } } },
      Opportunity: { type: 'object', properties: { id: { type: 'string' }, opportunityCode: { type: 'string' }, opportunityName: { type: 'string' }, customer: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } }, amount: { type: 'number' }, stage: { type: 'string' }, probability: { type: 'number' }, weightedAmount: { type: 'number', description: 'Amount × Probability / 100' }, expectedCloseDate: { type: 'string', format: 'date-time' }, status: { type: 'string', enum: C.OPPORTUNITY_STATUSES }, assignedTo: UserRef, closedDate: { type: 'string', nullable: true }, outcomeReason: { type: 'string' } } },
      FollowUpInput: { type: 'object', required: ['subject', 'followUpType', 'followUpDate', 'relatedType', 'relatedId'], properties: { subject: { type: 'string' }, followUpType: { type: 'string', enum: C.FOLLOWUP_TYPES }, followUpDate: { type: 'string', format: 'date-time', description: 'Cannot be earlier than today' }, relatedType: { type: 'string', enum: C.RELATED_TYPES }, relatedId: { type: 'string' }, assignedToId: { type: 'string' }, remarks: { type: 'string' } } },
      FollowUp: { type: 'object', properties: { id: { type: 'string' }, subject: { type: 'string' }, followUpType: { type: 'string' }, followUpDate: { type: 'string', format: 'date-time' }, status: { type: 'string', enum: C.FOLLOWUP_STATUSES }, isOverdue: { type: 'boolean' }, relatedType: { type: 'string' }, relatedId: { type: 'string' }, relatedName: { type: 'string' }, assignedTo: UserRef, remarks: { type: 'string' }, outcome: { type: 'string' } } },
      ActivityInput: { type: 'object', required: ['activityType', 'subject', 'activityDate', 'status'], properties: { activityType: { type: 'string', enum: C.ACTIVITY_TYPES }, subject: { type: 'string' }, description: { type: 'string' }, activityDate: { type: 'string', format: 'date-time' }, status: { type: 'string', enum: C.ACTIVITY_STATUSES }, customerId: { type: 'string' }, leadId: { type: 'string' }, opportunityId: { type: 'string' }, assignedToId: { type: 'string' } } },
      Activity: { type: 'object', properties: { id: { type: 'string' }, activityType: { type: 'string' }, subject: { type: 'string' }, description: { type: 'string' }, activityDate: { type: 'string' }, status: { type: 'string' }, customer: { type: 'object', nullable: true }, lead: { type: 'object', nullable: true }, assignedTo: UserRef } },
      UserInput: { type: 'object', required: ['name', 'username', 'email', 'role', 'password'], properties: { name: { type: 'string' }, username: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, role: { type: 'string', enum: Object.values(C.ROLES) }, managerId: { type: 'string' }, isActive: { type: 'boolean' }, password: { type: 'string', format: 'password' } } },
      User: { type: 'object', description: 'Password hashes and security fields are never returned.', properties: { id: { type: 'string' }, name: { type: 'string' }, username: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' }, manager: UserRef, isActive: { type: 'boolean' }, isLockedOut: { type: 'boolean' }, lockoutEnd: { type: 'string', nullable: true }, failedLoginCount: { type: 'integer' }, lastLoginAt: { type: 'string' } } },
      AuditLog: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, userName: { type: 'string' }, action: { type: 'string', enum: C.AUDIT_ACTIONS }, entityName: { type: 'string' }, recordId: { type: 'string' }, oldValue: { type: 'object' }, newValue: { type: 'object' }, result: { type: 'string' }, details: { type: 'string' }, ipAddress: { type: 'string' }, createdDate: { type: 'string', format: 'date-time' } } }
    }
  },
  paths: {
    '/api/auth/csrf': { get: { tags: ['Auth'], summary: 'Issue anti-forgery token (sets XSRF-TOKEN cookie)', responses: { 200: okData({ type: 'object', properties: { csrfToken: { type: 'string' } } }) } } },
    '/api/auth/register': { post: { tags: ['Auth'], summary: 'Self-register (role: SalesExecutive). Rate limited.', requestBody: { required: true, content: json(ref('RegisterRequest')) }, responses: { 201: created(ref('Session')), ...errors(400, 403, 409, 429) } } },
    '/api/auth/login': { post: { tags: ['Auth'], summary: 'Login with username/email + password (sets session cookie). Rate limited; lockout after repeated failures.', requestBody: { required: true, content: json(ref('LoginRequest')) }, responses: { 200: okData(ref('Session')), ...errors(400, 401, 403, 423, 429) } } },
    '/api/auth/token': { post: { tags: ['Auth'], summary: 'Obtain a Bearer token for API clients (same checks as login)', requestBody: { required: true, content: json(ref('LoginRequest')) }, responses: { 200: okData({ type: 'object', properties: { tokenType: { type: 'string' }, accessToken: { type: 'string' }, expiresAt: { type: 'string' }, user: ref('Session') } }), ...errors(400, 401, 423, 429) } } },
    '/api/auth/logout': { post: { tags: ['Auth'], summary: 'Logout – revokes the session', security: sec, responses: { 200: okData({ nullable: true }), ...errors(401) } } },
    '/api/auth/me': { get: { tags: ['Auth'], summary: 'Current user session', security: sec, responses: { 200: okData(ref('Session')), ...errors(401) } } },
    '/api/auth/change-password': { post: { tags: ['Auth'], summary: 'Change own password (policy + history enforced)', security: sec, requestBody: { required: true, content: json({ type: 'object', properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' }, confirmPassword: { type: 'string' } } }) }, responses: { 200: okData(ref('Session')), ...errors(400, 401) } } },
    '/api/dashboard': { get: { tags: ['Dashboard'], summary: 'Role-based KPIs, chart data, team & security stats', security: sec, parameters: listParams.slice(4), responses: { 200: okData({ type: 'object' }), ...errors(401, 403) } } },

    ...crud('/api/customers', 'Customers', 'CustomerInput', 'Customer', [q('customerName', 'Customer name'), q('email', 'Email'), q('phone', 'Phone'), q('company', 'Company'), q('status', 'Status'), q('ownerId', 'Owner id')], 'Duplicate email, phone or name+company returns 409.'),
    '/api/customers/{id}/details': { get: { tags: ['Customers'], summary: 'Customer with history, opportunities, follow-ups, activities and audit trail', security: sec, parameters: [idParam], responses: { 200: okData({ type: 'object' }), ...errors(401, 403, 404) } } },

    ...crud('/api/leads', 'Leads', 'LeadInput', 'Lead', [q('leadName', 'Lead name'), q('company', 'Company'), q('status', 'Status'), q('assignedToId', 'Assigned user'), q('source', 'Source')]),
    '/api/leads/{id}/status': { patch: { tags: ['Leads'], summary: 'Change lead status (workflow-validated)', security: sec, parameters: [idParam], requestBody: { content: json({ type: 'object', properties: { status: { type: 'string', enum: C.LEAD_STATUSES }, note: { type: 'string' } } }) }, responses: { 200: okData(ref('Lead')), ...errors(400, 401, 403, 404, 409) } } },
    '/api/leads/{id}/assign': { patch: { tags: ['Leads'], summary: 'Assign lead to a sales executive', security: sec, parameters: [idParam], requestBody: { content: json({ type: 'object', properties: { assignedToId: { type: 'string' } } }) }, responses: { 200: okData(ref('Lead')), ...errors(400, 401, 403, 404) } } },
    '/api/leads/{id}/convert': { post: { tags: ['Leads'], summary: 'Convert a Qualified lead to customer (+ optional opportunity)', security: sec, parameters: [idParam], requestBody: { content: json(ref('LeadConvert')) }, responses: { 201: created({ type: 'object' }), ...errors(400, 401, 403, 404, 409) } } },

    ...crud('/api/opportunities', 'Opportunities', 'OpportunityInput', 'Opportunity', [q('opportunityName', 'Name'), q('customer', 'Customer name'), q('stage', 'Stage'), q('status', 'Status')], 'Amount > 0, probability 0–100, expected close date not in the past (active stages).'),
    '/api/opportunities/pipeline': { get: { tags: ['Opportunities'], summary: 'Sales pipeline grouped by stage', security: sec, responses: { 200: okData({ type: 'array', items: { type: 'object' } }), ...errors(401, 403) } } },
    '/api/opportunities/{id}/stage': { patch: { tags: ['Opportunities'], summary: 'Move stage / mark Won or Lost', security: sec, parameters: [idParam], requestBody: { content: json({ type: 'object', properties: { stage: { type: 'string', enum: C.OPPORTUNITY_STAGES }, probability: { type: 'number' }, outcomeReason: { type: 'string' } } }) }, responses: { 200: okData(ref('Opportunity')), ...errors(400, 401, 403, 404, 409) } } },

    ...crud('/api/followups', 'FollowUps', 'FollowUpInput', 'FollowUp', [q('status', 'Status'), q('view', 'pending | upcoming | overdue | today'), q('assignedToId', 'Assigned user'), q('related', 'Related customer/lead name')]),
    ...Object.fromEntries(['complete', 'missed', 'cancel', 'reschedule'].map((a) => [`/api/followups/{id}/${a}`, { patch: { tags: ['FollowUps'], summary: `${a[0].toUpperCase()}${a.slice(1)} follow-up (audited)`, security: sec, parameters: [idParam], responses: { 200: okData(ref('FollowUp')), ...errors(400, 401, 403, 404, 409) } } }])),

    ...crud('/api/activities', 'Activities', 'ActivityInput', 'Activity', [q('activityType', 'Call | Meeting | Email | Task'), q('status', 'Status'), q('assignedToId', 'Assigned user')]),

    '/api/users': {
      get: { tags: ['Users'], summary: 'List users (Admin: all, Manager: team)', security: sec, parameters: [...listParams.slice(0, 4), q('role', 'Role'), q('status', 'active | inactive | locked')], responses: { 200: okData({ type: 'array', items: ref('User') }, true), ...errors(401, 403) } },
      post: { tags: ['Users'], summary: 'Create user (Admin)', security: sec, requestBody: { content: json(ref('UserInput')) }, responses: { 201: created(ref('User')), ...errors(400, 401, 403, 409) } }
    },
    '/api/users/{id}': { get: { tags: ['Users'], summary: 'Get user', security: sec, parameters: [idParam], responses: { 200: okData(ref('User')), ...errors(401, 403, 404) } }, put: { tags: ['Users'], summary: 'Update user / change role (Admin)', security: sec, parameters: [idParam], responses: { 200: okData(ref('User')), ...errors(400, 401, 403, 404, 409) } } },
    '/api/users/{id}/status': { patch: { tags: ['Users'], summary: 'Activate / deactivate (Admin)', security: sec, parameters: [idParam], requestBody: { content: json({ type: 'object', properties: { isActive: { type: 'boolean' } } }) }, responses: { 200: okData(ref('User')), ...errors(400, 401, 403, 404) } } },
    '/api/users/{id}/reset-password': { post: { tags: ['Users'], summary: 'Set temporary password (Admin); user must change at next login', security: sec, parameters: [idParam], responses: { 200: okData(ref('User')), ...errors(400, 401, 403, 404) } } },
    '/api/users/{id}/unlock': { post: { tags: ['Users'], summary: 'Unlock a locked-out account (Admin)', security: sec, parameters: [idParam], responses: { 200: okData(ref('User')), ...errors(401, 403, 404) } } },
    '/api/roles': { get: { tags: ['Roles'], summary: 'Roles with permissions + permission catalogue', security: sec, responses: { 200: okData({ type: 'array', items: { type: 'object' } }), ...errors(401, 403) } } },
    '/api/roles/{id}/permissions': { put: { tags: ['Roles'], summary: 'Update role permissions (Admin)', security: sec, parameters: [idParam], requestBody: { content: json({ type: 'object', properties: { permissions: { type: 'array', items: { type: 'string', enum: C.ALL_PERMISSIONS } } } }) }, responses: { 200: okData({ type: 'object' }), ...errors(400, 401, 403, 404) } } },
    '/api/audit-logs': { get: { tags: ['Audit'], summary: 'Audit log (Admin) – filter by user, module, action, result, date range. Read-only.', security: sec, parameters: [...listParams, q('user', 'User name contains'), q('module', 'Module / entity'), q('action', 'Action'), q('result', 'Success | Failure')], responses: { 200: okData({ type: 'array', items: ref('AuditLog') }, true), ...errors(401, 403) } } },
    '/api/reports/{type}': { get: { tags: ['Reports'], summary: 'Report data (JSON) or CSV export (?format=csv)', description: 'type: customers | leads | followups | opportunities | pipeline | conversion | user-activity | audit', security: sec, parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['customers', 'leads', 'followups', 'opportunities', 'pipeline', 'conversion', 'user-activity', 'audit'] } }, ...listParams, q('format', 'csv for export'), q('groupBy', 'Pipeline CSV: stage | owner')], responses: { 200: okData({ type: 'object' }), ...errors(401, 403, 404) } } }
  }
};
