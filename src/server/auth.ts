import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { roles, type Role } from '../shared/ticket-constants';
import { MIN_AUTH_SECRET_LENGTH, hasStrongAuthSecret } from './config';
import { forbidden, serviceUnavailable, unauthorized } from './errors';
import { logger } from './logger';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// What a verified bearer token carries. `sub` is the user's id.
export interface TokenPayload {
  sub: string;
  name: string;
  email: string;
  role: Role;
  exp: number;
}

interface DemoUser extends PublicUser {
  password: string;
}

export const demoUsers: DemoUser[] = [
  {
    id: 'usr_admin',
    name: 'Priya Admin',
    email: 'admin@demo.local',
    password: 'AdminPass123!',
    role: 'admin',
  },
  {
    id: 'usr_tech',
    name: 'Theo Technician',
    email: 'tech@demo.local',
    password: 'TechPass123!',
    role: 'technician',
  },
  {
    id: 'usr_user',
    name: 'Una User',
    email: 'user@demo.local',
    password: 'UserPass123!',
    role: 'user',
  },
];

const DEFAULT_AUTH_SECRET = 'local-demo-secret-change-me';

// The development fallback is public (it is in this repository), so a token signed
// with it proves nothing. In production a missing or weak secret therefore stops
// authentication with a 503 instead of quietly accepting forgeable tokens. The
// rest of the API, such as health and docs, keeps working.
function getAuthSecret(): string {
  if (process.env.NODE_ENV !== 'production') return process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;

  if (!hasStrongAuthSecret()) {
    logger.error(
      `AUTH_SECRET is missing or shorter than ${MIN_AUTH_SECRET_LENGTH} characters; authentication is disabled.`
    );
    throw serviceUnavailable('Server authentication is not configured.');
  }

  return process.env.AUTH_SECRET as string;
}

function base64url(input: unknown): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function sign(value: string): string {
  return crypto.createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

export function issueToken(user: PublicUser): string {
  const payload: TokenPayload = {
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
  };
  const encoded = base64url(payload);
  return `${encoded}.${sign(encoded)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  if (!token || !token.includes('.')) return null;

  const [encoded = '', signature = ''] = token.split('.');
  const expected = sign(encoded);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_error) {
    return null;
  }
  if (!roles.includes(payload.role) || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function findDemoUserByEmail(email: unknown): DemoUser | undefined {
  return demoUsers.find((user) => user.email.toLowerCase() === String(email || '').toLowerCase());
}

export function authenticateDemoUser(email: unknown, password: unknown): PublicUser | null {
  const user = findDemoUserByEmail(email);
  if (!user || user.password !== password) return null;
  const { password: _password, ...publicUser } = user;
  return publicUser;
}

function getTokenFromRequest(req: Request): string {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// Failures go through next() so they leave via the central error handler, with
// the same JSON shape and request id as every other error.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const user = verifyToken(getTokenFromRequest(req));
  if (!user) {
    return next(unauthorized('Authentication required.'));
  }
  req.user = user;
  next();
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(forbidden('You do not have permission to perform this action.'));
    }
    next();
  };
}
