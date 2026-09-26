import type { PublicUser, TokenPayload } from '../auth';
import { actorRoles, agentRole } from '../../shared/ticket-constants';
import { getAuthSecret } from './secret';

// Short-lived: a stolen access token is useful for minutes, not hours. Staying signed
// in is the refresh token's job (see sessionService).
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// An agent token is minted per run and only has to outlive one run (a handful of model
// calls), so it is shorter still.
export const SERVICE_TOKEN_TTL_SECONDS = 10 * 60;

// Who the agent appears as in comments and in a ticket's history.
export const AGENT_IDENTITY = {
  id: 'service-desk-agent',
  name: 'Service Desk Agent',
  email: 'agent@service.local',
} as const;

const OBJECT_ID = /^[a-f\d]{24}$/i;

const ISSUER = 'it-ticketing-system';
const AUDIENCE = 'it-ticketing-api';

// jose is an ES module. The compiled server is CommonJS, and require() of an ES module only works
// on Node 20.19+, 22.12+ and 24: on an older 22.x (a hosting platform's runtime can be one) the
// require() at the top of the file fails, the whole app fails to load, and every route, even
// /api/health, answers 500. A dynamic import() works on every version, so it is loaded that way.
// Do not turn this back into a static import (accessToken.test.ts checks for it).
const loadJose = () => import('jose');

const signingKey = () => new TextEncoder().encode(getAuthSecret());

export async function issueAccessToken(user: PublicUser): Promise<string> {
  const { SignJWT } = await loadJose();
  return new SignJWT({ name: user.name, email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey());
}

// A token for the service desk agent, good for one ticket and one run. The ticket id is
// the whole of its authority: the API refuses the agent every other ticket (see
// domain/permissions.ts), so a leaked or misled agent can only ever touch this one.
export async function issueServiceToken(scope: {
  ticketId: string;
  runId: string;
}): Promise<string> {
  if (!OBJECT_ID.test(scope.ticketId)) throw new Error('A service token needs a valid ticket id.');
  if (!scope.runId) throw new Error('A service token needs a run id.');

  const { SignJWT } = await loadJose();
  return new SignJWT({
    name: AGENT_IDENTITY.name,
    email: AGENT_IDENTITY.email,
    role: agentRole,
    tid: scope.ticketId,
    rid: scope.runId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(AGENT_IDENTITY.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SERVICE_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey());
}

// The token's claims, or null for anything that is not a valid, unexpired token we
// issued (wrong signature, algorithm, issuer, audience, expiry, or shape). A missing
// or weak production secret throws instead, so it is a 503 and not a quiet 401.
export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  if (!token) return null;
  const key = signingKey();
  // Loaded outside the try below, so a failure to load jose is an error, not "an invalid token".
  const { jwtVerify } = await loadJose();

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const { sub, name, email, role, exp, tid, rid } = payload as Record<string, unknown>;
    if (
      typeof sub !== 'string' ||
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof exp !== 'number' ||
      !(actorRoles as readonly unknown[]).includes(role)
    ) {
      return null;
    }

    // An agent token is only meaningful with the ticket it is scoped to. Without one it
    // would be an agent with no limit, so it is not a valid token at all.
    if (role === agentRole) {
      if (typeof tid !== 'string' || !OBJECT_ID.test(tid) || typeof rid !== 'string' || !rid) {
        return null;
      }
      return { sub, name, email, role: agentRole, exp, ticketId: tid, runId: rid };
    }
    return { sub, name, email, role: role as TokenPayload['role'], exp };
  } catch (_error) {
    return null;
  }
}
