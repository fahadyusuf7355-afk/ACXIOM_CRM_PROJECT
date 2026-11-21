const mongoose = require('mongoose');
const config = require('./index');

// Security (NoSQL injection): queries are built with the Mongoose query API
// only; user input is never concatenated into query strings. Request bodies
// are validated/stripped by Joi and `$`-keys are removed, query-string values
// are forced to scalars, and Mongoose casts every value to the schema type.
// strictQuery drops filter keys that are not in the schema.
mongoose.set('strictQuery', true);

async function connectDB(uri = config.mongoUri) {
  await mongoose.connect(uri, { autoIndex: true });
  if (!config.isTest) console.log(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

module.exports = { connectDB };
