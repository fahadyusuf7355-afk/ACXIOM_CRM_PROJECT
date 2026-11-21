const { FollowUp, Customer, Lead, Opportunity, Activity } = require('../models');
const AppError = require('../utils/AppError');
const audit = require('./auditService');
const { scopeFilter, assertInScope, resolveAssignee } = require('./scopeService');
const { escapeRegex, parseListQuery, pageMeta, diff, startOfToday, resolveRange, dateFilter, isValidId } = require('../utils/helpers');
const { toFollowUpDTO } = require('../dtos');

const populate = [
  { path: 'assignedTo', select: 'name' },
  { path: 'customer', select: 'customerName' },
  { path: 'lead', select: 'leadName status' },
  { path: 'opportunity', select: 'opportunityName' },
  { path: 'history.by', select: 'name' }
];

/** Business rule (4.6 / 5.4): a new or planned follow-up cannot be dated before today. */
function assertDateNotPast(date, field = 'followUpDate') {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw AppError.business(field, 'Follow-up date must be a valid date.');
  if (d < startOfToday()) throw AppError.business(field, 'Follow-up date cannot be earlier than today.');
}

/** Loads the related CRM record, checks existence + scope, and returns FK fields. */
async function resolveRelated(user, relatedType, relatedId) {
  const map = {
    Customer: { model: Customer, owner: 'owner' },
    Lead: { model: Lead, owner: 'assignedTo' },
    Opportunity: { model: Opportunity, owner: 'assignedTo' }
  };
  const cfg = map[relatedType];
  const rec = await cfg.model.findOne({ _id: relatedId, isDeleted: false });
  if (!rec) throw AppError.business('relatedId', `Selected ${relatedType.toLowerCase()} does not exist.`);
  await assertInScope(user, rec[cfg.owner]).catch(() => { throw AppError.business('relatedId', `You do not have access to the selected ${relatedType.toLowerCase()}.`); });
  if (relatedType === 'Lead' && rec.status === 'Converted') throw AppError.business('relatedId', 'Follow-ups cannot be scheduled against a converted lead. Use the customer instead.');
  if (relatedType === 'Opportunity' && rec.status !== 'Open') throw AppError.business('relatedId', 'Follow-ups can only be scheduled for open opportunities.');
  return {
    record: rec,
    customer: relatedType === 'Customer' ? rec._id : relatedType === 'Opportunity' ? rec.customer : null,
    lead: relatedType === 'Lead' ? rec._id : relatedType === 'Opportunity' ? rec.lead : null,
    opportunity: relatedType === 'Opportunity' ? rec._id : null
  };
}

async function buildFilter(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  const now = new Date();
  if (q.search) filter.subject = new RegExp(escapeRegex(q.search), 'i');
  if (q.status) filter.status = String(q.status);
  if (q.followUpType) filter.followUpType = String(q.followUpType);
  if (q.relatedType) filter.relatedType = String(q.relatedType);
  if (q.customerId && isValidId(q.customerId)) filter.customer = q.customerId;
  if (q.leadId && isValidId(q.leadId)) filter.lead = q.leadId;
  if (q.related) {
    const rx = new RegExp(escapeRegex(q.related), 'i');
    const [cs, ls] = await Promise.all([
      Customer.find({ customerName: rx }).select('_id').limit(200),
      Lead.find({ leadName: rx }).select('_id').limit(200)
    ]);
    filter.$or = [{ customer: { $in: cs.map((c) => c._id) } }, { lead: { $in: ls.map((l) => l._id) } }];
  }
  if (q.assignedToId && isValidId(q.assignedToId)) {
    if (filter.assignedTo && !filter.assignedTo.$in.some((i) => String(i) === q.assignedToId)) filter.assignedTo = { $in: [] };
    else filter.assignedTo = q.assignedToId;
  }
  switch (q.view) {
    case 'pending': filter.status = 'Planned'; break;
    case 'upcoming': filter.status = 'Planned'; filter.followUpDate = { $gte: now }; break;
    case 'overdue': filter.status = 'Planned'; filter.followUpDate = { $lt: now }; break;
    case 'today': {
      const s = startOfToday();
      filter.status = 'Planned'; filter.followUpDate = { $gte: s, $lt: new Date(s.getTime() + 86400000) }; break;
    }
    default: break;
  }
  const range = resolveRange(q);
  if (range.from || range.to) {
    filter.followUpDate = { ...(filter.followUpDate || {}), ...dateFilter('followUpDate', range).followUpDate };
  }
  return filter;
}

