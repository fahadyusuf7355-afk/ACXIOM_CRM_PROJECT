const rateLimit = require('express-rate-limit');
const config = require('../config');

const rateLimitHandler = (req, res) => res.status(429).json({
  success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please wait a few minutes and try again.' }
});

/** Throttle authentication-sensitive endpoints (login, register, token). */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMinutes * 60 * 1000,
  limit: config.isTest ? 10000 : config.rateLimit.authMax,
  standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimitHandler
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, limit: config.isTest ? 100000 : 600,
  standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimitHandler
});

/** Strip keys beginning with `$` or containing `.` from JSON bodies (NoSQL operator injection). */
function sanitizeBody(req, res, next) {
  const clean = (o) => {
    if (Array.isArray(o)) return o.map(clean);
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (k.startsWith('$') || k.includes('.')) delete o[k];
        else o[k] = clean(o[k]);
      }
    }
    return o;
  };
  if (req.body) clean(req.body);
  next();
}

/** Query string values must be scalars – reject arrays/objects (e.g. ?status[$ne]=x). */
function flattenQuery(req, res, next) {
  for (const k of Object.keys(req.query)) {
    const v = req.query[k];
    if (typeof v !== 'string') req.query[k] = Array.isArray(v) ? String(v[0]) : undefined;
  }
  next();
}

module.exports = { authLimiter, apiLimiter, sanitizeBody, flattenQuery };
