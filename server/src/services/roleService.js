const { Role, User } = require('../models');
const AppError = require('../utils/AppError');
const audit = require('./auditService');
const { ROLES, PERMISSIONS, ALL_PERMISSIONS } = require('../config/constants');

async function list() {
  const roles = await Role.find().sort('roleName').lean();
  const counts = await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]);
  return roles.map((r) => ({ ...r, userCount: counts.find((c) => String(c._id) === String(r._id))?.n || 0 }));
}

const catalogue = () => Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label, module: key.split(':')[0] }));

async function updatePermissions(id, permissions, req) {
  const role = await Role.findById(id);
  if (!role) throw AppError.notFound('Role');
  if (role.roleName === ROLES.ADMIN) throw AppError.business('permissions', 'The Admin role always has full access and cannot be modified.');
  // Security administration is reserved for Admin – least privilege.
  const forbidden = ['roles:manage', 'audit:read', 'users:manage'].filter((p) => permissions.includes(p) && role.roleName === ROLES.SALES);
  if (forbidden.length) throw AppError.business('permissions', `Sales Executive cannot be granted: ${forbidden.join(', ')}.`);
  if (permissions.includes('roles:manage')) throw AppError.business('permissions', 'Only the Admin role can manage roles.');
  const before = [...role.permissions];
  role.permissions = [...new Set(permissions)].filter((p) => ALL_PERMISSIONS.includes(p));
  await role.save();
  await audit.log(req, {
    action: 'PermissionChange', entityName: 'Role', recordId: role._id,
    oldValue: { permissions: before }, newValue: { permissions: role.permissions },
    details: `Permissions updated for role ${role.roleName}`
  });
  return role;
}

module.exports = { list, catalogue, updatePermissions };
