// Errors that carry an HTTP status so the central handler can turn them into
// consistent JSON responses.

export interface FieldError {
  field?: string | undefined;
  message: string;
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly errors?: FieldError[];

  constructor(statusCode: number, message: string, errors?: FieldError[]) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    if (errors) this.errors = errors;
  }
}

export const badRequest = (message: string, errors?: FieldError[]) =>
  new HttpError(400, message, errors);
export const unauthorized = (message: string) => new HttpError(401, message);
export const forbidden = (message: string) => new HttpError(403, message);
export const serviceUnavailable = (message: string) => new HttpError(503, message);
