import type { AgentEscalationInput } from '../../shared/schemas';
import type { TokenPayload } from '../auth';
import { activityEntry } from '../domain/activity';
import { commentEvent, patchEvents } from '../domain/outbox';
import { assertAgent, assertAgentScope } from '../domain/permissions';
import { ConflictError, NotFoundError } from '../errors';
import * as comments from '../repositories/commentRepository';
import * as tickets from '../repositories/ticketRepository';
import { transaction } from '../repositories/transaction';
import * as outbox from './outboxService';
import { present } from './ticketService';

// The agent handing a ticket to a person (docs/adr/011). One request does what an escalation is: the
// ticket goes to a group, and the summary is left as an internal note for whoever picks it up. Both
// happen in one transaction, so a ticket is never assigned without its summary or the reverse.
// Only the agent may call it, and only for the ticket its run was started for.

const MAX_ATTEMPTS = 3;

const versionConflict = () =>
  new ConflictError(
    'VERSION_CONFLICT',
    'This ticket changed while it was being escalated. Try again.'
  );

export async function escalateTicket(user: TokenPayload, input: AgentEscalationInput) {
  assertAgent(user);
  assertAgentScope(user, input.ticketId);

  for (let attempt = 1; ; attempt += 1) {
    const existing = await tickets.findById(input.ticketId);
    if (!existing) throw new NotFoundError('Ticket not found.');

    // An unassigned ticket becomes assigned; one already being worked, or waiting on its
    // requester, keeps its status and only changes hands.
    const status = existing.status === 'open' ? 'assigned' : existing.status;
    const assigneeChanged = existing.assignee !== input.assigneeGroup;

    const activity = [
      ...(assigneeChanged
        ? [
            activityEntry(user, {
              action: 'assignee_changed',
              from: existing.assignee,
              to: input.assigneeGroup,
            }),
          ]
        : []),
      ...(status !== existing.status
        ? [activityEntry(user, { action: 'status_changed', from: existing.status, to: status })]
        : []),
      activityEntry(user, {
        action: 'agent_escalated',
        detail: `Escalated to ${input.assigneeGroup}: ${input.reason}`,
        internal: true,
      }),
    ];

    const updated = await transaction(async (tx) => {
      const next = await tickets.updateAtVersion(
        input.ticketId,
        existing.__v,
        {
          set: {
            assignee: input.assigneeGroup,
            status,
            agent: {
              ...existing.agent,
              triageSource: 'agent',
              ...(user.runId && /^[a-f\d]{24}$/i.test(user.runId) ? { lastRunId: user.runId } : {}),
            },
          },
          clearResolvedAt: false,
          activity,
        },
        tx
      );
      if (!next) return null;

      await comments.create(
        {
          ticketId: input.ticketId,
          body: `Escalated by the service desk agent (${input.reason}).\n\n${input.summary}`.slice(
            0,
            2000
          ),
          visibility: 'internal',
          author: { id: user.sub, name: user.name, email: user.email, role: 'agent' },
          source: 'agent',
        },
        tx
      );
      await outbox.record(
        [...patchEvents(existing, next, user), commentEvent(existing, user, 'internal')],
        tx
      );
      return next;
    });

    if (updated) return present(updated, user);

    // Lost a race with someone editing the ticket: look again, a few times, then give up.
    if (!(await tickets.exists(input.ticketId))) throw new NotFoundError('Ticket not found.');
    if (attempt >= MAX_ATTEMPTS) throw versionConflict();
  }
}
