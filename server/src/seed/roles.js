const { Role } = require('../models');
const { ROLES, DEFAULT_ROLE_PERMISSIONS, ROLE_SCOPE, ALL_PERMISSIONS } = require('../config/constants');

const DESCRIPTIONS = {
  [ROLES.ADMIN]: 'Full application administration: users, roles, audit logs, all CRM records and reports.',
  [ROLES.MANAGER]: 'Manages team customers, leads, opportunities, follow-ups and management reports.',
  [ROLES.SALES]: 'Manages assigned customers, leads, opportunities, follow-ups and activities.'
};

/** Creates the three system roles if missing; keeps Admin at full permissions. */
async function ensureRoles() {
  for (const roleName of Object.values(ROLES)) {
    const existing = await Role.findOne({ roleName });
    if (!existing) {
      await Role.create({ roleName, description: DESCRIPTIONS[roleName], scope: ROLE_SCOPE[roleName], permissions: DEFAULT_ROLE_PERMISSIONS[roleName] });
    } else if (roleName === ROLES.ADMIN && existing.permissions.length !== ALL_PERMISSIONS.length) {
      existing.permissions = ALL_PERMISSIONS;
      await existing.save();
    }
  }
}

module.exports = { ensureRoles, DESCRIPTIONS };
