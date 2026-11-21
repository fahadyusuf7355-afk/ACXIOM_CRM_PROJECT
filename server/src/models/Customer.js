const mongoose = require('mongoose');
const { CUSTOMER_STATUSES } = require('../config/constants');
const { softDelete, historyEntry } = require('./plugins');

const customerSchema = new mongoose.Schema({
  customerCode: { type: String, required: true, unique: true },
  customerName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  phone: { type: String, required: true, trim: true, match: /^[6-9]\d{9}$/ },
  companyName: { type: String, trim: true, maxlength: 150, default: '' },
  address: { type: String, trim: true, maxlength: 250, default: '' },
  city: { type: String, trim: true, maxlength: 60, default: '' },
  state: { type: String, trim: true, maxlength: 60, default: '' },
  status: { type: String, enum: CUSTOMER_STATUSES, default: 'Active', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // assigned sales executive
  notes: { type: String, maxlength: 2000, default: '' },
  sourceLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  lastActivityAt: { type: Date },
  history: [historyEntry],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

customerSchema.plugin(softDelete);

// Uniqueness enforced at the database level among non-deleted customers
customerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
customerSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
customerSchema.index({ owner: 1, status: 1 });
customerSchema.index({ createdDate: -1 });

module.exports = mongoose.model('Customer', customerSchema);
