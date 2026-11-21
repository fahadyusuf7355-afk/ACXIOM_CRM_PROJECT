/** Final Acceptance Scenario (section 17.19) – automated. Requires a running MongoDB. */
const { app, request, mongoose, startDb, createUser, agentFor, isoDate } = require('./setup');
const { AuditLog, User } = require('../src/models');

let admin, mgr, sales, sales2, customerId;

beforeAll(async () => {
  await startDb();
  const m = await createUser('mgr', 'Manager');
  await createUser('admin', 'Admin');
  await createUser('sales', 'SalesExecutive', { manager: m._id });
  await createUser('sales2', 'SalesExecutive');
  admin = await agentFor('admin'); mgr = await agentFor('mgr'); sales = await agentFor('sales'); sales2 = await agentFor('sales2');
});
afterAll(() => mongoose.disconnect());

test('1. protected pages are not accessible anonymously', async () => {
  expect((await request(app).get('/api/customers')).status).toBe(401);
});

test('2. register → session established', async () => {
  const a = request.agent(app);
  const csrf = (await a.get('/api/auth/csrf')).body.data.csrfToken;
  const r = await a.post('/api/auth/register').set('X-XSRF-TOKEN', csrf).send({ name: 'New User', username: 'newuser', email: 'new@test.local', password: 'Strong@Pass9', confirmPassword: 'Strong@Pass9' });
  expect(r.status).toBe(201);
  expect(r.body.data.role).toBe('SalesExecutive');
  expect((await a.get('/api/dashboard')).status).toBe(200);
  const u = await User.findOne({ username: 'newuser' }).select('+passwordHash');
  expect(u.passwordHash).not.toBe('Strong@Pass9');
  expect(u.passwordHash.startsWith('$2')).toBe(true);
});

test('weak password rejected by policy', async () => {
  const a = request.agent(app);
  const csrf = (await a.get('/api/auth/csrf')).body.data.csrfToken;
  const r = await a.post('/api/auth/register').set('X-XSRF-TOKEN', csrf).send({ name: 'Weak', username: 'weak', email: 'weak@test.local', password: 'password', confirmPassword: 'password' });
  expect(r.status).toBe(400);
});

test('missing anti-forgery token is rejected', async () => {
  expect((await sales.agent.post('/api/customers').send({})).status).toBe(403);
});

test('4. server rejects invalid email/phone; duplicates → 409', async () => {
  const bad = await sales.post('/api/customers').send({ customerName: 'X', email: 'bad', phone: '123', status: 'Active' });
  expect(bad.status).toBe(400);
  const fields = bad.body.error.details.map((d) => d.field);
  expect(fields).toEqual(expect.arrayContaining(['email', 'phone']));
  const ok = await sales.post('/api/customers').send({ customerName: 'Acme Buyer', email: 'buyer@acme.in', phone: '9876543210', companyName: 'Acme', status: 'Active' });
  expect(ok.status).toBe(201);
  customerId = ok.body.data.id;
  expect(ok.body.data.passwordHash).toBeUndefined();
  const dup = await sales.post('/api/customers').send({ customerName: 'Other', email: 'buyer@acme.in', phone: '9876543211', status: 'Active' });
  expect(dup.status).toBe(409);
});

test('5–7. opportunity amount / probability / close date rules', async () => {
  const base = { opportunityName: 'Deal', customerId, stage: 'Proposal', expectedCloseDate: isoDate(10) };
  const r1 = await sales.post('/api/opportunities').send({ ...base, amount: 0, probability: 50 });
  expect(r1.status).toBe(400); expect(r1.body.error.message).toBe('Opportunity Amount must be greater than 0.');
  const r2 = await sales.post('/api/opportunities').send({ ...base, amount: 1000, probability: 101 });
  expect(r2.status).toBe(400); expect(r2.body.error.message).toBe('Probability must be between 0 and 100.');
  const r3 = await sales.post('/api/opportunities').send({ ...base, amount: 1000, probability: 50, expectedCloseDate: isoDate(-1) });
  expect(r3.status).toBe(400); expect(r3.body.error.message).toBe('Expected Close Date cannot be in the past.');
  const ok = await sales.post('/api/opportunities').send({ ...base, amount: 1000, probability: 50 });
  expect(ok.status).toBe(201); expect(ok.body.data.weightedAmount).toBe(500);
});

