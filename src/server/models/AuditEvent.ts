import mongoose, { type Model, type Types } from 'mongoose';
import {
  actorRoles,
  auditTypes,
  type ActorRole,
  type AuditType,
} from '../../shared/ticket-constants';

export type { AuditType };

export interface AuditEventAttrs {
  type: AuditType;
  outcome: 'success' | 'failure' | 'denied';
  // Who did it. Absent for a failed sign-in, where nobody is authenticated.
  actor?: { id?: string; email?: string; role?: ActorRole };
  target?: { type: string; id?: string; label?: string };
  detail?: string;
  ip?: string;
  userAgent?: string;
  // Matches the x-request-id header and the log line, so an event can be traced.
  requestId?: string;
  at: Date;
}

export type AuditEventRecord = AuditEventAttrs & { _id: Types.ObjectId };

// Optionally delete old events: AUDIT_RETENTION_DAYS=90. Left unset, events are kept
// forever. Changing it later needs `npm run db:sync-indexes`, because MongoDB will not
// alter an existing index's expiry through a normal index build.
const retentionDays = Number(process.env.AUDIT_RETENTION_DAYS);

const auditSchema = new mongoose.Schema<AuditEventAttrs>({
  type: { type: String, enum: auditTypes, required: true },
  outcome: { type: String, enum: ['success', 'failure', 'denied'], required: true },
  actor: {
    id: String,
    email: { type: String, lowercase: true, maxlength: 254 },
    role: { type: String, enum: actorRoles },
  },
  target: { type: { type: String }, id: String, label: { type: String, maxlength: 200 } },
  detail: { type: String, maxlength: 300 },
  ip: { type: String, maxlength: 64 },
  userAgent: { type: String, maxlength: 300 },
  requestId: { type: String, maxlength: 64 },
  at: { type: Date, default: Date.now, required: true },
});

// Newest first is the only way the log is read.
auditSchema.index(
  { at: -1 },
  retentionDays > 0 ? { expireAfterSeconds: Math.round(retentionDays * 86400) } : {}
);
auditSchema.index({ type: 1, at: -1 });

const AuditEvent: Model<AuditEventAttrs> =
  (mongoose.models.AuditEvent as Model<AuditEventAttrs> | undefined) ||
  mongoose.model<AuditEventAttrs>('AuditEvent', auditSchema);

export default AuditEvent;
