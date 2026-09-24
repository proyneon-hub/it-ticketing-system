import mongoose, { type ClientSession } from 'mongoose';
import type { Role } from '../../shared/ticket-constants';
import Counter from '../models/Counter';
import User, { type UserAttrs, type UserRecord } from '../models/User';

export type { UserRecord };

const options = (session?: ClientSession) => (session ? { session } : {});

export const findById = (id: string, session?: ClientSession): Promise<UserRecord | null> =>
  User.findById(id, null, options(session)).lean<UserRecord>();

// Includes the password hash, which is otherwise never selected.
export const findByEmailWithHash = (email: string): Promise<UserRecord | null> =>
  User.findOne({ email: email.toLowerCase() }).select('+passwordHash').lean<UserRecord>();

export const emailExists = async (email: string): Promise<boolean> =>
  Boolean(await User.exists({ email: email.toLowerCase() }));

// Creates the user unless the email is taken. Safe when several instances start at once.
export async function createIfMissing(attrs: UserAttrs): Promise<void> {
  await User.updateOne(
    { email: attrs.email.toLowerCase() },
    { $setOnInsert: attrs },
    { upsert: true }
  );
}

export const list = (): Promise<UserRecord[]> =>
  User.find().sort({ createdAt: 1, _id: 1 }).lean<UserRecord[]>();

// Runs `work` in a transaction that is retried if it loses a write conflict. Needs
// MongoDB to be a replica set (Atlas is; see docker-compose.yml and npm run dev:db).
export function transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(work);
}

// Every role change writes this one shared document. Two concurrent transactions that
// each demote a different admin would otherwise both see "another admin exists" and
// both commit (write skew), leaving none. Writing the same document makes them conflict,
// so one is retried and sees the other's result.
const ADMIN_GUARD_ID = 'admin-guard';

export async function ensureAdminGuard(): Promise<void> {
  await Counter.updateOne({ _id: ADMIN_GUARD_ID }, { $setOnInsert: { seq: 0 } }, { upsert: true });
}

export async function lockAdminGuard(session: ClientSession): Promise<void> {
  await Counter.updateOne({ _id: ADMIN_GUARD_ID }, { $inc: { seq: 1 } }, { session });
}

export const countOtherAdmins = (id: string, session: ClientSession): Promise<number> =>
  User.countDocuments({ role: 'admin', _id: { $ne: id } }).session(session);

export async function setRole(id: string, role: Role, session: ClientSession): Promise<void> {
  await User.updateOne({ _id: id }, { $set: { role } }, { session });
}
