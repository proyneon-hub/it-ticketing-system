// Errors that carry an HTTP status so the central handler in app.js can turn
// them into consistent JSON responses.
class HttpError extends Error {
  constructor(statusCode, message, errors) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    if (errors) this.errors = errors;
  }
}

const badRequest = (message, errors) => new HttpError(400, message, errors);
const forbidden = (message) => new HttpError(403, message);

module.exports = { HttpError, badRequest, forbidden };
