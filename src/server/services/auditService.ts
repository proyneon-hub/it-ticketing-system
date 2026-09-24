import type { PublicUser, TokenPayload } from '../auth';
import { logger } from '../logger';
import * as repository from '../repositories/auditRepository';
import type { AuditEventAttrs, AuditType } from '../repositories/auditRepository';
import type { ListAuditQuery } from '../../shared/schemas';

// Where a request came from. The routes build it; nothing here knows about HTTP.
export interface AuditContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

interface AuditInput {
  type: AuditType;
  outcome: AuditEventAttrs['outcome'];
  actor?: Pick<TokenPayload, 'sub' | 'email' | 'role'> | (PublicUser & { sub?: never }) | undefined;
  target?: AuditEventAttrs['target'];
  detail?: string | undefined;
}

// Records a security-relevant event. It must never break the request it describes, so a
// failure to write is logged and swallowed.
export async function recordAudit(input: AuditInput, context: AuditContext): Promise<void> {
  try {
    const { actor, target, detail } = input;
    await repository.insert({
      type: input.type,
      outcome: input.outcome,
      ...(actor
        ? {
            actor: {
              id: 'sub' in actor && actor.sub ? actor.sub : (actor as PublicUser).id,
              email: actor.email,
              role: actor.role,
            },
          }
        : {}),
      ...(target ? { target } : {}),
      ...(detail ? { detail: detail.slice(0, 300) } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 300) } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
      at: new Date(),
    });
  } catch (error) {
    logger.error({ err: error, auditType: input.type }, 'Could not record audit event');
  }
}

export async function listAudit(query: ListAuditQuery) {
  const { events, total } = await repository.page(query, {
    skip: (query.page - 1) * query.limit,
    limit: query.limit,
  });
  return {
    events,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}
