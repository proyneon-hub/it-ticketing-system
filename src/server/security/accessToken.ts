import type { PublicUser, TokenPayload } from '../auth';
import { roles } from '../../shared/ticket-constants';
import { getAuthSecret } from './secret';

// Short-lived: a stolen access token is useful for minutes, not hours. Staying signed
// in is the refresh token's job (see sessionService).
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

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

    const { sub, name, email, role, exp } = payload as Record<string, unknown>;
    if (
      typeof sub !== 'string' ||
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof exp !== 'number' ||
      !(roles as readonly unknown[]).includes(role)
    ) {
      return null;
    }
    return { sub, name, email, role: role as TokenPayload['role'], exp };
  } catch (_error) {
    return null;
  }
}
