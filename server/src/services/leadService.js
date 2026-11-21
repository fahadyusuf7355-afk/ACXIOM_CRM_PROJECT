const { Lead, Customer, Opportunity, FollowUp, Activity, AuditLog, nextCode } = require('../models');
const AppError = require('../utils/AppError');
const audit = require('./auditService');
const customerService = require('./customerService');
const opportunityService = require('./opportunityService');
const { scopeFilter, assertInScope, resolveAssignee } = require('./scopeService');
const { escapeRegex, parseListQuery, pageMeta, diff, resolveRange, dateFilter, isValidId } = require('../utils/helpers');
const { toLeadDTO, toFollowUpDTO, toActivityDTO, toAuditDTO } = require('../dtos');
const { LEAD_TRANSITIONS, STAGE_DEFAULT_PROBABILITY } = require('../config/constants');
const { hasPermission } = require('../middleware/auth');

const FIELDS = ['leadName', 'email', 'phone', 'companyName', 'source', 'status', 'priority', 'expectedValue', 'assignedTo', 'notes'];
const populate = [{ path: 'assignedTo', select: 'name' }, { path: 'createdBy', select: 'name' }, { path: 'convertedBy', select: 'name' }, { path: 'history.by', select: 'name' }];

async function buildFilter(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ leadName: rx }, { companyName: rx }, { email: rx }, { phone: rx }, { leadCode: rx }];
  }
  if (q.leadName) filter.leadName = new RegExp(escapeRegex(q.leadName), 'i');
  if (q.company) filter.companyName = new RegExp(escapeRegex(q.company), 'i');
  if (q.status) filter.status = String(q.status);
  if (q.source) filter.source = String(q.source);
  if (q.priority) filter.priority = String(q.priority);
  if (q.assignedToId && isValidId(q.assignedToId)) {
    if (filter.assignedTo && !filter.assignedTo.$in.some((i) => String(i) === q.assignedToId)) filter.assignedTo = { $in: [] };
    else filter.assignedTo = q.assignedToId;
  }
  Object.assign(filter, dateFilter('createdDate', resolveRange(q)));
  return filter;
}

async function list(user, q) {
  const { page, limit, skip, sort } = parseListQuery(q, ['leadCode', 'leadName', 'companyName', 'source', 'status', 'priority', 'expectedValue', 'createdDate'], '-createdDate');
  const filter = await buildFilter(user, q);
  const [items, total] = await Promise.all([
    Lead.find(filter).populate(populate).sort(sort).skip(skip).limit(limit),
    Lead.countDocuments(filter)
  ]);
  return { items: items.map((l) => toLeadDTO(l)), meta: pageMeta(page, limit, total) };
}

async function load(user, id) {
  if (!isValidId(id)) throw AppError.notFound('Lead');
  const l = await Lead.findOne({ _id: id, isDeleted: false }).populate(populate);
  if (!l) throw AppError.notFound('Lead');
  await assertInScope(user, l.assignedTo._id || l.assignedTo);
  return l;
}

async function resolveLeadAssignee(user, requestedId) {
  if (requestedId && String(requestedId) !== String(user._id) && !hasPermission(user, 'leads:assign')) {
    throw AppError.forbidden('You do not have permission to assign leads to other users.');
  }
  return resolveAssignee(user, requestedId);
}

/** Workflow guard (4.5): only configured transitions are allowed; Converted only via conversion. */
function assertTransition(from, to) {
  if (from === to) return;
  if (to === 'Converted') throw AppError.business('status', 'Use "Convert Lead" to convert a qualified lead.');
  if (!(LEAD_TRANSITIONS[from] || []).includes(to)) {
    throw AppError.business('status', `Invalid status change from ${from} to ${to}. Allowed: ${(LEAD_TRANSITIONS[from] || []).join(', ') || 'none'}.`);
  }
}

async function create(user, data, req) {
  const assignedTo = await resolveLeadAssignee(user, data.assignedToId);
  const status = data.status || 'New';
  const l = await Lead.create({
    leadCode: await nextCode('lead', 'LEAD'),
    leadName: data.leadName, email: data.email || '', phone: data.phone || '', companyName: data.companyName || '',
    source: data.source, status, priority: data.priority || 'Medium', expectedValue: data.expectedValue || 0,
    assignedTo, notes: data.notes || '', createdBy: user._id, modifiedBy: user._id,
    history: [{ action: 'Created', to: status, by: user._id }]
  });
  await l.populate(populate);
  await audit.log(req, { action: 'Create', entityName: 'Lead', recordId: l._id, newValue: toLeadDTO(l) });
  return l;
}

