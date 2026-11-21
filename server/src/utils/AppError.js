/**
 * Operational error carrying an HTTP status and a safe, user-facing message.
 * Anything that is not an AppError is reported to the client as a generic 500
 * so stack traces and database details are never exposed.
 */
class AppError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code || AppError.codeFor(status);
    this.details = details;
    this.isOperational = true;
  }

  static codeFor(status) {
    return ({
      400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
      409: 'CONFLICT', 422: 'BUSINESS_RULE_VIOLATION', 423: 'ACCOUNT_LOCKED', 429: 'TOO_MANY_REQUESTS'
    })[status] || 'ERROR';
  }

  static badRequest(message, details) { return new AppError(400, message, 'VALIDATION_ERROR', details); }
  /** Business rule failures use 400 with field details so the UI can show them inline. */
  static business(field, message) { return new AppError(400, message, 'BUSINESS_RULE_VIOLATION', [{ field, message }]); }
  static unauthorized(message = 'Authentication is required.') { return new AppError(401, message); }
  static forbidden(message = 'You do not have permission to perform this action.') { return new AppError(403, message); }
  static notFound(entity = 'Record') { return new AppError(404, `${entity} not found.`); }
  static conflict(message, field) { return new AppError(409, message, 'CONFLICT', field ? [{ field, message }] : undefined); }
}

module.exports = AppError;
