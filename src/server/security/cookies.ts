import type { Request, RequestHandler, Response } from 'express';
import { UnauthorizedError } from '../errors';

// The refresh token travels only in this cookie. httpOnly keeps scripts from reading
// it, SameSite=Strict keeps other sites from making the browser send it, and the path
// keeps it off every request except the two that use it.
export const REFRESH_COOKIE = 'rt';
const REFRESH_PATH = '/api/auth';

export const refreshTtlMs = (): number =>
  (Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000;

// Secure cookies are only sent over https. Production is https (Vercel), but the
// Docker demo runs on plain http://localhost, so it can opt out with COOKIE_SECURE=false.
const isSecure = (): boolean =>
  process.env.COOKIE_SECURE === undefined
    ? process.env.NODE_ENV === 'production'
    : process.env.COOKIE_SECURE !== 'false';

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: refreshTtlMs(),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'strict',
    path: REFRESH_PATH,
  });
}

export const readRefreshCookie = (req: Request): string | undefined => {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
};

// Cookie-based endpoints (refresh, logout) must not be triggerable from another site.
// SameSite=Strict already stops the browser sending the cookie there; this is a second,
// independent check: a request that names an Origin must name our own. Clients that
// send no Origin (curl, monitoring scripts) are not browsers and cannot be tricked
// into cross-site requests, so they pass.
export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    return next(new UnauthorizedError('Cross-origin request refused.'));
  }
  next();
};
