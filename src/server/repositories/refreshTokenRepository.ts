import type { ClientSession } from 'mongoose';
import RefreshToken, { type RefreshTokenAttrs } from '../models/RefreshToken';

export type RefreshTokenRecord = RefreshTokenAttrs;

export async function create(attrs: RefreshTokenAttrs): Promise<void> {
  await RefreshToken.create(attrs);
}

// Atomically marks a live token as used and returns it. Only one of several concurrent
// requests presenting the same token can win; the rest get null.
export const claim = (tokenHash: string, now: Date): Promise<RefreshTokenRecord | null> =>
  RefreshToken.findOneAndUpdate(
    {
      tokenHash,
      usedAt: { $exists: false },
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { usedAt: now } }
  ).lean<RefreshTokenRecord>();

export const findByHash = (tokenHash: string): Promise<RefreshTokenRecord | null> =>
  RefreshToken.findOne({ tokenHash }).lean<RefreshTokenRecord>();

// Ends every token descended from one sign-in.
export async function revokeFamily(familyId: string, now: Date): Promise<void> {
  await RefreshToken.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: now } }
  );
}

// Ends every session a user has, for example when their role changes.
export async function revokeAllForUser(
  userId: string,
  now: Date,
  session?: ClientSession
): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: now } },
    session ? { session } : {}
  );
}
