import type { TokenPayload } from '../auth';
import { agentStatus, type Role } from '../../shared/ticket-constants';
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

// The service desk agent triages: it may set what a triager sets, and hand a ticket to the
// requester (status pending-user, when it posts a resolution). Nothing else. It cannot
// rewrite what the requester wrote, or close, resolve or reopen a ticket.
const AGENT_EDITABLE_FIELDS: readonly string[] = ['category', 'priority', 'assignee', 'status'];

// The agent's token names one ticket, and that is the only one it may read or change.
// Checked in the services, so a route added later cannot forget it.
export function assertAgentScope(user: TokenPayload, ticketId: string): void {
  if (user.role === 'agent' && user.ticketId !== String(ticketId)) {
    throw new ForbiddenError('The agent can only work on the ticket it was started for.');
  }
}

// For everything the agent has no business doing at all: creating tickets, and the
// reports and exports that cover the whole queue. Narrows the caller to a person.
export function assertHuman(user: TokenPayload): asserts user is TokenPayload & { role: Role } {
  if (user.role === 'agent') {
    throw new ForbiddenError('This action is not available to the agent.');
  }
}

// Deciding on the agent's proposals, and everything else about the agent that is for the team, is for
// staff: not requesters, and not the agent itself.
export function assertStaff(user: TokenPayload): void {
  if (user.role !== 'admin' && user.role !== 'technician') {
    throw new ForbiddenError('Only staff can do this.');
  }
}

// What only the agent may do: hand its ticket to a person. Nobody else acts as the agent.
export function assertAgent(user: TokenPayload): asserts user is TokenPayload & { role: 'agent' } {
  if (user.role !== 'agent') throw new ForbiddenError('Only the service desk agent can do this.');
}

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
  if (user.role === 'agent') {
    const disallowed = Object.keys(patch).filter((field) => !AGENT_EDITABLE_FIELDS.includes(field));
    const status = (patch as { status?: unknown }).status;
    if (disallowed.length > 0 || (status !== undefined && status !== agentStatus)) {
      throw new ForbiddenError(
        'The agent can only set category, priority and assignee, and move a ticket to pending-user.'
      );
    }
    return;
  }
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
