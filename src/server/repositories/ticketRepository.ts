import type { FilterQuery, PipelineStage, SortOrder } from 'mongoose';
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

// Someone typing TKT-0012 (or the start of it) wants that ticket, not a text search.
const TICKET_NUMBER_PREFIX = /^TKT-?\d*$/i;

// Ticket numbers are stored upper case, so an anchored, case-sensitive prefix match
// can use the unique index on ticketNumber (a case-insensitive one cannot).
function ticketNumberPrefix(search: string): string {
  return search.toUpperCase().replace(/^TKT(?!-)/, 'TKT-');
}

// Text-search syntax is meant for people writing queries, not for a search box: a
// leading minus excludes a word and quotes demand a phrase. Strip both so the input is
// just words.
function plainWords(search: string): string {
  const words = search
    .replace(/["\\]/g, ' ')
    .replace(/(^|\s)-+/g, '$1')
    .trim();
  return words || search;
}

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
    const text = search.trim();
    if (TICKET_NUMBER_PREFIX.test(text)) {
      filter.ticketNumber = { $regex: `^${escapeRegex(ticketNumberPrefix(text))}` };
    } else {
      // Uses the text index. Matches whole words (and their other forms), not fragments.
      filter.$text = { $search: plainWords(text) };
    }
  }

  if (requesterEmail) filter.requesterEmail = requesterEmail;

  return filter;
}

export interface Sort {
  // Left out, results are ranked best match first after a text search and newest
  // first otherwise.
  sortBy?: SortField | undefined;
  sortOrder: 'asc' | 'desc';
}

interface ResolvedSort {
  sortBy: SortField | 'relevance';
  sortOrder: 'asc' | 'desc';
}

// Relevance only exists for a text search (a ticket-number search has no score).
function resolveSort(filter: TicketFilter, { sortBy, sortOrder }: Sort): ResolvedSort {
  return { sortBy: sortBy ?? (filter.$text ? 'relevance' : 'createdAt'), sortOrder };
}

// _id is the tie-breaker so pages stay stable when many tickets share a status or priority.
function sortSpec({
  sortBy,
  sortOrder,
}: ResolvedSort): Record<string, SortOrder | { $meta: 'textScore' }> {
  const direction = sortOrder === 'asc' ? 1 : -1;
  return sortBy === 'relevance'
    ? { score: { $meta: 'textScore' as const }, _id: direction }
    : { [sortBy]: direction, _id: direction };
}

// The query for a page of tickets in priority order: the shared core of find() and stream().
function priorityStages(filter: TicketFilter, sortOrder: 'asc' | 'desc'): PipelineStage[] {
  const direction = sortOrder === 'asc' ? 1 : -1;
  // Priority is an enum, so a plain string sort would order it alphabetically
  // (high, low, medium, urgent). Rank it by its position in the priority list instead.
  return [
    { $match: filter },
    { $addFields: { priorityRank: { $indexOfArray: [priorities, '$priority'] } } },
    { $sort: { priorityRank: direction, _id: direction } },
  ];
}

export async function find(
  criteria: TicketCriteria,
  sort: Sort,
  { skip = 0, limit }: { skip?: number; limit?: number } = {}
): Promise<TicketRecord[]> {
  const filter = toFilter(criteria);
  const resolved = resolveSort(filter, sort);

  if (resolved.sortBy === 'priority') {
    const stages: PipelineStage[] = [
      ...priorityStages(filter, resolved.sortOrder),
      { $skip: skip },
      ...(limit ? [{ $limit: limit }] : []),
      { $project: { priorityRank: 0 } },
    ];
    return Ticket.aggregate<TicketRecord>(stages);
  }

  let query = Ticket.find(filter).sort(sortSpec(resolved)).skip(skip);
  if (limit) query = query.limit(limit);
  return query.lean<TicketRecord[]>();
}

// Every matching ticket, one at a time from a database cursor, so memory use does
// not grow with the size of the result.
export function stream(criteria: TicketCriteria, sort: Sort): AsyncIterable<TicketRecord> {
  const filter = toFilter(criteria);
  const resolved = resolveSort(filter, sort);

  if (resolved.sortBy === 'priority') {
    return Ticket.aggregate<TicketRecord>([
      ...priorityStages(filter, resolved.sortOrder),
      { $project: { priorityRank: 0 } },
    ]).cursor();
  }
  return Ticket.find(filter).sort(sortSpec(resolved)).lean<TicketRecord>().cursor();
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

// Deletes the ticket and returns its number, or null if there was no such ticket.
export async function deleteById(id: string): Promise<string | null> {
  const deleted = await Ticket.findByIdAndDelete(id).lean<TicketRecord>();
  return deleted ? (deleted.ticketNumber ?? id) : null;
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

// Adds one history entry without touching the version: a comment is not an edit, so it
// must not make a concurrent status change fail with a version conflict.
export async function appendActivity(id: string, entry: ActivityEntry): Promise<boolean> {
  const result = await Ticket.updateOne({ _id: id }, { $push: { activity: entry } });
  return result.matchedCount > 0;
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