async function list(user, q) {
  const { page, limit, skip, sort } = parseListQuery(q, ['followUpDate', 'subject', 'status', 'followUpType', 'createdDate'], 'followUpDate');
  const filter = await buildFilter(user, q);
  const [items, total] = await Promise.all([
    FollowUp.find(filter).populate(populate).sort(sort).skip(skip).limit(limit),
    FollowUp.countDocuments(filter)
  ]);
  return { items: items.map((f) => toFollowUpDTO(f)), meta: pageMeta(page, limit, total) };
}

async function load(user, id) {
  if (!isValidId(id)) throw AppError.notFound('Follow-up');
  const f = await FollowUp.findOne({ _id: id, isDeleted: false }).populate(populate);
  if (!f) throw AppError.notFound('Follow-up');
  await assertInScope(user, f.assignedTo._id || f.assignedTo);
  return f;
}

async function create(user, data, req) {
  assertDateNotPast(data.followUpDate);
  const rel = await resolveRelated(user, data.relatedType, data.relatedId);
  const assignedTo = await resolveAssignee(user, data.assignedToId);
  const f = await FollowUp.create({
    subject: data.subject, followUpType: data.followUpType, followUpDate: data.followUpDate, status: 'Planned',
    remarks: data.remarks || '', relatedType: data.relatedType, relatedId: rel.record._id,
    customer: rel.customer, lead: rel.lead, opportunity: rel.opportunity,
    assignedTo, createdBy: user._id, modifiedBy: user._id,
    history: [{ action: 'Scheduled', to: 'Planned', by: user._id, note: new Date(data.followUpDate).toISOString() }]
  });
  await f.populate(populate);
  await audit.log(req, { action: 'Create', entityName: 'FollowUp', recordId: f._id, newValue: toFollowUpDTO(f) });
  return f;
}

async function update(user, id, data, req) {
  const f = await load(user, id);
  if (f.status !== 'Planned') throw AppError.conflict(`Only planned follow-ups can be edited (current status: ${f.status}).`);
  const dateChanged = new Date(data.followUpDate).getTime() !== f.followUpDate.getTime();
  if (dateChanged) assertDateNotPast(data.followUpDate);
  const before = f.toObject({ depopulate: true });
  const assignedTo = data.assignedToId && String(data.assignedToId) !== String(f.assignedTo._id)
    ? await resolveAssignee(user, data.assignedToId) : f.assignedTo._id;
  Object.assign(f, { subject: data.subject, followUpType: data.followUpType, followUpDate: data.followUpDate, remarks: data.remarks || '', assignedTo, modifiedBy: user._id });
  const changes = diff(before, f.toObject({ depopulate: true }), ['subject', 'followUpType', 'followUpDate', 'remarks', 'assignedTo']);
  if (!changes.changed.length) return f;
  if (dateChanged) { f.rescheduleCount += 1; f.history.push({ action: 'Rescheduled', from: before.followUpDate.toISOString(), to: new Date(data.followUpDate).toISOString(), by: user._id }); }
  f.history.push({ action: 'Updated', note: `Changed: ${changes.changed.join(', ')}`, by: user._id });
  await f.save();
  await f.populate(populate);
  await audit.log(req, { action: dateChanged ? 'Reschedule' : 'Update', entityName: 'FollowUp', recordId: f._id, oldValue: changes.oldValue, newValue: changes.newValue });
  return f;
}

/** Workflow step 5: completing a follow-up logs an activity and updates the related CRM record. */
async function touchRelated(user, f, req) {
  const now = new Date();
  if (f.customer) await Customer.updateOne({ _id: f.customer._id || f.customer }, { $set: { lastActivityAt: now } });
  if (f.opportunity) await Opportunity.updateOne({ _id: f.opportunity._id || f.opportunity }, { $set: { lastActivityAt: now } });
  if (f.lead) {
    const lead = await Lead.findById(f.lead._id || f.lead);
    if (lead) {
      lead.lastActivityAt = now;
      if (lead.status === 'New') {
        lead.history.push({ action: 'StatusChange', from: 'New', to: 'Contacted', by: user._id, note: 'Automatic: follow-up completed' });
        lead.status = 'Contacted';
        await audit.log(req, { action: 'StatusChange', entityName: 'Lead', recordId: lead._id, oldValue: { status: 'New' }, newValue: { status: 'Contacted' }, details: 'Automatic transition after completed follow-up' });
      }
      await lead.save();
    }
  }
}

