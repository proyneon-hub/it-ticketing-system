import type { TokenPayload } from '../auth';
import type { ActivityEntry, TicketAttrs } from '../../shared/ticket-types';
import type { PatchTicketInput } from '../validation/tickets';
import { isReopen } from './ticketWorkflow';

interface ActivityInput {
  action: string;
  from?: unknown;
  to?: unknown;
  detail?: string;
}

// Who did what, stamped onto the ticket's history.
export function activityEntry(
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

// The history entries a patch produces. `existing` must be the ticket as it is
// right now, so every `from` is the value actually being replaced.
export function activityEntriesForPatch(
  user: TokenPayload,
  existing: Pick<TicketAttrs, 'status' | 'priority' | 'assignee'>,
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
