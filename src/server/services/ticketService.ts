import { priorities, statuses } from '../../shared/ticket-constants';
import type { TicketAttrs } from '../../shared/ticket-types';
import type { TokenPayload } from '../auth';
import { activityEntriesForPatch, activityEntry } from '../domain/activity';
import { csvHeaderLine, ticketToCsvLine } from '../domain/csv';
import { assertCanMutateTicket, requesterOverrides, requesterScope } from '../domain/permissions';
import { deriveTimestampChanges } from '../domain/sla';
import type { TicketCriteria } from '../domain/ticketCriteria';
import { assertTransition } from '../domain/ticketWorkflow';
import { HttpError, badRequest } from '../errors';
import * as repository from '../repositories/ticketRepository';
import type { TicketDocument, TicketRecord } from '../repositories/ticketRepository';
import type {
  CreateTicketInput,
  ExportQuery,
  ListQuery,
  PatchTicketInput,
} from '../validation/tickets';

// Orchestrates one use case per function: check the caller may do it, apply the
// domain rules, and persist through the repository. HTTP stays in the routes and
// storage in the repository, so the rules here read the way the product works.

// Exports stream the whole filtered set; the cap keeps a huge queue from exhausting memory.
const EXPORT_ROW_LIMIT = 10000;

const notFound = () => new HttpError(404, 'Ticket not found.');

function assertValidObjectId(id: string): void {
  if (!/^[a-f\d]{24}$/i.test(String(id))) {
    throw badRequest('Invalid ticket id.');
  }
}

// What the caller asked for, limited to what their role may see.
function criteriaFor(
  query: Partial<Pick<ListQuery, 'status' | 'priority' | 'assignedTo' | 'sla' | 'search'>>,
  user: TokenPayload
): TicketCriteria {
  return {
    status: query.status,
    priority: query.priority,
    assignedTo: query.assignedTo,
    sla: query.sla,
    search: query.search,
    requesterEmail: requesterScope(user),
    now: new Date(),
  };
}

export async function listTickets(user: TokenPayload, query: ListQuery) {
  const criteria = criteriaFor(query, user);
  const skip = (query.page - 1) * query.limit;

  const [tickets, total] = await Promise.all([
    repository.find(criteria, query, { skip, limit: query.limit }),
    repository.count(criteria),
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
  const ticket = await repository.findOne(id, requesterScope(user));
  if (!ticket) throw notFound();
  return ticket;
}

export async function getStats(user: TokenPayload) {
  const { total, byStatus, byPriority, breached, dueSoon } = await repository.counts(
    requesterScope(user),
    new Date()
  );

  // Every status and priority appears, with zero when nothing has it.
  const statusTotals: Record<string, number> = Object.fromEntries(statuses.map((s) => [s, 0]));
  const priorityTotals: Record<string, number> = Object.fromEntries(priorities.map((p) => [p, 0]));
  for (const row of byStatus) statusTotals[row._id] = row.count;
  for (const row of byPriority) priorityTotals[row._id] = row.count;

  return { total, byStatus: statusTotals, byPriority: priorityTotals, sla: { breached, dueSoon } };
}

export async function createTicket(
  user: TokenPayload,
  payload: CreateTicketInput
): Promise<TicketDocument> {
  const data: Partial<TicketAttrs> = {
    ...payload,
    // Requesters cannot pick the requester identity, workflow state or owner.
    ...(user.role === 'user' ? requesterOverrides(user) : {}),
    ticketNumber: await repository.nextTicketNumber(),
    createdByRole: user.role,
    activity: [
      activityEntry(user, { action: 'ticket_created', detail: `Ticket created by ${user.role}` }),
    ],
  };

  return repository.create(data);
}

const versionConflict = () =>
  new HttpError(409, 'This ticket changed since you loaded it. Reload it and try again.');

// Without If-Match the caller has not seen a specific version, so a lost race is
// retried against the fresh ticket instead of failing.
const MAX_UNCONDITIONAL_ATTEMPTS = 3;

// Every update is one atomic write guarded by the version it was computed from.
// If another write got in first the guard matches nothing, so a change (and the
// `from` values in its activity entries) is never built from a stale copy.
// `expectedVersion` is the caller's If-Match: when it does not match the current
// version the update is refused with 409.
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
    const existing = await repository.findById(id);
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
    const updated = await repository.updateAtVersion(id, existing.__v, {
      set: { ...payload, ...set },
      clearResolvedAt: unset.resolvedAt === 1,
      activity: activityEntriesForPatch(user, existing, payload),
    });
    if (updated) return updated;

    // Lost the race: someone changed or deleted the ticket after we read it.
    if (!(await repository.exists(id))) throw notFound();
    if (expectedVersion !== undefined || attempt >= MAX_UNCONDITIONAL_ATTEMPTS) {
      throw versionConflict();
    }
  }
}

export async function deleteTicket(id: string): Promise<void> {
  assertValidObjectId(id);
  if (!(await repository.deleteById(id))) throw notFound();
}

export async function exportTicketsCsv(user: TokenPayload, query: ExportQuery): Promise<string> {
  const tickets = await repository.find(criteriaFor(query, user), query, {
    limit: EXPORT_ROW_LIMIT,
  });
  return [csvHeaderLine(), ...tickets.map((ticket) => ticketToCsvLine(ticket))].join('\n');
}
