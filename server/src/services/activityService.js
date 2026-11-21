const { Activity, Customer, Lead, Opportunity } = require('../models');
const AppError = require('../utils/AppError');
const audit = require('./auditService');
const { scopeFilter, assertInScope, resolveAssignee } = require('./scopeService');
const { escapeRegex, parseListQuery, pageMeta, diff, resolveRange, dateFilter, isValidId } = require('../utils/helpers');
const { toActivityDTO } = require('../dtos');

const populate = [{ path: 'assignedTo', select: 'name' }, { path: 'customer', select: 'customerName' }, { path: 'lead', select: 'leadName' }];

async function checkRef(user, model, id, ownerField, field, label) {
  if (!id) return null;
  const rec = await model.findOne({ _id: id, isDeleted: false });
  if (!rec) throw AppError.business(field, `Selected ${label} does not exist.`);
  await assertInScope(user, rec[ownerField]).catch(() => { throw AppError.business(field, `You do not have access to the selected ${label}.`); });
  return rec._id;
}

async function resolveRefs(user, data) {
  return {
    customer: await checkRef(user, Customer, data.customerId, 'owner', 'customerId', 'customer'),
    lead: await checkRef(user, Lead, data.leadId, 'assignedTo', 'leadId', 'lead'),
    opportunity: await checkRef(user, Opportunity, data.opportunityId, 'assignedTo', 'opportunityId', 'opportunity')
  };
}

async function buildFilter(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  if (q.search) filter.subject = new RegExp(escapeRegex(q.search), 'i');
  if (q.activityType) filter.activityType = String(q.activityType);
  if (q.status) filter.status = String(q.status);
  if (q.customerId && isValidId(q.customerId)) filter.customer = q.customerId;
  if (q.leadId && isValidId(q.leadId)) filter.lead = q.leadId;
  if (q.assignedToId && isValidId(q.assignedToId)) {
    if (filter.assignedTo && !filter.assignedTo.$in.some((i) => String(i) === q.assignedToId)) filter.assignedTo = { $in: [] };
    else filter.assignedTo = q.assignedToId;
  }
  Object.assign(filter, dateFilter('activityDate', resolveRange(q)));
  return filter;
}

async function list(user, q) {
  const { page, limit, skip, sort } = parseListQuery(q, ['activityDate', 'activityType', 'subject', 'status', 'createdDate'], '-activityDate');
  const filter = await buildFilter(user, q);
  const [items, total] = await Promise.all([
    Activity.find(filter).populate(populate).sort(sort).skip(skip).limit(limit),
    Activity.countDocuments(filter)
  ]);
  return { items: items.map(toActivityDTO), meta: pageMeta(page, limit, total) };
}

async function load(user, id) {
  if (!isValidId(id)) throw AppError.notFound('Activity');
  const a = await Activity.findOne({ _id: id, isDeleted: false }).populate(populate);
  if (!a) throw AppError.notFound('Activity');
  await assertInScope(user, a.assignedTo._id || a.assignedTo);
  return a;
}

async function create(user, data, req) {
  const refs = await resolveRefs(user, data);
  const assignedTo = await resolveAssignee(user, data.assignedToId);
  const a = await Activity.create({
    activityType: data.activityType, subject: data.subject, description: data.description || '',
    activityDate: data.activityDate, status: data.status, ...refs, assignedTo, createdBy: user._id, modifiedBy: user._id
  });
  if (data.status === 'Completed') {
    if (refs.customer) await Customer.updateOne({ _id: refs.customer }, { $set: { lastActivityAt: data.activityDate } });
    if (refs.lead) await Lead.updateOne({ _id: refs.lead }, { $set: { lastActivityAt: data.activityDate } });
  }
  await a.populate(populate);
  await audit.log(req, { action: 'Create', entityName: 'Activity', recordId: a._id, newValue: toActivityDTO(a) });
  return a;
}

async function update(user, id, data, req) {
  const a = await load(user, id);
  const before = a.toObject({ depopulate: true });
  const refs = await resolveRefs(user, data);
  const assignedTo = data.assignedToId && String(data.assignedToId) !== String(a.assignedTo._id)
    ? await resolveAssignee(user, data.assignedToId) : a.assignedTo._id;
  Object.assign(a, {
    activityType: data.activityType, subject: data.subject, description: data.description || '',
    activityDate: data.activityDate, status: data.status, ...refs, assignedTo, modifiedBy: user._id
  });
  const changes = diff(before, a.toObject({ depopulate: true }), ['activityType', 'subject', 'description', 'activityDate', 'status', 'customer', 'lead', 'opportunity', 'assignedTo']);
  if (!changes.changed.length) return a;
  await a.save();
  await a.populate(populate);
  await audit.log(req, { action: 'Update', entityName: 'Activity', recordId: a._id, oldValue: changes.oldValue, newValue: changes.newValue });
  return a;
}

async function remove(user, id, req) {
  const a = await load(user, id);
  a.isDeleted = true; a.deletedAt = new Date(); a.deletedBy = user._id;
  await a.save();
  await audit.log(req, { action: 'Delete', entityName: 'Activity', recordId: a._id, oldValue: toActivityDTO(a) });
}

module.exports = { list, load, create, update, remove, buildFilter };
