const mongoose = require('mongoose');

/**
 * Adds soft-delete fields and a status/history log shared by CRM entities.
 * Deleted records stay in the database for auditability and are excluded
 * from normal queries by the services.
 */
function softDelete(schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  });
}

const historyEntry = new mongoose.Schema({
  action: { type: String, required: true },
  from: String,
  to: String,
  note: { type: String, maxlength: 2000 },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now }
}, { _id: false });

module.exports = { softDelete, historyEntry };
