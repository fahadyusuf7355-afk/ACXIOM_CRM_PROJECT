const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { User, Role, RevokedToken } = require('../models');
const AppError = require('../utils/AppError');
const pwd = require('./passwordService');
const audit = require('./auditService');
const { issueToken } = require('../middleware/csrf');
const { ROLES } = require('../config/constants');

const LOCK = config.lockout;

function signToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user._id.toString(), jti, tv: user.tokenVersion || 0 }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn, algorithm: 'HS256'
  });
  const { exp } = jwt.decode(token);
  return { token, jti, exp };
}

/** Secure session cookie: httpOnly (no JS access), SameSite=Strict, Secure in production. */
function setSessionCookie(res, user) {
  const { token, exp } = signToken(user);
  res.cookie(config.jwt.cookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: exp * 1000 - Date.now()
  });
  issueToken(res); // rotate anti-forgery token on every new session
}

function clearSession(res) {
  res.clearCookie(config.jwt.cookieName, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.isProduction });
  issueToken(res);
}

const loadWithSecrets = (filter) => User.findOne(filter).select('+passwordHash +passwordHistory +tokenVersion').populate('role');

async function register(data, req) {
  const exists = await User.findOne({ $or: [{ email: data.email }, { username: data.username }] }).lean();
  if (exists) {
    const field = exists.email === data.email ? 'email' : 'username';
    throw AppError.conflict(field === 'email' ? 'Email already exists.' : 'Username already exists.', field);
  }
  // Self-registration always receives the least-privileged role.
  const role = await Role.findOne({ roleName: ROLES.SALES });
  if (!role) throw new Error('Roles are not seeded');

  const user = new User({ name: data.name, username: data.username, email: data.email, phone: data.phone || '', role: role._id, isActive: true });
  await pwd.setPassword(user, data.password, 'password');
  user.passwordHistory = [];
  user.tokenVersion = 0;
  await user.save();
  await user.populate('role');
  await audit.log(req, { user, action: 'Register', entityName: 'Auth', recordId: user._id, newValue: { name: user.name, username: user.username, email: user.email, role: role.roleName } });
  return user;
}

async function login(identifier, password, req) {
  const id = String(identifier).trim().toLowerCase();
  const user = await loadWithSecrets({ $or: [{ email: id }, { username: id }] });

  if (!user) {
    await pwd.dummyVerify(password);
    await audit.log(req, { action: 'LoginFailed', entityName: 'Auth', result: 'Failure', details: `Unknown user "${id.slice(0, 60)}"` });
    throw AppError.unauthorized('Invalid username/email or password.');
  }

  if (user.lockoutEnd && user.lockoutEnd > new Date()) {
    const mins = Math.ceil((user.lockoutEnd - Date.now()) / 60000);
    await audit.log(req, { user, action: 'LoginFailed', entityName: 'Auth', recordId: user._id, result: 'Failure', details: 'Login attempted while account locked' });
    throw new AppError(423, `Your account is locked due to repeated failed login attempts. Try again in ${mins} minute(s) or contact an administrator.`, 'ACCOUNT_LOCKED');
  }

  const ok = await pwd.verify(password, user.passwordHash);
  if (!ok) {
    user.failedLoginCount = (user.failedLoginCount || 0) + 1;
    let locked = false;
    if (user.failedLoginCount >= LOCK.maxFailedAttempts) {
      user.lockoutEnd = new Date(Date.now() + LOCK.durationMinutes * 60000);
      user.failedLoginCount = 0;
      locked = true;
    }
    await user.save();
    await audit.log(req, { user, action: 'LoginFailed', entityName: 'Auth', recordId: user._id, result: 'Failure', details: 'Invalid password' });
    if (locked) {
      await audit.log(req, { user, action: 'AccountLocked', entityName: 'Auth', recordId: user._id, result: 'Failure', details: `Locked for ${LOCK.durationMinutes} minutes after ${LOCK.maxFailedAttempts} failed attempts` });
      throw new AppError(423, `Your account has been locked for ${LOCK.durationMinutes} minutes due to repeated failed login attempts.`, 'ACCOUNT_LOCKED');
    }
    throw AppError.unauthorized('Invalid username/email or password.');
  }

  if (!user.isActive) {
    await audit.log(req, { user, action: 'LoginFailed', entityName: 'Auth', recordId: user._id, result: 'Failure', details: 'Inactive account' });
    throw AppError.unauthorized('Your account has been deactivated. Contact an administrator.');
  }

  user.failedLoginCount = 0;
  user.lockoutEnd = null;
  user.lastLoginAt = new Date();
  await user.save();
  await audit.log(req, { user, action: 'Login', entityName: 'Auth', recordId: user._id });
  return user;
}

async function logout(req) {
  if (req.auth?.jti) {
    await RevokedToken.updateOne({ jti: req.auth.jti }, { $setOnInsert: { jti: req.auth.jti, expiresAt: new Date(req.auth.exp * 1000) } }, { upsert: true });
  }
  await audit.log(req, { action: 'Logout', entityName: 'Auth', recordId: req.user?._id });
}

async function changePassword(userId, { currentPassword, newPassword }, req) {
  const user = await loadWithSecrets({ _id: userId });
  if (!(await pwd.verify(currentPassword, user.passwordHash))) {
    await audit.log(req, { action: 'PasswordChange', entityName: 'Auth', recordId: user._id, result: 'Failure', details: 'Current password incorrect' });
    throw AppError.business('currentPassword', 'Current password is incorrect.');
  }
  await pwd.setPassword(user, newPassword);
  user.mustChangePassword = false;
  await user.save();
  await audit.log(req, { action: 'PasswordChange', entityName: 'Auth', recordId: user._id, details: 'User changed own password' });
  return user;
}

module.exports = { register, login, logout, changePassword, setSessionCookie, clearSession, signToken };
