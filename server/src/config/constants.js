/**
 * Domain constants: roles, statuses, workflow transitions and permissions.
 */
const ROLES = Object.freeze({
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SALES: 'SalesExecutive'
});

const CUSTOMER_STATUSES = ['Active', 'Inactive', 'Prospect'];

const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted', 'Lost'];
const LEAD_SOURCES = ['Website', 'Referral', 'Social Media', 'Email Campaign', 'Cold Call', 'Trade Show', 'Advertisement', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High'];

// Configured lead workflow (section 4.5). "Converted" is reachable only
// through the conversion process, never through a plain status update.
const LEAD_TRANSITIONS = {
  New: ['Contacted', 'Unqualified', 'Lost'],
  Contacted: ['Qualified', 'Unqualified', 'Lost'],
  Qualified: ['Contacted', 'Unqualified', 'Lost'],
  Unqualified: ['Contacted', 'Lost'],
  Lost: ['Contacted'],
  Converted: []
};
const LEAD_OPEN_STATUSES = ['New', 'Contacted', 'Qualified'];

const OPPORTUNITY_STAGES = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const OPPORTUNITY_ACTIVE_STAGES = ['Qualification', 'Proposal', 'Negotiation'];
const OPPORTUNITY_STATUSES = ['Open', 'Won', 'Lost'];
const STAGE_DEFAULT_PROBABILITY = { Qualification: 20, Proposal: 50, Negotiation: 75, Won: 100, Lost: 0 };

const FOLLOWUP_STATUSES = ['Planned', 'Completed', 'Missed', 'Cancelled'];
const FOLLOWUP_TYPES = ['Call', 'Meeting', 'Email', 'Task', 'Visit'];
const RELATED_TYPES = ['Customer', 'Lead', 'Opportunity'];

const ACTIVITY_TYPES = ['Call', 'Meeting', 'Email', 'Task'];
const ACTIVITY_STATUSES = ['Planned', 'Completed', 'Cancelled'];

/**
 * Permission catalogue. Roles hold a subset of these, editable by Admin in
 * Role Management (except the Admin role, which always holds all of them).
 */
const PERMISSIONS = {
  'dashboard:view': 'View dashboard',
  'customers:read': 'View customers',
  'customers:create': 'Create customers',
  'customers:update': 'Edit customers',
  'customers:delete': 'Delete customers',
  'leads:read': 'View leads',
  'leads:create': 'Create leads',
  'leads:update': 'Edit leads / change status',
  'leads:delete': 'Delete leads',
  'leads:convert': 'Convert leads',
  'leads:assign': 'Assign leads to other users',
  'opportunities:read': 'View opportunities',
  'opportunities:create': 'Create opportunities',
  'opportunities:update': 'Edit opportunities / move stage',
  'opportunities:delete': 'Delete opportunities',
  'followups:read': 'View follow-ups',
  'followups:create': 'Schedule follow-ups',
  'followups:update': 'Complete / reschedule follow-ups',
  'followups:delete': 'Delete follow-ups',
  'activities:read': 'View activities',
  'activities:create': 'Create activities',
  'activities:update': 'Edit activities',
  'activities:delete': 'Delete activities',
  'reports:view': 'View own/assigned reports',
  'reports:management': 'View management/team reports',
  'users:read': 'View users',
  'users:manage': 'Create/edit/activate users, reset passwords, unlock',
  'roles:manage': 'Manage roles and permissions',
  'audit:read': 'View audit log'
};
const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

const crud = (m) => [`${m}:read`, `${m}:create`, `${m}:update`];

const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: ALL_PERMISSIONS,
  [ROLES.MANAGER]: [
    'dashboard:view',
    ...crud('customers'), 'customers:delete',
    ...crud('leads'), 'leads:delete', 'leads:convert', 'leads:assign',
    ...crud('opportunities'), 'opportunities:delete',
    ...crud('followups'), 'followups:delete',
    ...crud('activities'), 'activities:delete',
    'reports:view', 'reports:management',
    'users:read'
  ],
  [ROLES.SALES]: [
    'dashboard:view',
    ...crud('customers'),
    ...crud('leads'), 'leads:convert',
    ...crud('opportunities'),
    ...crud('followups'),
    ...crud('activities'),
    'reports:view'
  ]
};

// Data scope per role (permission matrix section 7.1)
const ROLE_SCOPE = {
  [ROLES.ADMIN]: 'all',
  [ROLES.MANAGER]: 'team',
  [ROLES.SALES]: 'own'
};

const AUDIT_ACTIONS = [
  'Login', 'LoginFailed', 'Logout', 'Register', 'AccountLocked', 'AccountUnlocked',
  'Create', 'Update', 'Delete', 'StatusChange', 'StageChange', 'Assign', 'Convert',
  'Complete', 'Reschedule', 'Missed', 'Cancel',
  'RoleChange', 'PermissionChange', 'Activate', 'Deactivate',
  'PasswordChange', 'PasswordReset', 'AccessDenied', 'Export'
];

module.exports = {
  ROLES, CUSTOMER_STATUSES, LEAD_STATUSES, LEAD_SOURCES, PRIORITIES, LEAD_TRANSITIONS, LEAD_OPEN_STATUSES,
  OPPORTUNITY_STAGES, OPPORTUNITY_ACTIVE_STAGES, OPPORTUNITY_STATUSES, STAGE_DEFAULT_PROBABILITY,
  FOLLOWUP_STATUSES, FOLLOWUP_TYPES, RELATED_TYPES, ACTIVITY_TYPES, ACTIVITY_STATUSES,
  PERMISSIONS, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLE_SCOPE, AUDIT_ACTIONS
};
