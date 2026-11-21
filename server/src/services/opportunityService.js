const { Opportunity, Customer, Lead, FollowUp, Activity, AuditLog, nextCode } = require('../models');
const AppError = require('../utils/AppError');
const audit = require('./auditService');
const { scopeFilter, assertInScope, resolveAssignee } = require('./scopeService');
const { escapeRegex, parseListQuery, pageMeta, diff, startOfToday, resolveRange, dateFilter, isValidId } = require('../utils/helpers');
const { toOpportunityDTO, toFollowUpDTO, toActivityDTO, toAuditDTO } = require('../dtos');
const { OPPORTUNITY_ACTIVE_STAGES, STAGE_DEFAULT_PROBABILITY } = require('../config/constants');

const FIELDS = ['opportunityName', 'customer', 'lead', 'amount', 'stage', 'probability', 'expectedCloseDate', 'status', 'source', 'assignedTo', 'notes', 'outcomeReason'];
const populate = [{ path: 'customer', select: 'customerName customerCode' }, { path: 'assignedTo', select: 'name' }, { path: 'createdBy', select: 'name' }, { path: 'history.by', select: 'name' }];

const isActiveStage = (stage) => OPPORTUNITY_ACTIVE_STAGES.includes(stage);
const statusForStage = (stage) => (stage === 'Won' ? 'Won' : stage === 'Lost' ? 'Lost' : 'Open');

/**
 * Business validation (sections 4.8, 5.3, 5.4, 17.7). Uses the exact
 * messages recommended by the specification. Throws a 400 listing every
 * violated rule so the UI can highlight each field.
 */
function validateRules({ amount, probability, stage, expectedCloseDate }) {
  const errors = [];
  const amt = Number(amount);
  if (Number.isNaN(amt)) errors.push({ field: 'amount', message: 'Opportunity Amount must be a number.' });
  else if (amt < 0) errors.push({ field: 'amount', message: 'Opportunity Amount cannot be negative.' });
  else if (isActiveStage(stage) && amt <= 0) errors.push({ field: 'amount', message: 'Opportunity Amount must be greater than 0.' });

  const p = Number(probability);
  if (Number.isNaN(p) || p < 0 || p > 100) errors.push({ field: 'probability', message: 'Probability must be between 0 and 100.' });

  const d = new Date(expectedCloseDate);
  if (!expectedCloseDate || Number.isNaN(d.getTime())) errors.push({ field: 'expectedCloseDate', message: 'Expected Close Date must be a valid date.' });
  else if (isActiveStage(stage) && d < startOfToday()) errors.push({ field: 'expectedCloseDate', message: 'Expected Close Date cannot be in the past.' });

  if (errors.length) throw new AppError(400, errors[0].message, 'BUSINESS_RULE_VIOLATION', errors);
}

async function buildFilter(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const custIds = await Customer.find({ customerName: rx, isDeleted: false }).select('_id').limit(200);
    filter.$or = [{ opportunityName: rx }, { opportunityCode: rx }, { customer: { $in: custIds.map((c) => c._id) } }];
  }
  if (q.opportunityName) filter.opportunityName = new RegExp(escapeRegex(q.opportunityName), 'i');
  if (q.customer) {
    const custIds = await Customer.find({ customerName: new RegExp(escapeRegex(q.customer), 'i') }).select('_id').limit(200);
    filter.customer = { $in: custIds.map((c) => c._id) };
  }
  if (q.customerId && isValidId(q.customerId)) filter.customer = q.customerId;
  if (q.stage) filter.stage = String(q.stage);
  if (q.status) filter.status = String(q.status);
  if (q.assignedToId && isValidId(q.assignedToId)) {
    if (filter.assignedTo && !filter.assignedTo.$in.some((i) => String(i) === q.assignedToId)) filter.assignedTo = { $in: [] };
    else filter.assignedTo = q.assignedToId;
  }
  Object.assign(filter, dateFilter(q.dateField === 'expectedCloseDate' ? 'expectedCloseDate' : 'createdDate', resolveRange(q)));
  return filter;
}

async function list(user, q) {
  const { page, limit, skip, sort } = parseListQuery(q, ['opportunityCode', 'opportunityName', 'amount', 'stage', 'probability', 'expectedCloseDate', 'status', 'createdDate'], '-createdDate');
  const filter = await buildFilter(user, q);
  const [items, total] = await Promise.all([
    Opportunity.find(filter).populate(populate).sort(sort).skip(skip).limit(limit),
    Opportunity.countDocuments(filter)
  ]);
  return { items: items.map((o) => toOpportunityDTO(o)), meta: pageMeta(page, limit, total) };
}

