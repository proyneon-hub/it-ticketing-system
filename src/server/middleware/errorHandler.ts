import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isDatabaseConnectivityError } from '../db';
import { AppError, ForbiddenError, type ErrorCode, type FieldError } from '../errors';
import { auditContext } from '../http';
import { logger } from '../logger';
import { recordAudit } from '../services/auditService';

interface DescribedError {
  status: number;
  code: ErrorCode;
  message: string;
  errors?: FieldError[];
}

const CLIENT_ERROR_CODES: Partial<Record<number, ErrorCode>> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
};

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

// Turns anything thrown by a route into { status, code, message, errors? }. An
// AppError is reported as it was thrown. Anything unrecognised becomes a generic
// 500 so internals never reach the client.
export function describeError(thrown: unknown): DescribedError {
  if (thrown instanceof AppError) {
    return {
      status: thrown.statusCode,
      code: thrown.code,
      message: thrown.message,
      ...(thrown.errors ? { errors: thrown.errors } : {}),
    };
  }

  const error = (thrown ?? {}) as KnownErrorShape;

  if (error.message?.includes('MONGODB_URI is missing')) {
    return {
      status: 503,
      code: 'DATABASE_NOT_CONFIGURED',
      message:
        'Database is not configured. Add MONGODB_URI in Vercel Project Settings, then redeploy.',
    };
  }

  if (isDatabaseConnectivityError(error)) {
    return {
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
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
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: errors[0]?.message || 'Validation failed.',
      errors,
    };
  }

  if (error.name === 'CastError') {
    return { status: 400, code: 'VALIDATION_FAILED', message: `Invalid value for ${error.path}.` };
  }

  if (error.code === 11000) {
    return {
      status: 409,
      code: 'DUPLICATE',
      message: 'A record with that unique value already exists.',
    };
  }

  // A client error raised by a library, such as the body parser rejecting malformed
  // JSON. Its message is safe to show; anything 5xx may leak internals.
  const status = error.statusCode || error.status || 500;
  if (status >= 400 && status < 500) {
    return {
      status,
      code: CLIENT_ERROR_CODES[status] ?? 'VALIDATION_FAILED',
      message: error.message ?? 'Request failed.',
    };
  }

  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error.' };
}

// Express identifies error handlers by their four arguments, so `_next` must stay.
export const errorHandler: ErrorRequestHandler = async (error, req, res, _next) => {
  const { status, code, message, errors } = describeError(error);
  const log = req.log || logger;

  // A signed-in user trying something they may not do is worth a security record.
  if (error instanceof ForbiddenError && req.user) {
    await recordAudit(
      {
        type: 'permission_denied',
        outcome: 'denied',
        actor: req.user,
        detail: `${req.method} ${req.originalUrl.split('?')[0]}: ${message}`,
      },
      auditContext(req)
    );
  }

  // 5xx means something is broken on our side, so keep the stack. Client
  // errors are already summarised by the request log line.
  if (status >= 500) log.error({ err: error }, message);

  res.status(status).json({ message, code, ...(errors ? { errors } : {}), requestId: req.id });
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.path}`,
    code: 'NOT_FOUND',
    requestId: req.id,
  });
};
