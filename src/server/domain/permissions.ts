import type { TokenPayload } from '../auth';
import type { TicketAttrs } from '../../shared/ticket-types';
import { ForbiddenError } from '../errors';

// Requesters may only touch descriptive fields. Workflow, assignment, SLA and
// requester identity fields stay with staff, otherwise a requester could hand
// their ticket to another user's queue.
const REQUESTER_EDITABLE_FIELDS: readonly string[] = [
  'title',
  'description',
  'priority',
  'category',
];

// Requesters only ever see tickets raised under their own email address. Returns
// that address for a requester, and undefined for staff, who see everything.
export const requesterScope = (user: TokenPayload): string | undefined =>
  user.role === 'user' ? user.email : undefined;

// Throws unless `user` may apply `patch` to `ticket`.
export function assertCanMutateTicket(
  user: TokenPayload,
  ticket: Pick<TicketAttrs, 'requesterEmail'>,
  patch: object
): void {
  if (user.role !== 'user') return;

  if (String(ticket.requesterEmail || '').toLowerCase() !== user.email.toLowerCase()) {
    throw new ForbiddenError('Users can only manage tickets they created.');
  }

  const disallowed = Object.keys(patch).filter(
    (field) => !REQUESTER_EDITABLE_FIELDS.includes(field)
  );
  if (disallowed.length > 0) {
    throw new ForbiddenError('Users cannot update workflow, assignment, requester, or SLA fields.');
  }
}

// What a requester creating a ticket cannot choose: their identity, the workflow
// state and the owner are set from their session, whatever the request says.
export function requesterOverrides(user: TokenPayload): Partial<TicketAttrs> {
  return {
    requesterName: user.name,
    requesterEmail: user.email,
    requesterUserId: user.sub,
    status: 'open',
    assignee: 'Unassigned',
  };
}
