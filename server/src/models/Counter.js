const mongoose = require('mongoose');

/** Atomic sequence generator used for CustomerCode / LeadCode / OpportunityCode. */
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.model('Counter', counterSchema);

async function nextCode(name, prefix, width = 5) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(c.seq).padStart(width, '0')}`;
}

module.exports = { Counter, nextCode };
