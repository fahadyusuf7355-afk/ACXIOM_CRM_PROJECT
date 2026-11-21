const mongoose = require('mongoose');
const { OPPORTUNITY_STAGES, OPPORTUNITY_STATUSES, LEAD_SOURCES } = require('../config/constants');
const { softDelete, historyEntry } = require('./plugins');

const opportunitySchema = new mongoose.Schema({
  opportunityCode: { type: String, required: true, unique: true },
  opportunityName: { type: String, required: true, trim: true, maxlength: 150 },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  amount: { type: Number, required: true, min: 0 },
  stage: { type: String, enum: OPPORTUNITY_STAGES, default: 'Qualification', required: true },
  probability: { type: Number, required: true, min: 0, max: 100 },
  expectedCloseDate: { type: Date, required: true },
  status: { type: String, enum: OPPORTUNITY_STATUSES, default: 'Open', required: true },
  source: { type: String, enum: [...LEAD_SOURCES, ''], default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // owner
  notes: { type: String, maxlength: 2000, default: '' },

  // Final outcome (Won/Lost)
  closedDate: { type: Date, default: null },
  outcomeReason: { type: String, maxlength: 500, default: '' },

  lastActivityAt: { type: Date },
  history: [historyEntry],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

opportunitySchema.plugin(softDelete);
opportunitySchema.index({ assignedTo: 1, stage: 1 });
opportunitySchema.index({ customer: 1 });
opportunitySchema.index({ closedDate: -1 });

module.exports = mongoose.model('Opportunity', opportunitySchema);
