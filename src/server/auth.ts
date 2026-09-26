import type { NextFunction, Request, Response } from 'express';
import type { ActorRole, Role } from '../shared/ticket-constants';
import { ForbiddenError, UnauthorizedError } from './errors';
import { verifyAccessToken } from './security/accessToken';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// What a verified access token carries. `sub` is the user's id.
export interface TokenPayload {
  sub: string;
  name: string;
  email: string;
  role: ActorRole;
  exp: number;
  // Only on an agent token: the one ticket it may touch, and the agent run it belongs to.
  // verifyAccessToken refuses an agent token without a ticket, so where role is 'agent'
  // `ticketId` is always present.
  ticketId?: string;
  runId?: string;
}

function getTokenFromRequest(req: Request): string {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// Failures go through next() so they leave via the central error handler, with
// the same JSON shape and request id as every other error.
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await verifyAccessToken(getTokenFromRequest(req));
    if (!user) return next(new UnauthorizedError('Authentication required.'));
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...allowedRoles: ActorRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError('You do not have permission to perform this action.'));
    }
    next();
  };
}
