const { Customer, Opportunity, FollowUp, Activity, AuditLog, nextCode } = require('../models');
const AppError = require('../utils/AppError');
const audit = require('./auditService');
const { scopeFilter, assertInScope, resolveAssignee } = require('./scopeService');
const { escapeRegex, parseListQuery, pageMeta, diff, resolveRange, dateFilter, isValidId } = require('../utils/helpers');
const { toCustomerDTO, toOpportunityDTO, toFollowUpDTO, toActivityDTO, toAuditDTO } = require('../dtos');
const { hasPermission } = require('../middleware/auth');

const FIELDS = ['customerName', 'email', 'phone', 'companyName', 'address', 'city', 'state', 'status', 'owner', 'notes'];
const populate = [{ path: 'owner', select: 'name' }, { path: 'createdBy', select: 'name' }, { path: 'history.by', select: 'name' }];

async function buildFilter(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'owner')) };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ customerName: rx }, { email: rx }, { phone: rx }, { companyName: rx }, { customerCode: rx }];
  }
  if (q.customerName) filter.customerName = new RegExp(escapeRegex(q.customerName), 'i');
  if (q.email) filter.email = new RegExp(escapeRegex(q.email), 'i');
  if (q.phone) filter.phone = new RegExp(escapeRegex(q.phone), 'i');
  if (q.company) filter.companyName = new RegExp(escapeRegex(q.company), 'i');
  if (q.status) filter.status = String(q.status);
  if (q.ownerId && isValidId(q.ownerId)) {
    if (filter.owner && !filter.owner.$in.some((i) => String(i) === q.ownerId)) filter.owner = { $in: [] };
    else filter.owner = q.ownerId;
  }
  Object.assign(filter, dateFilter('createdDate', resolveRange(q)));
  return filter;
}

async function list(user, q) {
  const { page, limit, skip, sort } = parseListQuery(q, ['customerCode', 'customerName', 'email', 'companyName', 'city', 'status', 'createdDate'], '-createdDate');
  const filter = await buildFilter(user, q);
  const [items, total] = await Promise.all([
    Customer.find(filter).populate(populate).sort(sort).skip(skip).limit(limit),
    Customer.countDocuments(filter)
  ]);
  return { items: items.map((c) => toCustomerDTO(c)), meta: pageMeta(page, limit, total) };
}

async function load(user, id) {
  if (!isValidId(id)) throw AppError.notFound('Customer');
  const c = await Customer.findOne({ _id: id, isDeleted: false }).populate(populate);
  if (!c) throw AppError.notFound('Customer');
  await assertInScope(user, c.owner._id || c.owner);
  return c;
}

/** Duplicate rules (17.5): unique email, unique phone, and same name + company cannot be created twice. */
async function assertNoDuplicate({ email, phone, customerName, companyName }, excludeId) {
  const base = { isDeleted: false, ...(excludeId ? { _id: { $ne: excludeId } } : {}) };
  if (await Customer.exists({ ...base, email })) throw AppError.conflict('A customer with this email already exists.', 'email');
  if (await Customer.exists({ ...base, phone })) throw AppError.conflict('A customer with this phone number already exists.', 'phone');
  const nameRx = new RegExp(`^${escapeRegex(customerName.trim())}$`, 'i');
  const companyRx = new RegExp(`^${escapeRegex((companyName || '').trim())}$`, 'i');
  if (await Customer.exists({ ...base, customerName: nameRx, companyName: companyRx })) {
    throw AppError.conflict('A customer with the same name and company already exists.', 'customerName');
  }
}

async function create(user, data, req, { sourceLead = null, auditDetails = '' } = {}) {
  await assertNoDuplicate(data);
  const owner = await resolveAssignee(user, data.ownerId);
  const c = await Customer.create({
    customerCode: await nextCode('customer', 'CUST'),
    customerName: data.customerName, email: data.email, phone: data.phone,
    companyName: data.companyName || '', address: data.address || '', city: data.city || '', state: data.state || '',
    status: data.status || 'Active', owner, notes: data.notes || '', sourceLead,
    createdBy: user._id, modifiedBy: user._id,
    history: [{ action: 'Created', to: data.status || 'Active', by: user._id, note: auditDetails || undefined }]
  });
  await c.populate(populate);
  await audit.log(req, { action: 'Create', entityName: 'Customer', recordId: c._id, newValue: toCustomerDTO(c), details: auditDetails });
  return c;
}

