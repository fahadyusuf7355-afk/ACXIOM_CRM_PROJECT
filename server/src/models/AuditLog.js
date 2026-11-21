const mongoose = require('mongoose');
const { AUDIT_ACTIONS } = require('../config/constants');

/**
 * Append-only audit trail. Update and delete operations are blocked at the
 * model level, and no API endpoint exposes modification or deletion.
 */
const auditLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  userName: { type: String, default: 'Anonymous' }, // snapshot at event time
  action: { type: String, enum: AUDIT_ACTIONS, required: true },
  entityName: { type: String, required: true }, // module, e.g. Customer, Auth
  recordId: { type: String, default: null },
  oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
  newValue: { type: mongoose.Schema.Types.Mixed, default: null },
  result: { type: String, enum: ['Success', 'Failure'], default: 'Success' },
  details: { type: String, maxlength: 1000, default: '' },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, maxlength: 300, default: '' },
  createdDate: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });

auditLogSchema.index({ createdDate: -1 });
auditLogSchema.index({ user: 1, createdDate: -1 });
auditLogSchema.index({ entityName: 1, action: 1 });

const blocked = function () { throw new Error('Audit records are append-only and cannot be modified or deleted.'); };
['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace']
  .forEach((op) => auditLogSchema.pre(op, blocked));
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit records are append-only and cannot be modified.'));
  next();
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
