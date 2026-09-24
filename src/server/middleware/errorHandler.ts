import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isDatabaseConnectivityError } from '../db';
import { HttpError, type FieldError } from '../errors';
import { logger } from '../logger';

interface DescribedError {
  status: number;
  message: string;
  errors?: FieldError[];
}

// The properties of the errors this handler recognises. Anything else thrown is
// treated as an unexpected failure.
interface KnownErrorShape {
  name?: string;
  message?: string;
  code?: number | string;
  path?: string;
  errors?: unknown;
  statusCode?: number;
  status?: number;
}

// Turns anything thrown by a route into { status, message, errors? }. Anything
// unrecognised becomes a generic 500 so internals never reach the client.
export function describeError(thrown: unknown): DescribedError {
  const error = (thrown ?? {}) as KnownErrorShape;

  if (error.message?.includes('MONGODB_URI is missing')) {
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
    const errors = Object.values(
      error.errors as Record<string, { path: string; message: string }>
    ).map((item) => ({ field: item.path, message: item.message }));
    return { status: 400, message: errors[0]?.message || 'Validation failed.', errors };
  }

  if (error.name === 'CastError') {
    return { status: 400, message: `Invalid value for ${error.path}.` };
  }

  if (error.code === 11000) {
    return { status: 409, message: 'A record with that unique value already exists.' };
  }

  // An HttpError is thrown on purpose with a message written for the client, so
  // it keeps its status even for 5xx. Any other 5xx may leak internals.
  const status = error.statusCode || error.status || 500;
  if (status < 500 || thrown instanceof HttpError) {
    return {
      status,
      message: error.message ?? 'Request failed.',
      ...(Array.isArray(error.errors) ? { errors: error.errors as FieldError[] } : {}),
    };
  }

  return { status: 500, message: 'Internal server error.' };
}

// Express identifies error handlers by their four arguments, so `_next` must stay.
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { status, message, errors } = describeError(error);
  const log = req.log || logger;

  // 5xx means something is broken on our side, so keep the stack. Client
  // errors are already summarised by the request log line.
  if (status >= 500) log.error({ err: error }, message);

  res.status(status).json({ message, ...(errors ? { errors } : {}), requestId: req.id });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.path}`, requestId: req.id });
};
