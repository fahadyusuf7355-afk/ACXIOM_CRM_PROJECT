const { User, Role } = require('../models');
const AppError = require('../utils/AppError');
const pwd = require('./passwordService');
const audit = require('./auditService');
const { scopeUserIds } = require('./scopeService');
const { escapeRegex, parseListQuery, pageMeta } = require('../utils/helpers');
const { ROLES } = require('../config/constants');
const { toUserDTO } = require('../dtos');

const populate = [{ path: 'role' }, { path: 'manager', select: 'name' }];

async function list(currentUser, q) {
  const { page, limit, skip, sort } = parseListQuery(q, ['name', 'username', 'email', 'createdDate', 'lastLoginAt'], 'name');
  const filter = {};
  const ids = await scopeUserIds(currentUser);
  if (ids) filter._id = { $in: ids };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { username: rx }];
  }
  if (q.role) {
    const role = await Role.findOne({ roleName: String(q.role) });
    filter.role = role ? role._id : null;
  }
  if (q.status === 'active') filter.isActive = true;
  if (q.status === 'inactive') filter.isActive = false;
  if (q.status === 'locked') filter.lockoutEnd = { $gt: new Date() };

  const [items, total] = await Promise.all([
    User.find(filter).populate(populate).sort(sort).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);
  return { items: items.map(toUserDTO), meta: pageMeta(page, limit, total) };
}

async function getById(currentUser, id) {
  const ids = await scopeUserIds(currentUser);
  if (ids && !ids.some((i) => i.toString() === id)) throw AppError.notFound('User');
  const user = await User.findById(id).populate(populate);
  if (!user) throw AppError.notFound('User');
  return user;
}

/** Users the current user may assign CRM records to (for dropdowns). */
async function assignable(currentUser) {
  const roles = await Role.find({ roleName: { $in: [ROLES.SALES, ROLES.MANAGER] } }).select('_id');
  const filter = { isActive: true, role: { $in: roles.map((r) => r._id) } };
  const ids = await scopeUserIds(currentUser);
  if (ids) filter._id = { $in: ids };
  const users = await User.find(filter).populate('role').sort('name');
  return users.map((u) => ({ id: u._id.toString(), name: u.name, role: u.role.roleName }));
}

async function resolveManager(managerId, roleName) {
  if (!managerId) return null;
  if (roleName !== ROLES.SALES) throw AppError.business('managerId', 'Only Sales Executives can report to a manager.');
  const mgr = await User.findById(managerId).populate('role');
  if (!mgr || !mgr.isActive || mgr.role.roleName !== ROLES.MANAGER) throw AppError.business('managerId', 'Selected manager must be an active Manager.');
  return mgr._id;
}

async function assertNotLastAdmin(user) {
  if (user.role.roleName !== ROLES.ADMIN) return;
  const adminRole = await Role.findOne({ roleName: ROLES.ADMIN });
  const count = await User.countDocuments({ role: adminRole._id, isActive: true, _id: { $ne: user._id } });
  if (count === 0) throw AppError.business('role', 'At least one active Admin account must remain.');
}

async function checkUnique({ email, username }, excludeId) {
  const or = [];
  if (email) or.push({ email });
  if (username) or.push({ username });
  const exists = await User.findOne({ $or: or, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
  if (exists) {
    if (email && exists.email === email) throw AppError.conflict('Email already exists.', 'email');
    throw AppError.conflict('Username already exists.', 'username');
  }
}

async function create(currentUser, data, req) {
  await checkUnique(data);
  const role = await Role.findOne({ roleName: data.role });
  const user = new User({
    name: data.name, username: data.username, email: data.email, phone: data.phone || '',
    role: role._id, isActive: data.isActive !== false, createdBy: currentUser._id,
    manager: await resolveManager(data.managerId, data.role)
  });
  await pwd.setPassword(user, data.password, 'password');
  user.mustChangePassword = true; // admin-issued password must be changed at first login
  await user.save();
  await user.populate(populate);
  await audit.log(req, { action: 'Create', entityName: 'User', recordId: user._id, newValue: toUserDTO(user) });
  return user;
}

async function update(currentUser, id, data, req) {
  const user = await User.findById(id).select('+tokenVersion').populate(populate);
  if (!user) throw AppError.notFound('User');
  await checkUnique({ email: data.email }, user._id);
  const before = toUserDTO(user);
  const oldRole = user.role.roleName;

  if (data.role !== oldRole) {
    if (String(user._id) === String(currentUser._id)) throw AppError.business('role', 'You cannot change your own role.');
    await assertNotLastAdmin(user);
  }
  const newRole = await Role.findOne({ roleName: data.role });
  user.name = data.name;
  user.email = data.email;
  user.phone = data.phone || '';
  user.manager = await resolveManager(data.managerId, data.role);
  if (data.role !== oldRole) {
    user.role = newRole._id;
    user.tokenVersion += 1; // force re-login with new permissions
    if (oldRole === ROLES.MANAGER) await User.updateMany({ manager: user._id }, { $set: { manager: null } });
  }
  await user.save();
  await user.populate(populate);
  const after = toUserDTO(user);
  await audit.log(req, { action: 'Update', entityName: 'User', recordId: user._id, oldValue: before, newValue: after });
  if (data.role !== oldRole) {
    await audit.log(req, { action: 'RoleChange', entityName: 'User', recordId: user._id, oldValue: { role: oldRole }, newValue: { role: data.role }, details: `Role changed for ${user.username}` });
  }
  return user;
}

async function setStatus(currentUser, id, isActive, req) {
  const user = await User.findById(id).select('+tokenVersion').populate(populate);
  if (!user) throw AppError.notFound('User');
  if (String(user._id) === String(currentUser._id) && !isActive) throw AppError.business('isActive', 'You cannot deactivate your own account.');
  if (!isActive) await assertNotLastAdmin(user);
  if (user.isActive === isActive) return user;
  user.isActive = isActive;
  if (!isActive) user.tokenVersion += 1; // terminate active sessions
  await user.save();
  await audit.log(req, { action: isActive ? 'Activate' : 'Deactivate', entityName: 'User', recordId: user._id, oldValue: { isActive: !isActive }, newValue: { isActive } });
  return user;
}

/** Admin-initiated reset: sets a temporary password the user must change at next login. */
async function resetPassword(currentUser, id, newPassword, req) {
  const user = await User.findById(id).select('+passwordHash +passwordHistory +tokenVersion').populate(populate);
  if (!user) throw AppError.notFound('User');
  await pwd.setPassword(user, newPassword);
  user.mustChangePassword = true;
  user.failedLoginCount = 0;
  user.lockoutEnd = null;
  await user.save();
  await audit.log(req, { action: 'PasswordReset', entityName: 'User', recordId: user._id, details: `Temporary password issued for ${user.username} by administrator` });
  return user;
}

async function unlock(currentUser, id, req) {
  const user = await User.findById(id).populate(populate);
  if (!user) throw AppError.notFound('User');
  const wasLocked = !!(user.lockoutEnd && user.lockoutEnd > new Date());
  user.lockoutEnd = null;
  user.failedLoginCount = 0;
  await user.save();
  await audit.log(req, { action: 'AccountUnlocked', entityName: 'User', recordId: user._id, details: wasLocked ? `Account ${user.username} unlocked by administrator` : 'Failed-attempt counter reset' });
  return user;
}

module.exports = { list, getById, assignable, create, update, setStatus, resetPassword, unlock };
