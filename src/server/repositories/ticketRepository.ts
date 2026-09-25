import type { FilterQuery, PipelineStage, SortOrder } from 'mongoose';
import {
  priorities,
  slaPausedStatuses,
  terminalStatuses,
  type SortField,
} from '../../shared/ticket-constants';
import type { ActivityEntry, TicketAttrs } from '../../shared/ticket-types';
import { DUE_SOON_WINDOW_MS } from '../domain/sla';
import type { OpenedRow, ResolvedRow } from '../domain/trends';
import type { TicketCriteria } from '../domain/ticketCriteria';
import Counter from '../models/Counter';
import Ticket, { type TicketDocument, type TicketRecord } from '../models/Ticket';
import type { Tx } from './transaction';

// The only module that talks to Mongoose about tickets. Everything above it works
// with plain data and TicketCriteria, so the storage can change without touching the rules.

export type { TicketDocument, TicketRecord };

type TicketFilter = FilterQuery<TicketAttrs>;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tickets whose SLA clock is being counted: not finished, and not waiting on the requester.
const SLA_NOT_RUNNING: readonly string[] = [...terminalStatuses, ...slaPausedStatuses];
const SLA_RUNNING_STATUSES = { $nin: [...SLA_NOT_RUNNING] };

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
      filter.status = SLA_RUNNING_STATUSES;
    } else if (SLA_NOT_RUNNING.includes(status)) {
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

// `tx` joins the caller's transaction, so the ticket and the event that describes it commit together.
export async function create(data: Partial<TicketAttrs>, tx?: Tx): Promise<TicketDocument> {
  const [ticket] = await Ticket.create([data], tx ? { session: tx } : {});
  return ticket as TicketDocument;
}

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
  { set, clearResolvedAt, activity }: TicketChange,
  tx?: Tx
): Promise<TicketDocument | null> {
  return Ticket.findOneAndUpdate(
    { _id: id, __v: version === undefined ? { $exists: false } : version },
    {
      $set: set,
      $push: { activity: { $each: activity } },
      $inc: { __v: 1 },
      ...(clearResolvedAt ? { $unset: { resolvedAt: 1 } } : {}),
    },
    { new: true, runValidators: true, ...(tx ? { session: tx } : {}) }
  );
}

// Adds one history entry without touching the version: a comment is not an edit, so it
// must not make a concurrent status change fail with a version conflict.
export async function appendActivity(id: string, entry: ActivityEntry, tx?: Tx): Promise<boolean> {
  const result = await Ticket.updateOne(
    { _id: id },
    { $push: { activity: entry } },
    tx ? { session: tx } : {}
  );
  return result.matchedCount > 0;
}

// The tickets the SLA job may need to touch: unresolved, and either past their deadline
// without the breach marker or due within 24 hours without the at-risk marker. Most overdue first.
export const escalationCandidates = (now: Date, limit: number): Promise<TicketRecord[]> =>
  Ticket.find({
    status: SLA_RUNNING_STATUSES,
    $or: [
      { dueAt: { $lt: now }, slaBreachedAt: { $exists: false } },
      {
        dueAt: { $gte: now, $lte: new Date(now.getTime() + DUE_SOON_WINDOW_MS) },
        slaAtRiskAt: { $exists: false },
      },
    ],
  })
    .sort({ dueAt: 1, _id: 1 })
    .limit(limit)
    .lean<TicketRecord[]>();

// Records one SLA step on a ticket, once: it only matches while the marker is absent, the
// ticket is still unresolved and (for a breach) its priority is still what the plan was made
// from. Returns null when any of that changed, so nothing is written over someone else's edit.
// It bumps the version, because the priority may have changed under anyone editing the ticket.
export function applySlaStep(
  id: unknown,
  step: {
    marker: 'slaAtRiskAt' | 'slaBreachedAt';
    set: Partial<TicketAttrs>;
    activity: ActivityEntry;
    expectedPriority?: TicketAttrs['priority'];
  },
  tx: Tx
): Promise<TicketDocument | null> {
  return Ticket.findOneAndUpdate(
    {
      _id: id,
      status: SLA_RUNNING_STATUSES,
      [step.marker]: { $exists: false },
      ...(step.expectedPriority ? { priority: step.expectedPriority } : {}),
    },
    { $set: step.set, $push: { activity: step.activity }, $inc: { __v: 1 } },
    { new: true, session: tx }
  );
}

// Moves a ticket that is waiting on its requester back into work, once: it only matches
// while the ticket is still pending-user, so a technician who got there first is not
// overwritten. Bumps the version, like any other status change. Returns null when the ticket
// was no longer waiting.
export function resumeFromPending(
  id: unknown,
  activity: ActivityEntry,
  tx: Tx
): Promise<TicketDocument | null> {
  return Ticket.findOneAndUpdate(
    { _id: id, status: 'pending-user' },
    { $set: { status: 'in-progress' }, $push: { activity }, $inc: { __v: 1 } },
    { new: true, session: tx }
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

// Daily counts for the trends chart. Tickets are grouped by the calendar day (in
// `timeZone`) they were opened or resolved on; only tickets since `since` are read.
// `met` counts tickets resolved on or before their SLA deadline.
export async function trendBuckets(
  requesterEmail: string | undefined,
  since: Date,
  timeZone: string
): Promise<{ opened: OpenedRow[]; resolved: ResolvedRow[] }> {
  const scope: TicketFilter = requesterEmail ? { requesterEmail } : {};
  const day = (field: string) => ({
    $dateToString: { format: '%Y-%m-%d', date: field, timezone: timeZone },
  });

  const [opened, resolved] = await Promise.all([
    Ticket.aggregate<OpenedRow>([
      { $match: { ...scope, createdAt: { $gte: since } } },
      { $group: { _id: day('$createdAt'), count: { $sum: 1 } } },
    ]),
    Ticket.aggregate<ResolvedRow>([
      { $match: { ...scope, resolvedAt: { $gte: since } } },
      {
        $group: {
          _id: day('$resolvedAt'),
          count: { $sum: 1 },
          totalMs: { $sum: { $subtract: ['$resolvedAt', '$createdAt'] } },
          met: { $sum: { $cond: [{ $lte: ['$resolvedAt', '$dueAt'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  return { opened, resolved };
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
  const open: TicketFilter = { ...scope, status: SLA_RUNNING_STATUSES };
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
