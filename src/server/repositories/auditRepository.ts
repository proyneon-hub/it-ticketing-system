import AuditEvent, {
  type AuditEventAttrs,
  type AuditEventRecord,
  type AuditType,
} from '../models/AuditEvent';

export type { AuditEventAttrs, AuditEventRecord, AuditType };

export async function insert(event: AuditEventAttrs): Promise<void> {
  await AuditEvent.create(event);
}

export async function page(
  { type }: { type?: AuditType | undefined },
  { skip, limit }: { skip: number; limit: number }
): Promise<{ events: AuditEventRecord[]; total: number }> {
  const filter = type ? { type } : {};
  const [events, total] = await Promise.all([
    AuditEvent.find(filter)
      .sort({ at: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<AuditEventRecord[]>(),
    AuditEvent.countDocuments(filter),
  ]);
  return { events, total };
}
