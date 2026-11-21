const { User } = require('../models');
const AppError = require('../utils/AppError');
const { ROLES } = require('../config/constants');

/**
 * Data-scope rules (permission matrix 7.1):
 *   Admin          → all records
 *   Manager        → own records + records of the Sales Executives they manage
 *   SalesExecutive → own/assigned records only
 * Applied to every query on the server so that changing URLs or request
 * payloads cannot expose records outside the user's scope.
 */
async function scopeUserIds(user) {
  const scope = user.role?.scope;
  if (scope === 'all') return null;
  if (scope === 'team') {
    const team = await User.find({ manager: user._id }).select('_id').lean();
    return [user._id, ...team.map((u) => u._id)];
  }
  return [user._id];
}

/** Returns a Mongo filter limiting `field` to the user's scope. */
async function scopeFilter(user, field) {
  const ids = await scopeUserIds(user);
  return ids ? { [field]: { $in: ids } } : {};
}

async function assertInScope(user, ownerId) {
  const ids = await scopeUserIds(user);
  if (ids && !ids.some((i) => i.toString() === String(ownerId))) {
    throw AppError.forbidden('You do not have access to this record.');
  }
}

/**
 * Validates the user a record is being assigned to: must exist, be active,
 * hold a sales-capable role and fall inside the current user's scope.
 * Returns the resolved user id (defaults to the current user).
 */
async function resolveAssignee(user, requestedId) {
  if (!requestedId || String(requestedId) === String(user._id)) return user._id;
  const target = await User.findById(requestedId).populate('role');
  if (!target) throw AppError.business('assignedToId', 'Assigned user does not exist.');
  if (!target.isActive) throw AppError.business('assignedToId', 'Assigned user is not active.');
  if (![ROLES.SALES, ROLES.MANAGER].includes(target.role?.roleName)) {
    throw AppError.business('assignedToId', 'Records can only be assigned to a Sales Executive or Manager.');
  }
  const ids = await scopeUserIds(user);
  if (ids && !ids.some((i) => i.toString() === target._id.toString())) {
    throw AppError.forbidden('You cannot assign records to users outside your team.');
  }
  return target._id;
}

module.exports = { scopeUserIds, scopeFilter, assertInScope, resolveAssignee };
