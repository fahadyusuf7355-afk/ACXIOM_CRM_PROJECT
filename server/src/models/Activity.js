const mongoose = require('mongoose');
const { ACTIVITY_TYPES, ACTIVITY_STATUSES } = require('../config/constants');
const { softDelete } = require('./plugins');

const activitySchema = new mongoose.Schema({
  activityType: { type: String, enum: ACTIVITY_TYPES, required: true },
  subject: { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, maxlength: 2000, default: '' },
  activityDate: { type: Date, required: true },
  status: { type: String, enum: ACTIVITY_STATUSES, default: 'Planned', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  opportunity: { type: mongoose.Schema.Types.ObjectId, ref: 'Opportunity', default: null },
  followUp: { type: mongoose.Schema.Types.ObjectId, ref: 'FollowUp', default: null },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

activitySchema.plugin(softDelete);
activitySchema.index({ assignedTo: 1, activityDate: -1 });
activitySchema.index({ customer: 1 });
activitySchema.index({ lead: 1 });

module.exports = mongoose.model('Activity', activitySchema);