async function complete(user, id, { outcome }, req) {
  const f = await load(user, id);
  if (!['Planned', 'Missed'].includes(f.status)) throw AppError.conflict(`A ${f.status.toLowerCase()} follow-up cannot be completed.`);
  const from = f.status;
  f.status = 'Completed';
  f.outcome = outcome;
  f.completedAt = new Date();
  f.modifiedBy = user._id;
  f.history.push({ action: 'Completed', from, to: 'Completed', note: outcome, by: user._id });
  await f.save();

  const activityType = { Visit: 'Meeting' }[f.followUpType] || f.followUpType;
  await Activity.create({
    activityType, subject: `Follow-up: ${f.subject}`, description: outcome, activityDate: f.completedAt, status: 'Completed',
    customer: f.customer?._id || f.customer || null, lead: f.lead?._id || f.lead || null, opportunity: f.opportunity?._id || f.opportunity || null,
    followUp: f._id, assignedTo: f.assignedTo._id || f.assignedTo, createdBy: user._id
  });
  await touchRelated(user, f, req);
  await f.populate(populate);
  await audit.log(req, { action: 'Complete', entityName: 'FollowUp', recordId: f._id, oldValue: { status: from }, newValue: { status: 'Completed', outcome } });
  return f;
}

async function markMissed(user, id, { note }, req) {
  const f = await load(user, id);
  if (f.status !== 'Planned') throw AppError.conflict('Only planned follow-ups can be marked as missed.');
  f.status = 'Missed';
  f.modifiedBy = user._id;
  f.history.push({ action: 'Missed', from: 'Planned', to: 'Missed', note, by: user._id });
  await f.save();
  await f.populate(populate);
  await audit.log(req, { action: 'Missed', entityName: 'FollowUp', recordId: f._id, oldValue: { status: 'Planned' }, newValue: { status: 'Missed' }, details: note || '' });
  return f;
}

async function cancel(user, id, { note }, req) {
  const f = await load(user, id);
  if (!['Planned', 'Missed'].includes(f.status)) throw AppError.conflict(`A ${f.status.toLowerCase()} follow-up cannot be cancelled.`);
  const from = f.status;
  f.status = 'Cancelled';
  f.modifiedBy = user._id;
  f.history.push({ action: 'Cancelled', from, to: 'Cancelled', note, by: user._id });
  await f.save();
  await f.populate(populate);
  await audit.log(req, { action: 'Cancel', entityName: 'FollowUp', recordId: f._id, oldValue: { status: from }, newValue: { status: 'Cancelled' }, details: note || '' });
  return f;
}

async function reschedule(user, id, { followUpDate, note }, req) {
  const f = await load(user, id);
  if (!['Planned', 'Missed'].includes(f.status)) throw AppError.conflict(`A ${f.status.toLowerCase()} follow-up cannot be rescheduled.`);
  assertDateNotPast(followUpDate);
  const before = { status: f.status, followUpDate: f.followUpDate };
  f.history.push({ action: 'Rescheduled', from: f.followUpDate.toISOString(), to: new Date(followUpDate).toISOString(), note, by: user._id });
  f.followUpDate = followUpDate;
  f.status = 'Planned';
  f.rescheduleCount += 1;
  f.modifiedBy = user._id;
  await f.save();
  await f.populate(populate);
  await audit.log(req, { action: 'Reschedule', entityName: 'FollowUp', recordId: f._id, oldValue: before, newValue: { status: 'Planned', followUpDate: f.followUpDate }, details: note || '' });
  return f;
}

async function remove(user, id, req) {
  const f = await load(user, id);
  f.isDeleted = true; f.deletedAt = new Date(); f.deletedBy = user._id;
  await f.save();
  await audit.log(req, { action: 'Delete', entityName: 'FollowUp', recordId: f._id, oldValue: toFollowUpDTO(f) });
}

async function details(user, id) {
  const f = await load(user, id);
  return toFollowUpDTO(f, { withHistory: true });
}

/** Counts for the header notification bell. */
async function notifications(user) {
  const base = { isDeleted: false, status: 'Planned', ...(await scopeFilter(user, 'assignedTo')) };
  const now = new Date();
  const s = startOfToday();
  const e = new Date(s.getTime() + 86400000);
  const [overdue, today, items] = await Promise.all([
    FollowUp.countDocuments({ ...base, followUpDate: { $lt: now } }),
    FollowUp.countDocuments({ ...base, followUpDate: { $gte: now, $lt: e } }),
    FollowUp.find({ ...base, followUpDate: { $lt: e } }).populate(populate).sort('followUpDate').limit(8)
  ]);
  return { overdue, dueToday: today, items: items.map((f) => toFollowUpDTO(f)) };
}

module.exports = { list, load, create, update, complete, markMissed, cancel, reschedule, remove, details, notifications, buildFilter, assertDateNotPast };
