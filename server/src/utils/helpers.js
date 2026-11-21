const mongoose = require('mongoose');
const config = require('../config');

/** Wrap async route handlers so rejected promises reach the error handler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isValidId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id);

/** Escape user text before using it in a RegExp (prevents ReDoS / regex injection). */
const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);

/**
 * Returns midnight "today" in the configured application time zone, as a UTC
 * Date. Used for the "not earlier than today" / "not in the past" rules.
 */
function startOfToday(tz = config.timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  // Offset of tz relative to UTC at this moment
  const tzNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = tzNow.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const utcMidnight = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  return new Date(utcMidnight - offsetMs);
}

const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/** Resolve a dashboard/report date range keyword into { from, to }. */
function resolveRange({ range, from, to } = {}) {
  const today = startOfToday();
  switch (range) {
    case 'today': return { from: today, to: addDays(today, 1) };
    case 'week': {
      // Week starts Monday in the configured zone
      const dow = new Date(today.getTime() + 12 * 3600000).getUTCDay(); // noon of local day
      const monday = addDays(today, -((dow + 6) % 7));
      return { from: monday, to: addDays(monday, 7) };
    }
    case 'month': {
      const local = new Date(today.getTime() + 12 * 3600000);
      const day = local.getUTCDate();
      const first = addDays(today, -(day - 1));
      const nextMonthLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1));
      const daysInMonth = Math.round((nextMonthLocal - Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1)) / 86400000);
      return { from: first, to: addDays(first, daysInMonth) };
    }
    case 'custom': {
      const f = from ? new Date(from) : null;
      const t = to ? new Date(to) : null;
      return {
        from: f && !isNaN(f) ? f : undefined,
        to: t && !isNaN(t) ? addDays(t, 1) : undefined // inclusive end date
      };
    }
    default: return {};
  }
}

function dateFilter(field, { from, to }) {
  if (!from && !to) return {};
  const f = {};
  if (from) f.$gte = from;
  if (to) f.$lt = to;
  return { [field]: f };
}

/** Parse pagination & sorting query parameters with safe bounds. */
function parseListQuery(query, allowedSort, defaultSort = '-createdAt') {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  let sortKey = typeof query.sort === 'string' ? query.sort : defaultSort;
  const field = sortKey.replace(/^-/, '');
  if (!allowedSort.includes(field)) sortKey = defaultSort;
  const sort = { [sortKey.replace(/^-/, '')]: sortKey.startsWith('-') ? -1 : 1, _id: -1 };
  return { page, limit, skip: (page - 1) * limit, sort, sortKey };
}

const pageMeta = (page, limit, total) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

const SENSITIVE_KEYS = ['password', 'passwordHash', 'passwordHistory', 'tokenVersion', 'token', 'resetToken', 'currentPassword', 'newPassword', 'confirmPassword'];

/** Remove sensitive keys and Mongo internals from objects before auditing. */
function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (obj instanceof mongoose.Types.ObjectId) return obj.toString();
  if (Array.isArray(obj)) return obj.map(scrub);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(k) || k === '__v') continue;
    out[k] = scrub(v);
  }
  return out;
}

/** Compute changed fields between two plain objects. */
function diff(before, after, fields) {
  const oldValue = {}; const newValue = {};
  for (const f of fields) {
    const a = before?.[f]; const b = after?.[f];
    const norm = (v) => (v instanceof Date ? v.toISOString() : v && v.toString ? v.toString() : v);
    if (norm(a) !== norm(b)) { oldValue[f] = a ?? null; newValue[f] = b ?? null; }
  }
  return { oldValue: scrub(oldValue), newValue: scrub(newValue), changed: Object.keys(newValue) };
}

/** Build CSV text from rows and column definitions. Neutralises spreadsheet formula injection. */
function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

// req.ip honours the TRUST_PROXY setting in app.js, so a client cannot spoof it
// with an X-Forwarded-For header unless the app is deployed behind a known proxy.
const clientIp = (req) => req.ip || req.socket?.remoteAddress;

module.exports = { asyncHandler, isValidId, escapeRegex, startOfToday, addDays, resolveRange, dateFilter, parseListQuery, pageMeta, scrub, diff, toCsv, clientIp };
