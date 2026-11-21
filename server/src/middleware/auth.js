const jwt = require('jsonwebtoken');
const config = require('../config');
const { User, RevokedToken } = require('../models');
const AppError = require('../utils/AppError');
const audit = require('../services/auditService');

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return { token: header.slice(7), viaCookie: false };
  const cookie = req.cookies?.[config.jwt.cookieName];
  if (cookie) return { token: cookie, viaCookie: true };
  return { token: null };
}

/**
 * Authentication: verifies the session token (httpOnly cookie for the browser,
 * Bearer header for API clients), rejects revoked/expired sessions, inactive
 * users and sessions issued before a password/role change (tokenVersion).
 */
async function authenticate(req, res, next) {
  try {
    const { token, viaCookie } = extractToken(req);
    if (!token) throw AppError.unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    } catch {
      throw AppError.unauthorized('Your session has expired. Please sign in again.');
    }
    if (await RevokedToken.exists({ jti: payload.jti })) throw AppError.unauthorized('Your session has ended. Please sign in again.');

    const user = await User.findById(payload.sub).select('+tokenVersion').populate('role');
    if (!user || !user.isActive) throw AppError.unauthorized('Your account is not active.');
    if (user.tokenVersion !== payload.tv) throw AppError.unauthorized('Your session is no longer valid. Please sign in again.');

    req.user = user;
    req.auth = { jti: payload.jti, exp: payload.exp, viaCookie };
    next();
  } catch (e) { next(e); }
}

/** Blocks everything except password change when an admin has issued a temporary password. */
function requirePasswordCurrent(req, res, next) {
  if (req.user?.mustChangePassword) {
    return next(new AppError(403, 'You must change your temporary password before continuing.', 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
}

const hasPermission = (user, perm) => !!user?.role?.permissions?.includes(perm);

/** Server-side authorization: every protected endpoint declares the permission(s) it needs. */
const requirePermission = (...perms) => (req, res, next) => {
  if (perms.some((p) => hasPermission(req.user, p))) return next();
  audit.log(req, { action: 'AccessDenied', entityName: 'Security', result: 'Failure', details: `${req.method} ${req.originalUrl} requires ${perms.join(' or ')}` });
  next(AppError.forbidden());
};

const requireRole = (...roles) => (req, res, next) => {
  if (roles.includes(req.user?.role?.roleName)) return next();
  audit.log(req, { action: 'AccessDenied', entityName: 'Security', result: 'Failure', details: `${req.method} ${req.originalUrl} requires role ${roles.join('/')}` });
  next(AppError.forbidden());
};

module.exports = { authenticate, requirePasswordCurrent, requirePermission, requireRole, hasPermission };
