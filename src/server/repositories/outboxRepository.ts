import OutboxEvent, {
  type OutboxEventAttrs,
  type OutboxEventRecord,
  type OutboxPayload,
  type OutboxEventType,
  type OutboxStatus,
} from '../models/OutboxEvent';
import type { OutboxDraft } from '../../shared/outbox-types';
import type { Tx } from './transaction';

export type { OutboxDraft };

export type { OutboxEventRecord, OutboxPayload, OutboxEventType, OutboxStatus };

// Records events in the same transaction as the change that caused them, so an event exists
// if and only if the change was committed.
export async function enqueue(drafts: OutboxDraft[], tx: Tx, now: Date): Promise<void> {
  if (drafts.length === 0) return;
  await OutboxEvent.insertMany(
    drafts.map((draft): Partial<OutboxEventAttrs> => ({
      ...draft,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    })),
    { session: tx }
  );
}

// Takes the oldest event that is due, atomically: two workers asking at once get different
// events (or none), never the same one. Also takes an event another worker locked and then
// abandoned. Counts the attempt as it is taken.
export const claimNext = (now: Date, lockMs: number): Promise<OutboxEventRecord | null> =>
  OutboxEvent.findOneAndUpdate(
    {
      $or: [
        { status: 'pending', nextAttemptAt: { $lte: now } },
        { status: 'sending', lockedUntil: { $lt: now } },
      ],
    },
    {
      $set: { status: 'sending', lockedUntil: new Date(now.getTime() + lockMs) },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1, _id: 1 }, new: true }
  ).lean<OutboxEventRecord>();

export async function markDelivered(id: unknown, now: Date): Promise<void> {
  await OutboxEvent.updateOne(
    { _id: id, status: 'sending' },
    { $set: { status: 'delivered', deliveredAt: now }, $unset: { lockedUntil: 1, lastError: 1 } }
  );
}

export async function markForRetry(id: unknown, nextAttemptAt: Date, error: string): Promise<void> {
  await OutboxEvent.updateOne(
    { _id: id, status: 'sending' },
    {
      $set: { status: 'pending', nextAttemptAt, lastError: error },
      $unset: { lockedUntil: 1 },
    }
  );
}

export async function markDead(id: unknown, error: string): Promise<void> {
  await OutboxEvent.updateOne(
    { _id: id, status: 'sending' },
    { $set: { status: 'dead', lastError: error }, $unset: { lockedUntil: 1 } }
  );
}

// Puts a dead event back in the queue as if it were new. Returns null if there is no such
// dead event.
export const revive = (id: string, now: Date): Promise<OutboxEventRecord | null> =>
  OutboxEvent.findOneAndUpdate(
    { _id: id, status: 'dead' },
    { $set: { status: 'pending', attempts: 0, nextAttemptAt: now }, $unset: { lastError: 1 } },
    { new: true }
  ).lean<OutboxEventRecord>();

export async function page(
  { status }: { status?: OutboxStatus | undefined },
  { skip, limit }: { skip: number; limit: number }
): Promise<{ events: OutboxEventRecord[]; total: number }> {
  const filter = status ? { status } : {};
  const [events, total] = await Promise.all([
    OutboxEvent.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<OutboxEventRecord[]>(),
    OutboxEvent.countDocuments(filter),
  ]);
  return { events, total };
}

export const countByStatus = (): Promise<{ _id: OutboxStatus; count: number }[]> =>
  OutboxEvent.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
