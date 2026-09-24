import type { PublicUser } from '../auth';
import { demoUsers } from '../demoUsers';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import * as refreshTokens from '../repositories/refreshTokenRepository';
import * as repository from '../repositories/userRepository';
import type { UserRecord } from '../repositories/userRepository';
import { hashPassword, verifyPassword } from '../security/password';
import type { Role } from '../../shared/ticket-constants';

export const toPublicUser = (
  user: Pick<UserRecord, '_id' | 'name' | 'email' | 'role'>
): PublicUser => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
});

function assertValidUserId(id: string): void {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw new ValidationError('Invalid user id.');
}

let demoUsersReady: Promise<void> | undefined;

// Makes sure the three demo accounts exist, once per server instance. The live demo has
// no seeding step, so the first sign-in creates them. Existing accounts are left alone,
// so a demo user's changed role or password survives. DEMO_USERS=off disables it.
export function ensureDemoUsers(): Promise<void> {
  if (process.env.DEMO_USERS === 'off') return Promise.resolve();

  demoUsersReady =
    demoUsersReady ??
    (async () => {
      for (const demo of demoUsers) {
        if (await repository.emailExists(demo.email)) continue;
        await repository.createIfMissing({
          email: demo.email,
          name: demo.name,
          role: demo.role,
          passwordHash: await hashPassword(demo.password),
        });
      }
    })().catch((error) => {
      demoUsersReady = undefined; // Try again on the next sign-in.
      throw error;
    });

  return demoUsersReady;
}

// The user for a correct email and password, otherwise null. It does the same work either
// way, so an unknown email cannot be told apart from a wrong password by timing.
export async function authenticate(email: string, password: string): Promise<PublicUser | null> {
  const user = await repository.findByEmailWithHash(email);
  const matches = await verifyPassword(user?.passwordHash, password);
  return user && matches ? toPublicUser(user) : null;
}

export async function getPublicUser(id: string): Promise<PublicUser | null> {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  const user = await repository.findById(id);
  return user ? toPublicUser(user) : null;
}

export async function listUsers() {
  const users = await repository.list();
  return users.map((user) => ({ ...toPublicUser(user), createdAt: user.createdAt }));
}

// Changes a user's role, never leaving the system without an admin. It runs in a
// transaction, and the role change ends the user's sessions so it takes effect at their
// next refresh rather than after the refresh token's full lifetime.
export async function changeRole(
  id: string,
  role: Role
): Promise<{ user: PublicUser; previousRole: Role }> {
  assertValidUserId(id);
  await repository.ensureAdminGuard();

  return repository.transaction(async (session) => {
    await repository.lockAdminGuard(session);

    const target = await repository.findById(id, session);
    if (!target) throw new NotFoundError('User not found.');

    if (
      target.role === 'admin' &&
      role !== 'admin' &&
      (await repository.countOtherAdmins(id, session)) === 0
    ) {
      throw new ConflictError('LAST_ADMIN', 'There must always be at least one admin.');
    }

    await repository.setRole(id, role, session);
    await refreshTokens.revokeAllForUser(id, new Date(), session);

    return { user: toPublicUser({ ...target, role }), previousRole: target.role };
  });
}
