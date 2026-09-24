import type { Request } from 'express';
import type { TokenPayload } from './auth';
import type { AuditContext } from './services/auditService';

// requireAuth has run for every route that calls this, so a user is always present.
export const actorOf = (req: Request): TokenPayload => req.user as TokenPayload;

// Where a request came from, for the audit log. req.ip honours the trust-proxy setting.
export const auditContext = (req: Request): AuditContext => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: typeof req.id === 'string' ? req.id : String(req.id ?? ''),
});
