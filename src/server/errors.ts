// Every failure the API reports on purpose is an AppError: an HTTP status for
// transport, a stable `code` for clients to branch on (the message is for people
// and may change), and optional field-level detail.

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'AUTH_NOT_CONFIGURED'
  | 'JOBS_NOT_CONFIGURED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'NO_PENDING_PROPOSAL'
  | 'LAST_ADMIN'
  | 'DUPLICATE'
  | 'RATE_LIMITED'
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface FieldError {
  field?: string | undefined;
  message: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly errors?: FieldError[];

  constructor(statusCode: number, code: ErrorCode, message: string, errors?: FieldError[]) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    if (errors) this.errors = errors;
  }
}

// The request is malformed or breaks a rule. `errors` names the offending fields.
export class ValidationError extends AppError {
  constructor(message: string, errors?: FieldError[]) {
    super(400, 'VALIDATION_FAILED', message, errors);
  }
}

// No valid credentials.
export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(401, 'UNAUTHORIZED', message);
  }
}

// Signed in, but not allowed to do this.
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
  }
}

// The request is fine, but the resource's current state does not allow it.
export class ConflictError extends AppError {
  constructor(
    code:
      | 'INVALID_TRANSITION'
      | 'VERSION_CONFLICT'
      | 'NO_PENDING_PROPOSAL'
      | 'LAST_ADMIN'
      | 'DUPLICATE',
    message: string
  ) {
    super(409, code, message);
  }
}

// The service cannot do this right now (missing configuration, database down).
export class ServiceUnavailableError extends AppError {
  constructor(
    code:
      | 'AUTH_NOT_CONFIGURED'
      | 'JOBS_NOT_CONFIGURED'
      | 'DATABASE_NOT_CONFIGURED'
      | 'DATABASE_UNAVAILABLE',
    message: string
  ) {
    super(503, code, message);
  }
}