async function update(user, id, data, req) {
  const l = await load(user, id);
  if (l.status === 'Converted') throw AppError.conflict('Converted leads are read-only.');
  assertTransition(l.status, data.status);
  const before = l.toObject({ depopulate: true });
  const assignedTo = data.assignedToId && String(data.assignedToId) !== String(l.assignedTo._id)
    ? await resolveLeadAssignee(user, data.assignedToId) : l.assignedTo._id;

  Object.assign(l, {
    leadName: data.leadName, email: data.email || '', phone: data.phone || '', companyName: data.companyName || '',
    source: data.source, status: data.status, priority: data.priority, expectedValue: data.expectedValue || 0,
    assignedTo, notes: data.notes || '', modifiedBy: user._id
  });
  const changes = diff(before, l.toObject({ depopulate: true }), FIELDS);
  if (!changes.changed.length) return l;
  if (changes.changed.includes('status')) l.history.push({ action: 'StatusChange', from: before.status, to: l.status, by: user._id });
  if (changes.changed.includes('assignedTo')) l.history.push({ action: 'Assigned', by: user._id });
  l.history.push({ action: 'Updated', note: `Changed: ${changes.changed.join(', ')}`, by: user._id });
  await l.save();
  await l.populate(populate);
  await audit.log(req, { action: 'Update', entityName: 'Lead', recordId: l._id, oldValue: changes.oldValue, newValue: changes.newValue });
  if (changes.changed.includes('status')) {
    await audit.log(req, { action: 'StatusChange', entityName: 'Lead', recordId: l._id, oldValue: { status: before.status }, newValue: { status: l.status } });
  }
  if (changes.changed.includes('assignedTo')) {
    await audit.log(req, { action: 'Assign', entityName: 'Lead', recordId: l._id, oldValue: { assignedTo: before.assignedTo }, newValue: { assignedTo: l.assignedTo._id } });
  }
  return l;
}

async function changeStatus(user, id, { status, note }, req, { system = false } = {}) {
  const l = await load(user, id);
  if (l.status === 'Converted') throw AppError.conflict('Converted leads are read-only.');
  assertTransition(l.status, status);
  if (l.status === status) return l;
  const from = l.status;
  l.status = status;
  l.modifiedBy = user._id;
  l.history.push({ action: 'StatusChange', from, to: status, by: user._id, note: note || (system ? 'Automatic: follow-up completed' : undefined) });
  await l.save();
  await l.populate(populate);
  await audit.log(req, { action: 'StatusChange', entityName: 'Lead', recordId: l._id, oldValue: { status: from }, newValue: { status }, details: note || (system ? 'Automatic transition after completed follow-up' : '') });
  return l;
}

async function assign(user, id, { assignedToId }, req) {
  const l = await load(user, id);
  if (l.status === 'Converted') throw AppError.conflict('Converted leads are read-only.');
  const from = l.assignedTo;
  const to = await resolveLeadAssignee(user, assignedToId);
  if (String(from._id) === String(to)) return l;
  l.assignedTo = to;
  l.modifiedBy = user._id;
  l.history.push({ action: 'Assigned', note: `Reassigned from ${from.name}`, by: user._id });
  await l.save();
  await l.populate(populate);
  await audit.log(req, { action: 'Assign', entityName: 'Lead', recordId: l._id, oldValue: { assignedTo: from.name }, newValue: { assignedTo: l.assignedTo.name } });
  return l;
}

/**
 * Lead conversion (workflow 8 / 4.5): Qualified lead → Customer (new or
 * existing) and optionally an Opportunity. All business validation runs before
 * anything is written; if opportunity creation fails the new customer is
 * rolled back so no partial conversion remains.
 */
