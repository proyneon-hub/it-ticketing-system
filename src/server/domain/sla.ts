import { slaHoursByPriority, terminalStatuses, type Priority } from '../../shared/ticket-constants';
import type { TicketAttrs } from '../../shared/ticket-types';
import type { PatchTicketInput } from '../../shared/schemas';

export const HOUR_MS = 60 * 60 * 1000;
// A ticket is "due soon" when its SLA deadline falls within this window.
export const DUE_SOON_WINDOW_MS = 24 * HOUR_MS;

export const isTerminal = (status: string): boolean =>
  (terminalStatuses as readonly string[]).includes(status);

// The SLA deadline for a ticket of `priority` raised at `raisedAt`.
export const dueAtFor = (priority: Priority, raisedAt: Date): Date =>
  new Date(raisedAt.getTime() + slaHoursByPriority[priority] * HOUR_MS);

// SLA risk only applies to unresolved work.
export function isSlaBreached(
  ticket: Pick<TicketAttrs, 'status' | 'dueAt'>,
  now: number = Date.now()
): boolean {
  return Boolean(
    ticket.dueAt && !isTerminal(ticket.status) && new Date(ticket.dueAt).getTime() < now
  );
}

interface TimestampChanges {
  set: { resolvedAt?: Date; dueAt?: Date };
  unset: { resolvedAt?: 1 };
}

// Derives the resolvedAt / dueAt side effects of a change so the timestamps
// always agree with the ticket's current workflow state.
export function deriveTimestampChanges(
  existing: Pick<TicketAttrs, 'status' | 'priority' | 'resolvedAt' | 'createdAt'>,
  payload: Pick<PatchTicketInput, 'status' | 'priority' | 'dueAt'>,
  now: Date = new Date()
): TimestampChanges {
  const set: TimestampChanges['set'] = {};
  const unset: TimestampChanges['unset'] = {};

  if (payload.status) {
    if (isTerminal(payload.status)) {
      if (!isTerminal(existing.status) || !existing.resolvedAt) set.resolvedAt = now;
    } else if (isTerminal(existing.status)) {
      unset.resolvedAt = 1; // Reopened: the ticket is no longer resolved.
    }
  }

  if (payload.priority && payload.priority !== existing.priority && payload.dueAt === undefined) {
    // A new priority carries a new SLA target, measured from when the ticket was raised.
    set.dueAt = dueAtFor(payload.priority, existing.createdAt ? new Date(existing.createdAt) : now);
  }

  return { set, unset };
}
