import type { FilterQuery, PipelineStage, UpdateQuery } from 'mongoose';
import {
  priorities,
  slaHoursByPriority,
  statuses,
  terminalStatuses,
} from '../../shared/ticket-constants';
import type { TokenPayload } from '../auth';
import { assertTransition, isReopen } from '../domain/ticketWorkflow';
import { HttpError, badRequest, forbidden } from '../errors';
import Counter from '../models/Counter';
import Ticket, {
  type ActivityEntry,
  type TicketAttrs,
  type TicketDocument,
  type TicketRecord,
} from '../models/Ticket';
import type {
  CreateTicketInput,
  ExportQuery,
  ListQuery,
  PatchTicketInput,
} from '../validation/tickets';

const HOUR_MS = 60 * 60 * 1000;
const DUE_SOON_WINDOW_MS = 24 * HOUR_MS;
// Exports stream the whole filtered set; the cap keeps a huge queue from exhausting memory.
const EXPORT_ROW_LIMIT = 10000;
// Requesters may only touch descriptive fields. Workflow, assignment, SLA and
// requester identity fields stay with staff, otherwise a requester could hand
// their ticket to another user's queue.
const REQUESTER_EDITABLE_FIELDS: readonly string[] = [
  'title',
  'description',
  'priority',
  'category',
];

const isTerminal = (status: string): boolean =>
  (terminalStatuses as readonly string[]).includes(status);
const escapeRegex = (value: string): string => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notFound = () => new HttpError(404, 'Ticket not found.');

function assertValidObjectId(id: string): void {
  if (!/^[a-f\d]{24}$/i.test(String(id))) {
    throw badRequest('Invalid ticket id.');
  }
}

type TicketFilter = FilterQuery<TicketAttrs>;

// Requesters only ever see tickets raised under their own email address.
function applyRoleScope(filter: TicketFilter, user: TokenPayload): TicketFilter {
  return user.role === 'user' ? { ...filter, requesterEmail: user.email } : filter;
}

export function buildTicketFilter(
  query: Partial<ListQuery>,
  user: TokenPayload,
  now = new Date()
): TicketFilter {
  const filter: TicketFilter = {};

  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.assignedTo) filter.assignee = { $regex: escapeRegex(query.assignedTo), $options: 'i' };

  if (query.sla) {
    // SLA risk only applies to unresolved work. Combine with an explicit status
    // filter instead of overwriting it: asking for "resolved AND breached"
    // matches nothing rather than silently ignoring the status.
    if (!query.status) {
      filter.status = { $nin: [...terminalStatuses] };
    } else if (isTerminal(query.status)) {
      filter.status = { $in: [] };
    }

    filter.dueAt =
      query.sla === 'breached'
        ? { $lt: now }
        : { $gte: now, $lte: new Date(now.getTime() + DUE_SOON_WINDOW_MS) };
  }

  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
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

  return applyRoleScope(filter, user);
}

// _id is the tie-breaker so pages stay stable when many tickets share a status or priority.
function sortDirection(query: Pick<ListQuery, 'sortOrder'>): 1 | -1 {
  return query.sortOrder === 'asc' ? 1 : -1;
}