async function update(user, id, data, req) {
  const c = await load(user, id);
  await assertNoDuplicate(data, c._id);
  const before = c.toObject({ depopulate: true });
  const owner = String(data.ownerId || '') && String(data.ownerId) !== String(c.owner._id)
    ? await resolveAssignee(user, data.ownerId) : c.owner._id;

  Object.assign(c, {
    customerName: data.customerName, email: data.email, phone: data.phone,
    companyName: data.companyName || '', address: data.address || '', city: data.city || '', state: data.state || '',
    status: data.status, owner, notes: data.notes || '', modifiedBy: user._id
  });
  const changes = diff(before, c.toObject({ depopulate: true }), FIELDS);
  if (!changes.changed.length) return c;
  if (changes.changed.includes('status')) c.history.push({ action: 'StatusChange', from: before.status, to: c.status, by: user._id });
  if (changes.changed.includes('owner')) c.history.push({ action: 'Reassigned', by: user._id });
  c.history.push({ action: 'Updated', note: `Changed: ${changes.changed.join(', ')}`, by: user._id });
  await c.save();
  await c.populate(populate);
  await audit.log(req, { action: 'Update', entityName: 'Customer', recordId: c._id, oldValue: changes.oldValue, newValue: changes.newValue });
  if (changes.changed.includes('status')) {
    await audit.log(req, { action: 'StatusChange', entityName: 'Customer', recordId: c._id, oldValue: { status: before.status }, newValue: { status: c.status } });
  }
  return c;
}

async function remove(user, id, req) {
  const c = await load(user, id);
  const openOpps = await Opportunity.countDocuments({ customer: c._id, isDeleted: false, status: 'Open' });
  if (openOpps) throw AppError.conflict(`Customer has ${openOpps} open opportunit${openOpps > 1 ? 'ies' : 'y'}. Close or delete them first.`);
  c.isDeleted = true; c.deletedAt = new Date(); c.deletedBy = user._id;
  c.history.push({ action: 'Deleted', by: user._id });
  await c.save();
  await audit.log(req, { action: 'Delete', entityName: 'Customer', recordId: c._id, oldValue: toCustomerDTO(c), details: 'Soft-deleted' });
}

/** Customer details with history, related opportunities, follow-ups, activities and audit trail. */
async function details(user, id) {
  const c = await load(user, id);
  const [opps, followUps, activities, auditTrail] = await Promise.all([
    Opportunity.find({ customer: c._id, isDeleted: false }).populate('assignedTo', 'name').sort('-createdDate').limit(50),
    FollowUp.find({ customer: c._id, isDeleted: false }).populate('assignedTo', 'name').sort('-followUpDate').limit(50),
    Activity.find({ customer: c._id, isDeleted: false }).populate('assignedTo', 'name').sort('-activityDate').limit(50),
    hasPermission(user, 'audit:read') || hasPermission(user, 'customers:read')
      ? AuditLog.find({ entityName: 'Customer', recordId: c._id.toString() }).sort('-createdDate').limit(50) : []
  ]);
  return {
    customer: toCustomerDTO(c, { withHistory: true }),
    opportunities: opps.map((o) => toOpportunityDTO(o)),
    followUps: followUps.map((f) => toFollowUpDTO(f)),
    activities: activities.map(toActivityDTO),
    auditTrail: auditTrail.map(toAuditDTO)
  };
}

/** Lightweight lookup list for dropdowns (scoped). */
async function lookup(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'owner')) };
  if (q.search) filter.customerName = new RegExp(escapeRegex(q.search), 'i');
  const items = await Customer.find(filter).select('customerName customerCode companyName').sort('customerName').limit(50);
  return items.map((c) => ({ id: c._id.toString(), name: c.customerName, code: c.customerCode, company: c.companyName }));
}

module.exports = { list, load, create, update, remove, details, lookup, assertNoDuplicate, buildFilter };
