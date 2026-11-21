const bcrypt = require('bcryptjs');
const config = require('../config');
const AppError = require('../utils/AppError');

const P = config.passwordPolicy;

/** Adaptive hashing (bcrypt, configurable cost). Plain text is never stored or logged. */
const hash = (plain) => bcrypt.hash(plain, P.bcryptRounds);
const verify = (plain, hashed) => bcrypt.compare(plain, hashed || '');

// Used to equalise response time when the user does not exist (user enumeration).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 4);
const dummyVerify = (plain) => bcrypt.compare(plain, DUMMY_HASH);

/** Policy checks that need user context (in addition to the Joi complexity rules). */
function assertPolicy(plain, user = {}) {
  const lower = plain.toLowerCase();
  const parts = [user.username, (user.email || '').split('@')[0]].filter((p) => p && p.length >= 3);
  if (parts.some((p) => lower.includes(p.toLowerCase()))) {
    throw AppError.business('password', 'Password must not contain your username or email name.');
  }
}

/**
 * Sets a new password on a user document loaded with +passwordHash
 * +passwordHistory +tokenVersion. Prevents reuse of the last N passwords and
 * invalidates all existing sessions.
 */
async function setPassword(user, plain, field = 'newPassword') {
  assertPolicy(plain, user);
  const previous = [user.passwordHash, ...(user.passwordHistory || [])].filter(Boolean).slice(0, P.historyCount);
  for (const h of previous) {
    if (await verify(plain, h)) {
      throw AppError.business(field, `New password must not match any of your last ${P.historyCount} passwords.`);
    }
  }
  if (user.passwordHash) user.passwordHistory = [user.passwordHash, ...(user.passwordHistory || [])].slice(0, P.historyCount - 1);
  user.passwordHash = await hash(plain);
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
}

module.exports = { hash, verify, dummyVerify, assertPolicy, setPassword };
