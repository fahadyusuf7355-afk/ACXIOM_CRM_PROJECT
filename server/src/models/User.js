const mongoose = require('mongoose');

/**
 * Application user. Passwords are stored only as adaptive bcrypt hashes
 * (passwordHash). Sensitive fields use `select: false` so they are never loaded
 * unless a security service asks for them explicitly, and DTO mappers never
 * output them.
 */
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  username: { type: String, required: true, trim: true, lowercase: true, maxlength: 30, unique: true },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
  phone: { type: String, trim: true },
  role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // team membership
  isActive: { type: Boolean, default: true },

  passwordHash: { type: String, required: true, select: false },
  passwordHistory: { type: [String], select: false, default: [] },
  passwordChangedAt: { type: Date },
  mustChangePassword: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0, select: false },

  failedLoginCount: { type: Number, default: 0 },
  lockoutEnd: { type: Date, default: null },
  lastLoginAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' } });

userSchema.virtual('isLockedOut').get(function () {
  return !!(this.lockoutEnd && this.lockoutEnd > new Date());
});

userSchema.index({ name: 'text', email: 'text', username: 'text' });

module.exports = mongoose.model('User', userSchema);
