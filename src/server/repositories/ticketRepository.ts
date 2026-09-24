import type { FilterQuery, PipelineStage } from 'mongoose';
import { priorities, terminalStatuses, type SortField } from '../../shared/ticket-constants';
import type { ActivityEntry, TicketAttrs } from '../../shared/ticket-types';
import { DUE_SOON_WINDOW_MS } from '../domain/sla';
import type { TicketCriteria } from '../domain/ticketCriteria';
import Counter from '../models/Counter';
import Ticket, { type TicketDocument, type TicketRecord } from '../models/Ticket';

// The only module that talks to Mongoose about tickets. Everything above it works
// with plain data and TicketCriteria, so the storage can change without touching the rules.

export type { TicketDocument, TicketRecord };

type TicketFilter = FilterQuery<TicketAttrs>;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const OPEN_STATUSES = { $nin: [...terminalStatuses] };

// Translates criteria into a MongoDB filter.
export function toFilter(criteria: TicketCriteria): TicketFilter {
  const { status, priority, assignedTo, sla, search, requesterEmail, now } = criteria;
  const filter: TicketFilter = {};

  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (assignedTo) filter.assignee = { $regex: escapeRegex(assignedTo), $options: 'i' };

  if (sla) {
    // Combine with an explicit status filter instead of overwriting it: asking for
    // "resolved AND breached" matches nothing rather than silently ignoring the status.
    if (!status) {
      filter.status = OPEN_STATUSES;
    } else if ((terminalStatuses as readonly string[]).includes(status)) {
      filter.status = { $in: [] };
    }

    filter.dueAt =
      sla === 'breached'
        ? { $lt: now }
        : { $gte: now, $lte: new Date(now.getTime() + DUE_SOON_WINDOW_MS) };
  }

  if (search) {
    const pattern = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [
      { ticketNumber: pattern },
      { title: pattern },
      { description: pattern },
      { requesterName: pattern },
      { requesterEmail: pattern },
      { assignee: pattern },
      { category: pattern },
    ];
  }

  if (requesterEmail) filter.requesterEmail = requesterEmail;

  return filter;
}

export interface Sort {
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
}

// _id is the tie-breaker so pages stay stable when many tickets share a status or priority.
export async function find(
  criteria: TicketCriteria,
  { sortBy, sortOrder }: Sort,
  { skip = 0, limit }: { skip?: number; limit?: number } = {}
): Promise<TicketRecord[]> {
  const filter = toFilter(criteria);
  const direction = sortOrder === 'asc' ? 1 : -1;

  if (sortBy === 'priority') {
    // Priority is an enum, so a plain string sort would order it alphabetically
    // (high, low, medium, urgent). Rank it by its position in the priority list instead.
    const stages: PipelineStage[] = [
      { $match: filter },
      { $addFields: { priorityRank: { $indexOfArray: [priorities, '$priority'] } } },
      { $sort: { priorityRank: direction, _id: direction } },
      { $skip: skip },
      ...(limit ? [{ $limit: limit }] : []),
      { $project: { priorityRank: 0 } },
    ];
    return Ticket.aggregate<TicketRecord>(stages);
  }

  let query = Ticket.find(filter)
    .sort({ [sortBy]: direction, _id: direction })
    .skip(skip);
  if (limit) query = query.limit(limit);
  return query.lean<TicketRecord[]>();
}

export const count = (criteria: TicketCriteria): Promise<number> =>
  Ticket.countDocuments(toFilter(criteria));

// One ticket, honouring the requester scope.
export const findOne = (id: string, requesterEmail?: string): Promise<TicketRecord | null> =>
  Ticket.findOne({ _id: id, ...(requesterEmail ? { requesterEmail } : {}) }).lean<TicketRecord>();

export const findById = (id: string): Promise<TicketRecord | null> =>
  Ticket.findById(id).lean<TicketRecord>();

export const exists = async (id: string): Promise<boolean> =>
  Boolean(await Ticket.exists({ _id: id }));

export const create = (data: Partial<TicketAttrs>): Promise<TicketDocument> => Ticket.create(data);

export async function deleteById(id: string): Promise<boolean> {
  return Boolean(await Ticket.findByIdAndDelete(id));
}

// A change to a ticket, described without any database syntax.
export interface TicketChange {
  // Fields to overwrite.
  set: Partial<TicketAttrs>;
  // Drop the resolvedAt timestamp (the ticket was reopened).
  clearResolvedAt: boolean;
  // History entries to append.
  activity: ActivityEntry[];
}

// Applies `change` only if the ticket is still at `version` (documents written
// before versioning have no version), and bumps the version. Returns null when
// another write got in first or the ticket is gone, so the caller can tell a
// lost race from success.
export async function updateAtVersion(
  id: string,
  version: number | undefined,
  { set, clearResolvedAt, activity }: TicketChange
): Promise<TicketDocument | null> {
  return Ticket.findOneAndUpdate(
    { _id: id, __v: version === undefined ? { $exists: false } : version },
    {
      $set: set,
      $push: { activity: { $each: activity } },
      $inc: { __v: 1 },
      ...(clearResolvedAt ? { $unset: { resolvedAt: 1 } } : {}),
    },
    { new: true, runValidators: true }
  );
}

// Atomic $inc keeps ticket numbers unique and gap-free under concurrent creates.
export async function nextTicketNumber(): Promise<string> {
  const counter = await Counter.findByIdAndUpdate(
    'ticket',
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `TKT-${String(counter.seq).padStart(4, '0')}`;
}

interface GroupCount {
  _id: string;
  count: number;
}

export interface TicketCounts {
  total: number;
  byStatus: GroupCount[];
  byPriority: GroupCount[];
  breached: number;
  dueSoon: number;
}

// Raw numbers behind the dashboard. Counts are limited to `requesterEmail`'s
// tickets when it is set.
export async function counts(requesterEmail: string | undefined, now: Date): Promise<TicketCounts> {
  const scope: TicketFilter = requesterEmail ? { requesterEmail } : {};
  const open: TicketFilter = { ...scope, status: OPEN_STATUSES };
  const dueSoonUntil = new Date(now.getTime() + DUE_SOON_WINDOW_MS);

  const [byStatus, byPriority, total, breached, dueSoon] = await Promise.all([
    Ticket.aggregate<GroupCount>([
      { $match: scope },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Ticket.aggregate<GroupCount>([
      { $match: scope },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
    Ticket.countDocuments(scope),
    Ticket.countDocuments({ ...open, dueAt: { $lt: now } }),
    Ticket.countDocuments({ ...open, dueAt: { $gte: now, $lte: dueSoonUntil } }),
  ]);

  return { total, byStatus, byPriority, breached, dueSoon };
}
