const crypto = require('crypto');
const config = require('../config');
const AppError = require('../utils/AppError');

/**
 * Anti-forgery protection (equivalent of ValidateAntiForgeryToken).
 * Signed double-submit-cookie pattern: the server issues a token
 * `<random>.<hmac>` in a JS-readable cookie; the SPA echoes it in the
 * X-XSRF-TOKEN header. A cross-site attacker can neither read the cookie nor
 * forge the HMAC, so state-changing requests from other origins are rejected.
 * The session cookie itself is httpOnly + SameSite=Strict as a second layer.
 * Requests authenticated with a Bearer header carry no ambient credentials and
 * are therefore exempt.
 */
const sign = (value) => crypto.createHmac('sha256', config.csrf.secret).update(value).digest('base64url');

function issueToken(res) {
  const raw = crypto.randomBytes(24).toString('base64url');
  const token = `${raw}.${sign(raw)}`;
  res.cookie(config.csrf.cookieName, token, {
    httpOnly: false, sameSite: 'strict', secure: config.isProduction, path: '/'
  });
  return token;
}

function isValid(token) {
  if (typeof token !== 'string') return false;
  const [raw, mac] = token.split('.');
  if (!raw || !mac) return false;
  const expected = sign(raw);
  return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

const SAFE = ['GET', 'HEAD', 'OPTIONS'];

function csrfProtection(req, res, next) {
  if (SAFE.includes(req.method)) return next();
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ') && !req.cookies?.[config.jwt.cookieName]) return next();
  const cookieToken = req.cookies?.[config.csrf.cookieName];
  const headerToken = req.headers[config.csrf.headerName];
  if (!cookieToken || !headerToken || cookieToken !== headerToken || !isValid(headerToken)) {
    return next(new AppError(403, 'Invalid or missing anti-forgery token. Refresh the page and try again.', 'CSRF_TOKEN_INVALID'));
  }
  next();
}

module.exports = { csrfProtection, issueToken };
