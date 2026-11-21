const mongoose = require('mongoose');
const { ALL_PERMISSIONS, ROLES } = require('../config/constants');

const roleSchema = new mongoose.Schema({
  roleName: { type: String, required: true, unique: true, enum: Object.values(ROLES) },
  description: { type: String, maxlength: 250 },
  scope: { type: String, enum: ['all', 'team', 'own'], required: true },
  permissions: [{ type: String, enum: ALL_PERMISSIONS }],
  isSystem: { type: Boolean, default: true }
}, { timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

module.exports = mongoose.model('Role', roleSchema);
