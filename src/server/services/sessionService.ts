import { createHash, randomBytes, randomUUID } from 'crypto';
import type { PublicUser } from '../auth';
import { refreshTtlMs } from '../security/cookies';
import { issueAccessToken } from '../security/accessToken';
import * as repository from '../repositories/refreshTokenRepository';
import { getPublicUser } from './userService';

// Signing in gives two credentials. The access token is a short-lived JWT the client
// sends on every request. The refresh token is a random value, kept only in an httpOnly
// cookie, that can be exchanged for a new access token. Refresh tokens are single use:
// each exchange retires the old one and issues the next, all in one "family". If a
// retired token ever comes back, someone has a copy, so the whole family is ended.

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface SessionMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export type RefreshOutcome =
  | { kind: 'ok'; session: Session }
  | { kind: 'invalid' }
  // A token that had already been used was presented again.
  | { kind: 'reuse'; userId: string };

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

async function issue(user: PublicUser, familyId: string, meta: SessionMeta): Promise<Session> {
  const refreshToken = newToken();
  await repository.create({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + refreshTtlMs()),
    ...(meta.ip ? { ip: meta.ip } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 300) } : {}),
  });
  return { accessToken: await issueAccessToken(user), refreshToken, user };
}

export const startSession = (user: PublicUser, meta: SessionMeta): Promise<Session> =>
  issue(user, randomUUID(), meta);

export async function refreshSession(
  presented: string,
  meta: SessionMeta
): Promise<RefreshOutcome> {
  const tokenHash = hashToken(presented);
  const now = new Date();

  const claimed = await repository.claim(tokenHash, now);
  if (!claimed) {
    const known = await repository.findByHash(tokenHash);
    // Only a token that was already exchanged counts as reuse. One that was merely
    // revoked (sign-out, or the fallout of an earlier reuse) is just invalid.
    if (known?.usedAt) {
      await repository.revokeFamily(known.familyId, now);
      return { kind: 'reuse', userId: known.userId };
    }
    return { kind: 'invalid' };
  }

  // Read the user afresh: a role change or removal since sign-in takes effect here.
  const user = await getPublicUser(claimed.userId);
  if (!user) {
    await repository.revokeFamily(claimed.familyId, now);
    return { kind: 'invalid' };
  }

  return { kind: 'ok', session: await issue(user, claimed.familyId, meta) };
}

// Ends the session the token belongs to. Returns whose it was, if it was known.
export async function endSession(presented: string): Promise<string | undefined> {
  const known = await repository.findByHash(hashToken(presented));
  if (!known) return undefined;
  await repository.revokeFamily(known.familyId, new Date());
  return known.userId;
}
