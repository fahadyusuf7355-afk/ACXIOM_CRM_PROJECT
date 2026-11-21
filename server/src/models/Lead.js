const mongoose = require('mongoose');
const { LEAD_STATUSES, LEAD_SOURCES, PRIORITIES } = require('../config/constants');
const { softDelete, historyEntry } = require('./plugins');

const leadSchema = new mongoose.Schema({
  leadCode: { type: String, required: true, unique: true },
  leadName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
  phone: { type: String, trim: true, default: '' },
  companyName: { type: String, trim: true, maxlength: 150, default: '' },
  source: { type: String, enum: LEAD_SOURCES, required: true },
  status: { type: String, enum: LEAD_STATUSES, default: 'New', required: true },
  priority: { type: String, enum: PRIORITIES, default: 'Medium' },
  expectedValue: { type: Number, min: 0, default: 0 },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notes: { type: String, maxlength: 2000, default: '' },

  // Conversion tracking
  convertedAt: { type: Date, default: null },
  convertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  convertedCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  convertedOpportunity: { type: mongoose.Schema.Types.ObjectId, ref: 'Opportunity', default: null },

  lastActivityAt: { type: Date },
  history: [historyEntry],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

leadSchema.plugin(softDelete);
leadSchema.index({ assignedTo: 1, status: 1 });
leadSchema.index({ createdDate: -1 });

module.exports = mongoose.model('Lead', leadSchema);
