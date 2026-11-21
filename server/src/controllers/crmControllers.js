/**
 * Thin HTTP controllers: translate requests into service calls and service
 * results into DTO responses with the correct status codes
 * (200 OK, 201 Created, 204 No Content; errors via the error handler).
 */
const customers = require('../services/customerService');
const leads = require('../services/leadService');
const opportunities = require('../services/opportunityService');
const followUps = require('../services/followUpService');
const activities = require('../services/activityService');
const { toCustomerDTO, toLeadDTO, toOpportunityDTO, toFollowUpDTO, toActivityDTO } = require('../dtos');

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const created = (res, data, message) => res.status(201).json({ success: true, message, data });

// ---------- Customers ----------
exports.customers = {
  list: async (req, res) => { const r = await customers.list(req.user, req.query); ok(res, r.items, { meta: r.meta }); },
  lookup: async (req, res) => ok(res, await customers.lookup(req.user, req.query)),
  get: async (req, res) => ok(res, toCustomerDTO(await customers.load(req.user, req.params.id))),
  details: async (req, res) => ok(res, await customers.details(req.user, req.params.id)),
  create: async (req, res) => created(res, toCustomerDTO(await customers.create(req.user, req.body, req)), 'Customer created successfully.'),
  update: async (req, res) => ok(res, toCustomerDTO(await customers.update(req.user, req.params.id, req.body, req)), { message: 'Customer updated successfully.' }),
  remove: async (req, res) => { await customers.remove(req.user, req.params.id, req); ok(res, null, { message: 'Customer deleted successfully.' }); }
};

// ---------- Leads ----------
exports.leads = {
  list: async (req, res) => { const r = await leads.list(req.user, req.query); ok(res, r.items, { meta: r.meta }); },
  lookup: async (req, res) => ok(res, await leads.lookup(req.user, req.query)),
  get: async (req, res) => ok(res, toLeadDTO(await leads.load(req.user, req.params.id))),
  details: async (req, res) => ok(res, await leads.details(req.user, req.params.id)),
  create: async (req, res) => created(res, toLeadDTO(await leads.create(req.user, req.body, req)), 'Lead created successfully.'),
  update: async (req, res) => ok(res, toLeadDTO(await leads.update(req.user, req.params.id, req.body, req)), { message: 'Lead updated successfully.' }),
  status: async (req, res) => ok(res, toLeadDTO(await leads.changeStatus(req.user, req.params.id, req.body, req)), { message: 'Lead status updated.' }),
  assign: async (req, res) => ok(res, toLeadDTO(await leads.assign(req.user, req.params.id, req.body, req)), { message: 'Lead assigned.' }),
  convert: async (req, res) => {
    const r = await leads.convert(req.user, req.params.id, req.body, req);
    created(res, { lead: toLeadDTO(r.lead), customer: toCustomerDTO(r.customer), opportunity: r.opportunity ? toOpportunityDTO(r.opportunity) : null }, 'Lead converted successfully.');
  },
  remove: async (req, res) => { await leads.remove(req.user, req.params.id, req); ok(res, null, { message: 'Lead deleted successfully.' }); }
};

// ---------- Opportunities ----------
exports.opportunities = {
  list: async (req, res) => { const r = await opportunities.list(req.user, req.query); ok(res, r.items, { meta: r.meta }); },
  lookup: async (req, res) => ok(res, await opportunities.lookup(req.user, req.query)),
  pipeline: async (req, res) => ok(res, await opportunities.pipeline(req.user, req.query)),
  get: async (req, res) => ok(res, toOpportunityDTO(await opportunities.load(req.user, req.params.id))),
  details: async (req, res) => ok(res, await opportunities.details(req.user, req.params.id)),
  create: async (req, res) => created(res, toOpportunityDTO(await opportunities.create(req.user, req.body, req)), 'Opportunity created successfully.'),
  update: async (req, res) => ok(res, toOpportunityDTO(await opportunities.update(req.user, req.params.id, req.body, req)), { message: 'Opportunity updated successfully.' }),
  stage: async (req, res) => ok(res, toOpportunityDTO(await opportunities.changeStage(req.user, req.params.id, req.body, req)), { message: 'Opportunity stage updated.' }),
  remove: async (req, res) => { await opportunities.remove(req.user, req.params.id, req); ok(res, null, { message: 'Opportunity deleted successfully.' }); }
};

// ---------- Follow-ups ----------
exports.followUps = {
  list: async (req, res) => { const r = await followUps.list(req.user, req.query); ok(res, r.items, { meta: r.meta }); },
  get: async (req, res) => ok(res, await followUps.details(req.user, req.params.id)),
  create: async (req, res) => created(res, toFollowUpDTO(await followUps.create(req.user, req.body, req)), 'Follow-up scheduled successfully.'),
  update: async (req, res) => ok(res, toFollowUpDTO(await followUps.update(req.user, req.params.id, req.body, req)), { message: 'Follow-up updated successfully.' }),
  complete: async (req, res) => ok(res, toFollowUpDTO(await followUps.complete(req.user, req.params.id, req.body, req)), { message: 'Follow-up completed.' }),
  missed: async (req, res) => ok(res, toFollowUpDTO(await followUps.markMissed(req.user, req.params.id, req.body, req)), { message: 'Follow-up marked as missed.' }),
  cancel: async (req, res) => ok(res, toFollowUpDTO(await followUps.cancel(req.user, req.params.id, req.body, req)), { message: 'Follow-up cancelled.' }),
  reschedule: async (req, res) => ok(res, toFollowUpDTO(await followUps.reschedule(req.user, req.params.id, req.body, req)), { message: 'Follow-up rescheduled.' }),
  remove: async (req, res) => { await followUps.remove(req.user, req.params.id, req); ok(res, null, { message: 'Follow-up deleted successfully.' }); },
  notifications: async (req, res) => ok(res, await followUps.notifications(req.user))
};

// ---------- Activities ----------
exports.activities = {
  list: async (req, res) => { const r = await activities.list(req.user, req.query); ok(res, r.items, { meta: r.meta }); },
  get: async (req, res) => ok(res, toActivityDTO(await activities.load(req.user, req.params.id))),
  create: async (req, res) => created(res, toActivityDTO(await activities.create(req.user, req.body, req)), 'Activity created successfully.'),
  update: async (req, res) => ok(res, toActivityDTO(await activities.update(req.user, req.params.id, req.body, req)), { message: 'Activity updated successfully.' }),
  remove: async (req, res) => { await activities.remove(req.user, req.params.id, req); ok(res, null, { message: 'Activity deleted successfully.' }); }
};
