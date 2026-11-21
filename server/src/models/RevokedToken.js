const mongoose = require('mongoose');

/** Session ids (JWT jti) invalidated by logout. Expired entries are purged by a TTL index. */
const revokedTokenSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true }
});
revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RevokedToken', revokedTokenSchema);
