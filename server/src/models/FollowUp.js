const mongoose = require('mongoose');
const { FOLLOWUP_STATUSES, FOLLOWUP_TYPES, RELATED_TYPES } = require('../config/constants');
const { softDelete, historyEntry } = require('./plugins');

const followUpSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true, maxlength: 150 },
  followUpType: { type: String, enum: FOLLOWUP_TYPES, required: true },
  followUpDate: { type: Date, required: true },
  status: { type: String, enum: FOLLOWUP_STATUSES, default: 'Planned', required: true },
  remarks: { type: String, maxlength: 2000, default: '' },
  outcome: { type: String, maxlength: 2000, default: '' },

  // Polymorphic relation + explicit FKs (CustomerId / LeadId per spec)
  relatedType: { type: String, enum: RELATED_TYPES, required: true },
  relatedId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  opportunity: { type: mongoose.Schema.Types.ObjectId, ref: 'Opportunity', default: null },

  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: { type: Date, default: null },
  rescheduleCount: { type: Number, default: 0 },
  history: [historyEntry],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

followUpSchema.plugin(softDelete);
followUpSchema.index({ assignedTo: 1, status: 1, followUpDate: 1 });
followUpSchema.index({ relatedType: 1, relatedId: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
