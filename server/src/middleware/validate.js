const AppError = require('../utils/AppError');

/**
 * Validates req.body against a Joi schema at the API boundary. Unknown fields
 * are stripped (prevents mass-assignment of fields like role, owner, status
 * internals). All errors are returned together with field names.
 */
const validate = (schema) => (req, res, next) => {
  const { value, error } = schema.validate(req.body || {}, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) {
    const details = error.details.map((d) => ({ field: d.path.join('.') || '_general', message: d.message.replace(/"/g, '') }));
    return next(AppError.badRequest('One or more fields are invalid.', details));
  }
  req.body = value;
  next();
};

module.exports = validate;
