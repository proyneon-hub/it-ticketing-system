import mongoose, { type Model, type Types } from 'mongoose';
import {
  outboxEventTypes,
  outboxStatuses,
  type OutboxEventType,
  type OutboxStatus,
} from '../../shared/ticket-constants';

import type { OutboxPayload } from '../../shared/outbox-types';

export type { OutboxEventType, OutboxPayload, OutboxStatus };

export interface OutboxEventAttrs {
  type: OutboxEventType;
  payload: OutboxPayload;
  status: OutboxStatus;
  // Delivery attempts made so far (counted when an event is claimed).
  attempts: number;
  nextAttemptAt: Date;
  // While an event is being sent it is locked until this time; a worker that dies leaves it
  // to be picked up again once the lock has passed.
  lockedUntil?: Date;
  lastError?: string;
  createdAt: Date;
  deliveredAt?: Date;
}

export type OutboxEventRecord = OutboxEventAttrs & { _id: Types.ObjectId };

const outboxSchema = new mongoose.Schema<OutboxEventAttrs>({
  type: { type: String, enum: outboxEventTypes, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: outboxStatuses, default: 'pending', required: true },
  attempts: { type: Number, default: 0, required: true },
  nextAttemptAt: { type: Date, required: true },
  lockedUntil: { type: Date },
  lastError: { type: String, maxlength: 300 },
  createdAt: { type: Date, default: Date.now, required: true },
  deliveredAt: { type: Date },
});

// What the worker asks for: events that are due, and sending events whose lock has passed.
outboxSchema.index({ status: 1, nextAttemptAt: 1 });
outboxSchema.index({ status: 1, lockedUntil: 1 });
// Delivered events are only kept for a while (OUTBOX_RETENTION_DAYS, default 14). Only
// documents that have a deliveredAt can expire, so dead events stay until an admin acts.
const retentionDays = Number(process.env.OUTBOX_RETENTION_DAYS) || 14;
outboxSchema.index({ deliveredAt: 1 }, { expireAfterSeconds: Math.round(retentionDays * 86400) });

const OutboxEvent: Model<OutboxEventAttrs> =
  (mongoose.models.OutboxEvent as Model<OutboxEventAttrs> | undefined) ||
  mongoose.model<OutboxEventAttrs>('OutboxEvent', outboxSchema);

export default OutboxEvent;
