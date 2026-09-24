import type { NextFunction, Request, Response } from 'express';
import { MIN_CRON_SECRET_LENGTH } from '../config';
import { NotFoundError, UnauthorizedError } from '../errors';
import { logger } from '../logger';
import { secretMatches } from './cronAuth';

// Metrics describe the process (route names, error rates, memory), which is useful to an
// attacker and to nobody else, so the endpoint does not exist unless METRICS_TOKEN is set (32+
// characters, like the other secrets), and then needs it as a bearer token.
export function requireMetricsToken(req: Request, _res: Response, next: NextFunction): void {
  const token = process.env.METRICS_TOKEN;
  if (!token || token.length < MIN_CRON_SECRET_LENGTH) {
    if (token) {
      logger.error(
        `METRICS_TOKEN is shorter than ${MIN_CRON_SECRET_LENGTH} characters; /api/metrics is off.`
      );
    }
    // The same answer as any route that does not exist, so its absence is not a signal either.
    return next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
  }

  const supplied = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
  if (!supplied || !secretMatches(supplied, token)) {
    return next(new UnauthorizedError('Invalid metrics credentials.'));
  }
  next();
}
