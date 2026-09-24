import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { MIN_CRON_SECRET_LENGTH, hasStrongCronSecret } from '../config';
import { ServiceUnavailableError, UnauthorizedError } from '../errors';
import { logger } from '../logger';

// Scheduled jobs are called over the internet by a scheduler that has no user account, so
// they present a shared secret as a bearer token: Authorization: Bearer <CRON_SECRET>.

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

// Compares without leaking, through timing, how much of the secret was right. Hashing both
// sides first makes them the same length, which timingSafeEqual requires.
export function secretMatches(supplied: string, expected: string): boolean {
  return timingSafeEqual(digest(supplied), digest(expected));
}

export function requireCronSecret(req: Request, _res: Response, next: NextFunction): void {
  // With no (or a short) secret the jobs are off, rather than open. Anyone could otherwise
  // trigger them by sending an empty token.
  if (!hasStrongCronSecret()) {
    logger.error(
      `CRON_SECRET is missing or shorter than ${MIN_CRON_SECRET_LENGTH} characters; scheduled jobs are disabled.`
    );
    return next(
      new ServiceUnavailableError('JOBS_NOT_CONFIGURED', 'Scheduled jobs are not configured.')
    );
  }

  const header = req.get('authorization') ?? '';
  const supplied = /^Bearer (.+)$/i.exec(header)?.[1] ?? '';
  if (!supplied || !secretMatches(supplied, process.env.CRON_SECRET as string)) {
    return next(new UnauthorizedError('Invalid job credentials.'));
  }
  next();
}