test('8. follow-up before today rejected', async () => {
  const r = await sales.post('/api/followups').send({ subject: 'Call', followUpType: 'Call', followUpDate: isoDate(-1), relatedType: 'Customer', relatedId: customerId });
  expect(r.status).toBe(400); expect(r.body.error.message).toBe('Follow-up date cannot be earlier than today.');
  const ok = await sales.post('/api/followups').send({ subject: 'Call', followUpType: 'Call', followUpDate: isoDate(1), relatedType: 'Customer', relatedId: customerId });
  expect(ok.status).toBe(201);
  const done = await sales.patch(`/api/followups/${ok.body.data.id}/complete`).send({ outcome: 'Spoke to client' });
  expect(done.body.data.status).toBe('Completed');
});

test('lead workflow: invalid transition blocked, conversion works', async () => {
  const l = await sales.post('/api/leads').send({ leadName: 'Lead One', email: 'lead1@x.in', source: 'Website', priority: 'High', expectedValue: 5000 });
  expect(l.status).toBe(201);
  const id = l.body.data.id;
  expect((await sales.patch(`/api/leads/${id}/status`).send({ status: 'Qualified' })).status).toBe(400);
  await sales.patch(`/api/leads/${id}/status`).send({ status: 'Contacted' });
  await sales.patch(`/api/leads/${id}/status`).send({ status: 'Qualified' });
  const c = await sales.post(`/api/leads/${id}/convert`).send({ customer: { customerName: 'Lead One', email: 'lead1@x.in', phone: '9123456780' }, createOpportunity: true, opportunity: { opportunityName: 'From lead', amount: 5000, probability: 20, expectedCloseDate: isoDate(30) } });
  expect(c.status).toBe(201);
  expect(c.body.data.lead.status).toBe('Converted');
  expect(await AuditLog.exists({ action: 'Convert' })).toBeTruthy();
});

test('9–11. role scope and admin areas', async () => {
  expect((await sales2.get(`/api/customers/${customerId}`)).status).toBe(403);
  expect((await sales2.get('/api/customers')).body.data.length).toBe(0);
  expect((await mgr.get(`/api/customers/${customerId}`)).status).toBe(200); // team member's record
  expect((await mgr.get('/api/reports/pipeline')).status).toBe(200);
  expect((await sales.get('/api/users')).status).toBe(403);
  expect((await sales.get('/api/audit-logs')).status).toBe(403);
  expect((await mgr.get('/api/audit-logs')).status).toBe(403);
  expect((await admin.get('/api/audit-logs')).status).toBe(200);
  expect((await admin.get('/api/users')).status).toBe(200);
});

test('12. CRUD creates audit entries', async () => {
  await sales.put(`/api/customers/${customerId}`).send({ customerName: 'Acme Buyer', email: 'buyer@acme.in', phone: '9876543210', companyName: 'Acme', status: 'Inactive' });
  const r = await admin.get(`/api/audit-logs?module=Customer`);
  const actions = r.body.data.map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining(['Create', 'Update', 'StatusChange']));
});

test('13–14. API JSON + dashboard', async () => {
  const r = await admin.get('/api/customers');
  expect(r.status).toBe(200); expect(Array.isArray(r.body.data)).toBe(true);
  const d = await sales.get('/api/dashboard');
  expect(d.body.data.cards).toHaveProperty('totalPipelineValue');
  expect(d.body.data.charts.leadStatus.length).toBeGreaterThan(0);
});

test('lockout after repeated failed logins', async () => {
  await createUser('victim', 'SalesExecutive');
  const a = request.agent(app);
  const csrf = (await a.get('/api/auth/csrf')).body.data.csrfToken;
  let last;
  for (let i = 0; i < 5; i++) last = await a.post('/api/auth/login').set('X-XSRF-TOKEN', csrf).send({ login: 'victim', password: 'Wrong@123x' });
  expect(last.status).toBe(423);
  const again = await a.post('/api/auth/login').set('X-XSRF-TOKEN', csrf).send({ login: 'victim', password: 'Test@Pass123' });
  expect(again.status).toBe(423);
  expect(await AuditLog.exists({ action: 'AccountLocked' })).toBeTruthy();
});

test('logout terminates session', async () => {
  const s = await agentFor('sales2');
  expect((await s.post('/api/auth/logout')).status).toBe(200);
  expect((await s.get('/api/customers')).status).toBe(401);
});
