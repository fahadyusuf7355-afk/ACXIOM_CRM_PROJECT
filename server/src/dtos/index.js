/**
 * Data Transfer Objects. Database documents are never sent to clients
 * directly: each mapper whitelists the fields that are safe to expose. Password
 * hashes, password history, token versions, soft-delete internals and __v are
 * never part of any DTO.
 */
const id = (v) => (v ? (v._id ? v._id.toString() : v.toString()) : null);
const userRef = (u) => (u && u._id ? { id: id(u), name: u.name } : u ? { id: id(u) } : null);
const history = (h = []) => h.map((e) => ({ action: e.action, from: e.from, to: e.to, note: e.note, by: userRef(e.by), at: e.at }));

const toUserDTO = (u) => u && ({
  id: id(u),
  name: u.name,
  username: u.username,
  email: u.email,
  phone: u.phone || '',
  role: u.role?.roleName || null,
  roleId: id(u.role),
  manager: userRef(u.manager),
  isActive: u.isActive,
  isLockedOut: !!(u.lockoutEnd && u.lockoutEnd > new Date()),
  lockoutEnd: u.lockoutEnd && u.lockoutEnd > new Date() ? u.lockoutEnd : null,
  failedLoginCount: u.failedLoginCount || 0,
  mustChangePassword: !!u.mustChangePassword,
  lastLoginAt: u.lastLoginAt || null,
  createdDate: u.createdDate
});

/** The authenticated user's own session view, with permissions for the UI. */
const toSessionDTO = (u) => ({
  id: id(u),
  name: u.name,
  username: u.username,
  email: u.email,
  role: u.role?.roleName,
  scope: u.role?.scope,
  permissions: u.role?.permissions || [],
  mustChangePassword: !!u.mustChangePassword
});

const toRoleDTO = (r) => r && ({ id: id(r), roleName: r.roleName, description: r.description, scope: r.scope, permissions: r.permissions, isSystem: r.isSystem, userCount: r.userCount });

const toCustomerDTO = (c, { withHistory = false } = {}) => c && ({
  id: id(c),
  customerCode: c.customerCode,
  customerName: c.customerName,
  email: c.email,
  phone: c.phone,
  companyName: c.companyName,
  address: c.address,
  city: c.city,
  state: c.state,
  status: c.status,
  owner: userRef(c.owner),
  notes: c.notes,
  sourceLeadId: id(c.sourceLead),
  lastActivityAt: c.lastActivityAt || null,
  createdBy: userRef(c.createdBy),
  createdDate: c.createdDate,
  modifiedDate: c.modifiedDate,
  ...(withHistory ? { history: history(c.history) } : {})
});

const toLeadDTO = (l, { withHistory = false } = {}) => l && ({
  id: id(l),
  leadCode: l.leadCode,
  leadName: l.leadName,
  email: l.email,
  phone: l.phone,
  companyName: l.companyName,
  source: l.source,
  status: l.status,
  priority: l.priority,
  expectedValue: l.expectedValue,
  assignedTo: userRef(l.assignedTo),
  notes: l.notes,
  conversion: l.convertedAt ? {
    convertedAt: l.convertedAt,
    convertedBy: userRef(l.convertedBy),
    customerId: id(l.convertedCustomer),
    opportunityId: id(l.convertedOpportunity)
  } : null,
  lastActivityAt: l.lastActivityAt || null,
  createdBy: userRef(l.createdBy),
  createdDate: l.createdDate,
  modifiedDate: l.modifiedDate,
  ...(withHistory ? { history: history(l.history) } : {})
});

const toOpportunityDTO = (o, { withHistory = false } = {}) => o && ({
  id: id(o),
  opportunityCode: o.opportunityCode,
  opportunityName: o.opportunityName,
  customer: o.customer && o.customer._id ? { id: id(o.customer), name: o.customer.customerName, code: o.customer.customerCode } : { id: id(o.customer) },
  leadId: id(o.lead),
  amount: o.amount,
  stage: o.stage,
  probability: o.probability,
  weightedAmount: Math.round((o.amount * o.probability) / 100 * 100) / 100, // Amount × Probability / 100
  expectedCloseDate: o.expectedCloseDate,
  status: o.status,
  source: o.source,
  assignedTo: userRef(o.assignedTo),
  notes: o.notes,
  closedDate: o.closedDate,
  outcomeReason: o.outcomeReason,
  createdBy: userRef(o.createdBy),
  createdDate: o.createdDate,
  modifiedDate: o.modifiedDate,
  ...(withHistory ? { history: history(o.history) } : {})
});

const relatedName = (f) => {
  if (f.relatedType === 'Customer' && f.customer?.customerName) return f.customer.customerName;
  if (f.relatedType === 'Lead' && f.lead?.leadName) return f.lead.leadName;
  if (f.relatedType === 'Opportunity' && f.opportunity?.opportunityName) return f.opportunity.opportunityName;
  return null;
};

const toFollowUpDTO = (f, { withHistory = false } = {}) => f && ({
  id: id(f),
  subject: f.subject,
  followUpType: f.followUpType,
  followUpDate: f.followUpDate,
  status: f.status,
  isOverdue: f.status === 'Planned' && f.followUpDate < new Date(),
  remarks: f.remarks,
  outcome: f.outcome,
  relatedType: f.relatedType,
  relatedId: id(f.relatedId),
  relatedName: relatedName(f),
  customerId: id(f.customer),
  leadId: id(f.lead),
  opportunityId: id(f.opportunity),
  assignedTo: userRef(f.assignedTo),
  completedAt: f.completedAt,
  rescheduleCount: f.rescheduleCount,
  createdDate: f.createdDate,
  modifiedDate: f.modifiedDate,
  ...(withHistory ? { history: history(f.history) } : {})
});

const toActivityDTO = (a) => a && ({
  id: id(a),
  activityType: a.activityType,
  subject: a.subject,
  description: a.description,
  activityDate: a.activityDate,
  status: a.status,
  customer: a.customer && a.customer._id ? { id: id(a.customer), name: a.customer.customerName } : (a.customer ? { id: id(a.customer) } : null),
  lead: a.lead && a.lead._id ? { id: id(a.lead), name: a.lead.leadName } : (a.lead ? { id: id(a.lead) } : null),
  opportunityId: id(a.opportunity),
  followUpId: id(a.followUp),
  assignedTo: userRef(a.assignedTo),
  createdDate: a.createdDate
});

const toAuditDTO = (a) => a && ({
  id: id(a),
  userId: id(a.user),
  userName: a.userName,
  action: a.action,
  entityName: a.entityName,
  recordId: a.recordId,
  oldValue: a.oldValue,
  newValue: a.newValue,
  result: a.result,
  details: a.details,
  ipAddress: a.ipAddress,
  createdDate: a.createdDate
});

module.exports = { toUserDTO, toSessionDTO, toRoleDTO, toCustomerDTO, toLeadDTO, toOpportunityDTO, toFollowUpDTO, toActivityDTO, toAuditDTO };