async function load(user, id) {
  if (!isValidId(id)) throw AppError.notFound('Opportunity');
  const o = await Opportunity.findOne({ _id: id, isDeleted: false }).populate(populate);
  if (!o) throw AppError.notFound('Opportunity');
  await assertInScope(user, o.assignedTo._id || o.assignedTo);
  return o;
}

/** Foreign-key validation: referenced customer/lead must exist and be within the user's scope. */
async function resolveRefs(user, { customerId, leadId }) {
  const customer = await Customer.findOne({ _id: customerId, isDeleted: false });
  if (!customer) throw AppError.business('customerId', 'Selected customer does not exist.');
  await assertInScope(user, customer.owner).catch(() => { throw AppError.business('customerId', 'You do not have access to the selected customer.'); });
  let lead = null;
  if (leadId) {
    lead = await Lead.findOne({ _id: leadId, isDeleted: false });
    if (!lead) throw AppError.business('leadId', 'Selected lead does not exist.');
    await assertInScope(user, lead.assignedTo).catch(() => { throw AppError.business('leadId', 'You do not have access to the selected lead.'); });
  }
  return { customer, lead };
}

async function create(user, data, req, { auditDetails = '' } = {}) {
  const stage = data.stage || 'Qualification';
  if (!isActiveStage(stage)) throw AppError.business('stage', 'New opportunities must start in Qualification, Proposal or Negotiation.');
  const probability = data.probability ?? STAGE_DEFAULT_PROBABILITY[stage];
  validateRules({ amount: data.amount, probability, stage, expectedCloseDate: data.expectedCloseDate });
  const { customer, lead } = await resolveRefs(user, data);
  const assignedTo = await resolveAssignee(user, data.assignedToId);

  const o = await Opportunity.create({
    opportunityCode: await nextCode('opportunity', 'OPP'),
    opportunityName: data.opportunityName, customer: customer._id, lead: lead?._id || null,
    amount: data.amount, stage, probability, expectedCloseDate: data.expectedCloseDate,
    status: 'Open', source: data.source || lead?.source || '', assignedTo, notes: data.notes || '',
    createdBy: user._id, modifiedBy: user._id,
    history: [{ action: 'Created', to: stage, by: user._id, note: auditDetails || undefined }]
  });
  await o.populate(populate);
  await audit.log(req, { action: 'Create', entityName: 'Opportunity', recordId: o._id, newValue: toOpportunityDTO(o), details: auditDetails });
  return o;
}

function applyStage(o, stage, { probability, outcomeReason }, user) {
  if (o.stage === stage) return false;
  if (!isActiveStage(o.stage)) throw AppError.conflict('Closed (Won/Lost) opportunities cannot be modified.', 'stage');
  const from = o.stage;
  o.stage = stage;
  o.status = statusForStage(stage);
  if (stage === 'Won') { o.probability = 100; o.closedDate = new Date(); }
  else if (stage === 'Lost') {
    if (!outcomeReason) throw AppError.business('outcomeReason', 'Outcome Reason is required when marking an opportunity as Lost.');
    o.probability = 0; o.closedDate = new Date();
  } else if (probability === undefined || probability === null || probability === '') o.probability = STAGE_DEFAULT_PROBABILITY[stage];
  if (outcomeReason) o.outcomeReason = outcomeReason;
  o.history.push({ action: stage === 'Won' || stage === 'Lost' ? `Marked ${stage}` : 'StageChange', from, to: stage, by: user._id, note: outcomeReason || undefined });
  return true;
}

async function update(user, id, data, req) {
  const o = await load(user, id);
  if (!isActiveStage(o.stage)) throw AppError.conflict('Closed (Won/Lost) opportunities cannot be modified.');
  const before = o.toObject({ depopulate: true });
  const { customer, lead } = await resolveRefs(user, data);
  const assignedTo = data.assignedToId && String(data.assignedToId) !== String(o.assignedTo._id)
    ? await resolveAssignee(user, data.assignedToId) : o.assignedTo._id;

  Object.assign(o, {
    opportunityName: data.opportunityName, customer: customer._id, lead: lead?._id || null,
    amount: data.amount, expectedCloseDate: data.expectedCloseDate, source: data.source || '',
    assignedTo, notes: data.notes || '', modifiedBy: user._id
  });
  if (data.probability !== undefined && data.probability !== null && data.probability !== '') o.probability = data.probability;
  const stageChanged = applyStage(o, data.stage, data, user);
  // Business rules apply to the resulting state (close-date rule only for active stages)
  validateRules({ amount: o.amount, probability: o.probability, stage: o.stage, expectedCloseDate: o.expectedCloseDate });

  const changes = diff(before, o.toObject({ depopulate: true }), FIELDS);
  if (!changes.changed.length) return o;
  o.history.push({ action: 'Updated', note: `Changed: ${changes.changed.join(', ')}`, by: user._id });
  await o.save();
  await o.populate(populate);
  await audit.log(req, { action: 'Update', entityName: 'Opportunity', recordId: o._id, oldValue: changes.oldValue, newValue: changes.newValue });
  if (stageChanged) {
    await audit.log(req, { action: 'StageChange', entityName: 'Opportunity', recordId: o._id, oldValue: { stage: before.stage }, newValue: { stage: o.stage, status: o.status, outcomeReason: o.outcomeReason } });
  }
  return o;
}

