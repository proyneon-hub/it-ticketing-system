import { MIN_AUTH_SECRET_LENGTH, hasStrongAuthSecret } from '../config';
import { ServiceUnavailableError } from '../errors';
import { logger } from '../logger';

const DEFAULT_AUTH_SECRET = 'local-demo-secret-change-me';

// The development fallback is public (it is in this repository), so a token signed
// with it proves nothing. In production a missing or weak secret therefore stops
// authentication with a 503 instead of quietly accepting forgeable tokens. The
// rest of the API, such as health and docs, keeps working.
// Throws the same 503 as signing would, without doing anything else first. Sign-in and
// refresh call it up front so a server with no secret does no database work and leaves
// no half-finished session behind.
export function assertAuthConfigured(): void {
  getAuthSecret();
}

export function getAuthSecret(): string {
  if (process.env.NODE_ENV !== 'production') return process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;

  if (!hasStrongAuthSecret()) {
    logger.error(
      `AUTH_SECRET is missing or shorter than ${MIN_AUTH_SECRET_LENGTH} characters; authentication is disabled.`
    );
    throw new ServiceUnavailableError(
      'AUTH_NOT_CONFIGURED',
      'Server authentication is not configured.'
    );
  }

  return process.env.AUTH_SECRET as string;
}
