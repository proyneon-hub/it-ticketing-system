const { isDatabaseConnectivityError } = require('../db');
const { logger } = require('../logger');

// Turns anything thrown by a route into { status, message, errors? }. Anything
// unrecognised becomes a generic 500 so internals never reach the client.
function describeError(error) {
  if (error.message && error.message.includes('MONGODB_URI is missing')) {
    return {
      status: 503,
      message:
        'Database is not configured. Add MONGODB_URI in Vercel Project Settings, then redeploy.',
    };
  }

  if (isDatabaseConnectivityError(error)) {
    return {
      status: 503,
      message:
        'Database unavailable. Check MONGODB_URI in Vercel and allow access from Vercel in MongoDB Atlas Network Access.',
    };
  }

  // Schema validation that slipped past request validation is still the
  // client's mistake, not a server fault.
  if (error.name === 'ValidationError' && error.errors) {
    const errors = Object.values(error.errors).map((item) => ({
      field: item.path,
      message: item.message,
    }));
    return { status: 400, message: errors[0]?.message || 'Validation failed.', errors };
  }

  if (error.name === 'CastError') {
    return { status: 400, message: `Invalid value for ${error.path}.` };
  }

  if (error.code === 11000) {
    return { status: 409, message: 'A record with that unique value already exists.' };
  }

  const status = error.statusCode || error.status || 500;
  if (status < 500) {
    return { status, message: error.message, ...(error.errors ? { errors: error.errors } : {}) };
  }

  return { status: 500, message: 'Internal server error.' };
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by their 4 arguments.
function errorHandler(error, req, res, _next) {
  const { status, message, errors } = describeError(error);
  const log = req.log || logger;

  // 5xx means something is broken on our side, so keep the stack. Client
  // errors are already summarised by the request log line.
  if (status >= 500) log.error({ err: error }, message);

  res.status(status).json({ message, ...(errors ? { errors } : {}), requestId: req.id });
}

function notFoundHandler(req, res) {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.path}`, requestId: req.id });
}

module.exports = { describeError, errorHandler, notFoundHandler };
