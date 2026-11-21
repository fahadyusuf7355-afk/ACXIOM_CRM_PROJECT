const AuditLog = require('../models/AuditLog');
const { scrub, clientIp } = require('../utils/helpers');
const config = require('../config');

/**
 * Writes an append-only audit record. Sensitive values (passwords, hashes,
 * tokens) are scrubbed before saving. Failures to audit never break the
 * business request but are reported to the server console.
 */
async function log(req, { action, entityName, recordId = null, oldValue = null, newValue = null, result = 'Success', details = '', user }) {
  try {
    const actor = user || req?.user || null;
    await AuditLog.create({
      user: actor?._id || null,
      userName: actor ? `${actor.name} (${actor.username})` : 'Anonymous',
      action,
      entityName,
      recordId: recordId ? String(recordId) : null,
      oldValue: oldValue ? scrub(oldValue) : null,
      newValue: newValue ? scrub(newValue) : null,
      result,
      details: String(details || '').slice(0, 1000),
      ipAddress: req ? clientIp(req) : '',
      userAgent: req?.headers?.['user-agent']?.slice(0, 300) || ''
    });
  } catch (e) {
    if (!config.isTest) console.error('Audit write failed:', e.message);
  }
}

module.exports = { log };