async function findSortedTickets(
  filter: TicketFilter,
  query: Pick<ListQuery, 'sortBy' | 'sortOrder'>,
  { skip = 0, limit }: { skip?: number; limit?: number } = {}
): Promise<TicketRecord[]> {
  const direction = sortDirection(query);

  if (query.sortBy === 'priority') {
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

  let cursor = Ticket.find(filter)
    .sort({ [query.sortBy]: direction, _id: direction })
    .skip(skip);
  if (limit) cursor = cursor.limit(limit);
  return cursor.lean<TicketRecord[]>();
}

export async function listTickets(user: TokenPayload, query: ListQuery) {
  const filter = buildTicketFilter(query, user);
  const skip = (query.page - 1) * query.limit;

  const [tickets, total] = await Promise.all([
    findSortedTickets(filter, query, { skip, limit: query.limit }),
    Ticket.countDocuments(filter),
  ]);

  return {
    tickets,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function getTicket(user: TokenPayload, id: string): Promise<TicketRecord> {
  assertValidObjectId(id);
  const ticket = await Ticket.findOne(applyRoleScope({ _id: id }, user)).lean<TicketRecord>();
  if (!ticket) throw notFound();
  return ticket;
}

interface GroupCount {
  _id: string;
  count: number;
}

export async function getStats(user: TokenPayload) {
  const baseMatch = applyRoleScope({}, user);
  const openMatch: TicketFilter = { ...baseMatch, status: { $nin: [...terminalStatuses] } };
  const now = new Date();
  const dueSoon = new Date(now.getTime() + DUE_SOON_WINDOW_MS);

  const [statusCounts, priorityCounts, total, breached, dueSoonCount] = await Promise.all([
    Ticket.aggregate<GroupCount>([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Ticket.aggregate<GroupCount>([
      { $match: baseMatch },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
    Ticket.countDocuments(baseMatch),
    Ticket.countDocuments({ ...openMatch, dueAt: { $lt: now } }),
    Ticket.countDocuments({ ...openMatch, dueAt: { $gte: now, $lte: dueSoon } }),
  ]);

  const byStatus: Record<string, number> = Object.fromEntries(statuses.map((item) => [item, 0]));
  const byPriority: Record<string, number> = Object.fromEntries(
    priorities.map((item) => [item, 0])
  );
  for (const row of statusCounts) byStatus[row._id] = row.count;
  for (const row of priorityCounts) byPriority[row._id] = row.count;

  return { total, byStatus, byPriority, sla: { breached, dueSoon: dueSoonCount } };
}

interface ActivityInput {
  action: string;
  from?: unknown;
  to?: unknown;
  detail?: string;
}

function activityEntry(
  user: TokenPayload,
  { action, from, to, detail }: ActivityInput
): ActivityEntry {
  return {
    action,
    actorName: user.name,
    actorRole: user.role,
    actorEmail: user.email,
    ...(from !== undefined ? { from: String(from || '') } : {}),
    ...(to !== undefined ? { to: String(to || '') } : {}),
    ...(detail ? { detail } : {}),
  };
}

const TRACKED_FIELDS = [
  ['status', 'status_changed'],
  ['priority', 'priority_changed'],
  ['assignee', 'assignee_changed'],
] as const;

function activityEntriesForPatch(
  user: TokenPayload,
  existing: TicketRecord,
  payload: PatchTicketInput
): ActivityEntry[] {
  const entries = TRACKED_FIELDS.filter(([field]) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  )
    .filter(([field]) => String(existing[field] || '') !== String(payload[field] || ''))
    .map(([field, action]) =>
      activityEntry(user, { action, from: existing[field], to: payload[field] })
    );

  // Milestones are logged when the status actually changes, not every time a
  // client re-sends the current one.
  if (payload.status && payload.status !== existing.status) {
    if (payload.status === 'resolved')
      entries.push(activityEntry(user, { action: 'ticket_resolved' }));
    if (payload.status === 'closed') entries.push(activityEntry(user, { action: 'ticket_closed' }));
    if (isReopen(existing.status, payload.status))
      entries.push(activityEntry(user, { action: 'ticket_reopened' }));
  }

  if (entries.length === 0) {
    entries.push(
      activityEntry(user, {
        action: 'ticket_updated',
        detail: `Updated ${Object.keys(payload).join(', ')}`,
      })
    );
  }

  return entries;
}

// Atomic $inc keeps ticket numbers unique and gap-free under concurrent creates.
async function generateTicketNumber(): Promise<string> {
  const counter = await Counter.findByIdAndUpdate(
    'ticket',
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `TKT-${String(counter.seq).padStart(4, '0')}`;
}

export async function createTicket(
  user: TokenPayload,
  payload: CreateTicketInput
): Promise<TicketDocument> {
  const data: Partial<TicketAttrs> = { ...payload };

  if (user.role === 'user') {
    // Requesters cannot pick the requester identity, workflow state or owner.
    data.requesterName = user.name;
    data.requesterEmail = user.email;
    data.requesterUserId = user.sub;
    data.status = 'open';
    data.assignee = 'Unassigned';
  }

  data.ticketNumber = await generateTicketNumber();
  data.createdByRole = user.role;
  data.activity = [
    activityEntry(user, { action: 'ticket_created', detail: `Ticket created by ${user.role}` }),
  ];

  return Ticket.create(data);
}

function assertCanMutateTicket(
  user: TokenPayload,
  ticket: TicketRecord,
  patch: PatchTicketInput
): void {
  if (user.role !== 'user') return;

  if (String(ticket.requesterEmail || '').toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden('Users can only manage tickets they created.');
  }

  const disallowed = Object.keys(patch).filter(
    (field) => !REQUESTER_EDITABLE_FIELDS.includes(field)
  );
  if (disallowed.length > 0) {
    throw forbidden('Users cannot update workflow, assignment, requester, or SLA fields.');
  }
}

interface TimestampChanges {
  set: { resolvedAt?: Date; dueAt?: Date };
  unset: { resolvedAt?: 1 };
}

// Derives the resolvedAt / dueAt side effects of a change so the timestamps
// always agree with the ticket's current workflow state.
export function deriveTimestampChanges(
  existing: Pick<TicketRecord, 'status' | 'priority' | 'resolvedAt'> & { createdAt?: Date },
  payload: PatchTicketInput
): TimestampChanges {
  const set: TimestampChanges['set'] = {};
  const unset: TimestampChanges['unset'] = {};

  if (payload.status) {
    if (isTerminal(payload.status)) {
      if (!isTerminal(existing.status) || !existing.resolvedAt) set.resolvedAt = new Date();
    } else if (isTerminal(existing.status)) {
      unset.resolvedAt = 1; // Reopened: the ticket is no longer resolved.
    }
  }

  if (payload.priority && payload.priority !== existing.priority && payload.dueAt === undefined) {
    // A new priority carries a new SLA target, measured from when the ticket was raised.
    const raisedAt = existing.createdAt ? new Date(existing.createdAt) : new Date();
    set.dueAt = new Date(raisedAt.getTime() + slaHoursByPriority[payload.priority] * HOUR_MS);
  }

  return { set, unset };
}

// A version filter that also matches documents written before versioning existed.
const versionFilter = (version: number | undefined) =>
  version === undefined ? { $exists: false } : version;

const versionConflict = () =>
  new HttpError(409, 'This ticket changed since you loaded it. Reload it and try again.');

// Without If-Match the caller has not seen a specific version, so a lost race is
// retried against the fresh ticket instead of failing.
const MAX_UNCONDITIONAL_ATTEMPTS = 3;

// Every update is one atomic findOneAndUpdate guarded by the version it was
// computed from. If another write got in first the guard matches nothing, so a
// change (and the `from` values in its activity entries) is never built from a
// stale copy. `expectedVersion` is the caller's If-Match: when it does not match
// the current version the update is refused with 409.
export async function updateTicket(
  user: TokenPayload,
  id: string,
  payload: PatchTicketInput,
  { expectedVersion }: { expectedVersion?: number | undefined } = {}
): Promise<TicketDocument> {
  assertValidObjectId(id);
  if (Object.keys(payload).length === 0) {
    throw badRequest('No supported ticket fields were provided.');
  }

  for (let attempt = 1; ; attempt += 1) {
    const existing = await Ticket.findById(id).lean<TicketRecord>();
    if (!existing) throw notFound();

    assertCanMutateTicket(user, existing, payload);
    if (expectedVersion !== undefined && expectedVersion !== (existing.__v ?? 0)) {
      throw versionConflict();
    }
    if (payload.status) assertTransition(existing.status, payload.status, user.role);

    if (payload.status === 'assigned' && (payload.assignee || existing.assignee) === 'Unassigned') {
      throw badRequest('Assigned tickets need an assignee.');
    }

    const { set, unset } = deriveTimestampChanges(existing, payload);
    const update: UpdateQuery<TicketAttrs> = {
      $set: { ...payload, ...set },
      $push: { activity: { $each: activityEntriesForPatch(user, existing, payload) } },
      $inc: { __v: 1 },
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    };

    const updated = await Ticket.findOneAndUpdate(
      { _id: id, __v: versionFilter(existing.__v) },
      update,
      { new: true, runValidators: true }
    );
    if (updated) return updated;

    // Lost the race: someone changed or deleted the ticket after we read it.
    if (!(await Ticket.exists({ _id: id }))) throw notFound();
    if (expectedVersion !== undefined || attempt >= MAX_UNCONDITIONAL_ATTEMPTS) {
      throw versionConflict();
    }
  }
}

export async function deleteTicket(id: string): Promise<void> {
  assertValidObjectId(id);
  const ticket = await Ticket.findByIdAndDelete(id);
  if (!ticket) throw notFound();
}

// Spreadsheet apps execute cells that start with = + - @, so text a requester
// controls (like a title) is prefixed with an apostrophe to keep it inert.
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  'Ticket ID',
  'Title',
  'Status',
  'Priority',
  'Requester',
  'Assigned To',
  'Created At',
  'Updated At',
  'SLA Due At',
  'SLA Breached',
];

function ticketToCsvRow(ticket: TicketRecord, now = Date.now()): string[] {
  const dueAt = ticket.dueAt ? new Date(ticket.dueAt) : null;
  const isSlaBreached = dueAt && !isTerminal(ticket.status) && dueAt.getTime() < now;

  return [
    ticket.ticketNumber || ticket._id,
    ticket.title,
    ticket.status,
    ticket.priority,
    ticket.requesterEmail || ticket.requesterName,
    ticket.assignee,
    ticket.createdAt,
    ticket.updatedAt,
    ticket.dueAt,
    isSlaBreached ? 'Yes' : 'No',
  ].map(csvEscape);
}

export async function exportTicketsCsv(user: TokenPayload, query: ExportQuery): Promise<string> {
  const filter = buildTicketFilter(query, user);
  const tickets = await findSortedTickets(filter, query, { limit: EXPORT_ROW_LIMIT });
  const rows = [CSV_HEADER.map(csvEscape), ...tickets.map((ticket) => ticketToCsvRow(ticket))];
  return rows.map((row) => row.join(',')).join('\n');
}
