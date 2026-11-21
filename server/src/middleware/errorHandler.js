const AppError = require('../utils/AppError');
const config = require('../config');

const notFound = (req, res, next) => next(new AppError(404, 'The requested resource was not found.'));

/**
 * Consistent error object: { success:false, error:{ code, message, details? } }.
 * Stack traces, Mongo error text and internal field names are never sent.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let e = err;

  if (!(e instanceof AppError)) {
    if (e?.type === 'entity.parse.failed') e = AppError.badRequest('Request body is not valid JSON.');
    else if (e?.type === 'entity.too.large') e = new AppError(413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE');
    else if (e?.name === 'CastError') e = AppError.notFound();
    else if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern || e.keyValue || {})[0] || 'record';
      const label = { email: 'Email', phone: 'Phone', username: 'Username' }[field] || 'A record with these details';
      e = AppError.conflict(`${label} already exists.`, field);
    } else if (e?.name === 'ValidationError') {
      const details = Object.values(e.errors).map((x) => ({ field: x.path, message: 'Invalid value.' }));
      e = AppError.badRequest('One or more fields are invalid.', details);
    }
  }

  if (!(e instanceof AppError)) {
    if (!config.isTest) console.error('[Unhandled]', err);
    e = new AppError(500, 'An unexpected error occurred. Please try again later.', 'INTERNAL_ERROR');
  }

  res.status(e.status).json({ success: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}

module.exports = { notFound, errorHandler };