/** Pipeline move (drag & drop / stage buttons) and Won/Lost outcome capture. */
async function changeStage(user, id, { stage, probability, outcomeReason }, req) {
  const o = await load(user, id);
  const before = { stage: o.stage, status: o.status, probability: o.probability };
  if (probability !== undefined && probability !== null && probability !== '' && isActiveStage(stage)) o.probability = probability;
  const changed = applyStage(o, stage, { probability, outcomeReason }, user);
  if (!changed && probability === undefined) return o;
  validateRules({ amount: o.amount, probability: o.probability, stage: o.stage, expectedCloseDate: o.expectedCloseDate });
  o.modifiedBy = user._id;
  await o.save();
  await o.populate(populate);
  await audit.log(req, { action: 'StageChange', entityName: 'Opportunity', recordId: o._id, oldValue: before, newValue: { stage: o.stage, status: o.status, probability: o.probability, outcomeReason: o.outcomeReason } });
  return o;
}

async function remove(user, id, req) {
  const o = await load(user, id);
  o.isDeleted = true; o.deletedAt = new Date(); o.deletedBy = user._id;
  o.history.push({ action: 'Deleted', by: user._id });
  await o.save();
  await FollowUp.updateMany({ opportunity: o._id, status: 'Planned', isDeleted: false }, { $set: { status: 'Cancelled' } });
  await audit.log(req, { action: 'Delete', entityName: 'Opportunity', recordId: o._id, oldValue: toOpportunityDTO(o), details: 'Soft-deleted; planned follow-ups cancelled' });
}

async function details(user, id) {
  const o = await load(user, id);
  const [followUps, activities, auditTrail] = await Promise.all([
    FollowUp.find({ opportunity: o._id, isDeleted: false }).populate('assignedTo', 'name').sort('-followUpDate'),
    Activity.find({ opportunity: o._id, isDeleted: false }).populate('assignedTo', 'name').sort('-activityDate'),
    AuditLog.find({ entityName: 'Opportunity', recordId: o._id.toString() }).sort('-createdDate').limit(50)
  ]);
  return {
    opportunity: toOpportunityDTO(o, { withHistory: true }),
    followUps: followUps.map((f) => toFollowUpDTO(f)),
    activities: activities.map(toActivityDTO),
    auditTrail: auditTrail.map(toAuditDTO)
  };
}

/** Kanban data: open + recently closed opportunities grouped by stage with totals. */
async function pipeline(user, q) {
  const filter = await buildFilter(user, { ...q, page: 1 });
  const items = await Opportunity.find(filter).populate(populate).sort('expectedCloseDate').limit(500);
  const stages = ['Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
  return stages.map((stage) => {
    const list = items.filter((o) => o.stage === stage).map((o) => toOpportunityDTO(o));
    return {
      stage,
      count: list.length,
      amount: list.reduce((s, o) => s + o.amount, 0),
      weightedAmount: Math.round(list.reduce((s, o) => s + o.weightedAmount, 0) * 100) / 100,
      items: list
    };
  });
}

async function lookup(user, q) {
  const filter = { isDeleted: false, ...(await scopeFilter(user, 'assignedTo')) };
  if (q.search) filter.opportunityName = new RegExp(escapeRegex(q.search), 'i');
  if (q.open === 'true') filter.status = 'Open';
  const items = await Opportunity.find(filter).select('opportunityName opportunityCode').sort('opportunityName').limit(50);
  return items.map((o) => ({ id: o._id.toString(), name: o.opportunityName, code: o.opportunityCode }));
}

module.exports = { list, load, create, update, changeStage, remove, details, pipeline, lookup, validateRules, buildFilter };