async function convert(user, id, data, req) {
  const l = await load(user, id);
  if (l.status !== 'Qualified') throw AppError.business('status', `Only Qualified leads can be converted (current status: ${l.status}).`);

  // Pre-validate everything up front
  let existing = null;
  if (data.existingCustomerId) {
    existing = await Customer.findOne({ _id: data.existingCustomerId, isDeleted: false });
    if (!existing) throw AppError.business('existingCustomerId', 'Selected customer does not exist.');
    await assertInScope(user, existing.owner);
  } else {
    await customerService.assertNoDuplicate(data.customer);
  }
  if (data.createOpportunity) {
    const o = data.opportunity;
    opportunityService.validateRules({ amount: o.amount, probability: o.probability ?? STAGE_DEFAULT_PROBABILITY.Qualification, stage: 'Qualification', expectedCloseDate: o.expectedCloseDate });
  }

  let customer = existing;
  let createdCustomer = false;
  if (!customer) {
    customer = await customerService.create(user, { ...data.customer, status: 'Active', ownerId: l.assignedTo._id.toString(), notes: `Converted from lead ${l.leadCode}` }, req, { sourceLead: l._id, auditDetails: `Converted from lead ${l.leadCode}` });
    createdCustomer = true;
  }

  let opportunity = null;
  if (data.createOpportunity) {
    try {
      opportunity = await opportunityService.create(user, {
        ...data.opportunity, stage: 'Qualification', customerId: customer._id.toString(), leadId: l._id.toString(),
        source: l.source, assignedToId: l.assignedTo._id.toString()
      }, req, { auditDetails: `Created from lead ${l.leadCode}` });
    } catch (e) {
      if (createdCustomer) await Customer.deleteOne({ _id: customer._id });
      throw e;
    }
  }

  const from = l.status;
  l.status = 'Converted';
  l.convertedAt = new Date();
  l.convertedBy = user._id;
  l.convertedCustomer = customer._id;
  l.convertedOpportunity = opportunity?._id || null;
  l.modifiedBy = user._id;
  l.history.push({ action: 'Converted', from, to: 'Converted', by: user._id, note: `Customer ${customer.customerCode}${opportunity ? `, Opportunity ${opportunity.opportunityCode}` : ''}` });
  await l.save();
  await l.populate(populate);

  await audit.log(req, {
    action: 'Convert', entityName: 'Lead', recordId: l._id,
    oldValue: { status: from },
    newValue: { status: 'Converted', customerId: customer._id.toString(), customerCode: customer.customerCode, opportunityId: opportunity?._id.toString() || null },
    details: `Lead ${l.leadCode} converted${createdCustomer ? ' to new customer' : ' to existing customer'}${opportunity ? ' with opportunity' : ''}`
  });
  return { lead: l, customer, opportunity };
}

async function remove(user, id, req) {
  const l = await load(user, id);
  if (l.status === 'Converted') throw AppError.conflict('Converted leads cannot be deleted because they are linked to customer records.');
  l.isDeleted = true; l.deletedAt = new Date(); l.deletedBy = user._id;
  l.history.push({ action: 'Deleted', by: user._id });
  await l.save();
  await FollowUp.updateMany({ lead: l._id, status: 'Planned', isDeleted: false }, { $set: { status: 'Cancelled' } });
  await audit.log(req, { action: 'Delete', entityName: 'Lead', recordId: l._id, oldValue: toLeadDTO(l), details: 'Soft-deleted; planned follow-ups cancelled' });
}

async function details(user, id) {
  const l = await load(user, id);
  const [followUps, activities, auditTrail, opportunities] = await Promise.all([
    FollowUp.find({ lead: l._id, isDeleted: false }).populate('assignedTo', 'name').sort('-followUpDate'),
    Activity.find({ lead: l._id, isDeleted: false }).populate('assignedTo', 'name').sort('-activityDate'),
    AuditLog.find({ entityName: 'Lead', recordId: l._id.toString() }).sort('-createdDate').limit(50),
    Opportunity.find({ lead: l._id, isDeleted: false }).select('opportunityName opportunityCode stage amount')
  ]);
  return {
    lead: toLeadDTO(l, { withHistory: true }),
    allowedTransitions: l.status === 'Converted' ? [] : LEAD_TRANSITIONS[l.status],
    canConvert: l.status === 'Qualified',
    followUps: followUps.map((f) => toFollowUpDTO(f)),
    activities: activities.map(toActivityDTO),
    opportunities: opportunities.map((o) => ({ id: o._id.toString(), name: o.opportunityName, code: o.opportunityCode, stage: o.stage, amount: o.amount })),
    auditTrail: auditTrail.map(toAuditDTO)
  };
}

async function lookup(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  if (q.search) filter.leadName = new RegExp(escapeRegex(q.search), 'i');
  if (q.open === 'true') filter.status = { $in: ['New', 'Contacted', 'Qualified', 'Unqualified'] };
  const items = await Lead.find(filter).select('leadName leadCode companyName').sort('leadName').limit(50);
  return items.map((l) => ({ id: l._id.toString(), name: l.leadName, code: l.leadCode, company: l.companyName }));
}

module.exports = { list, load, create, update, changeStatus, assign, convert, remove, details, lookup, buildFilter, assertTransition };
