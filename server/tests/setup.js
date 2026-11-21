process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';
process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/acxiomcrm_test';

const mongoose = require('mongoose');
const request = require('supertest');
const { connectDB } = require('../src/config/db');
const { ensureRoles } = require('../src/seed/roles');
const app = require('../src/app');
const { User, Role } = require('../src/models');
const pwd = require('../src/services/passwordService');

const PASSWORD = 'Test@Pass123';

async function startDb() {
  await connectDB(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await ensureRoles();
}

async function createUser(username, roleName, extra = {}) {
  const role = await Role.findOne({ roleName });
  return User.create({ name: `${username} user`, username, email: `${username}@test.local`, role: role._id, passwordHash: await pwd.hash(PASSWORD), ...extra });
}

/** Returns a supertest agent that is logged in and carries the anti-forgery token. */
async function agentFor(login, password = PASSWORD) {
  const agent = request.agent(app);
  const csrfRes = await agent.get('/api/auth/csrf');
  let csrf = csrfRes.body.data.csrfToken;
  const res = await agent.post('/api/auth/login').set('X-XSRF-TOKEN', csrf).send({ login, password });
  const setCookies = res.headers['set-cookie'] || [];
  const rotated = setCookies.find((c) => c.startsWith('XSRF-TOKEN='));
  if (rotated) csrf = decodeURIComponent(rotated.split(';')[0].split('=')[1]);
  const wrap = (method) => (url) => agent[method](url).set('X-XSRF-TOKEN', csrf);
  return { agent, res, csrf, get: (u) => agent.get(u), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete') };
}

const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

module.exports = { app, request, mongoose, startDb, createUser, agentFor, PASSWORD, isoDate };
