import { agentStatus, statusTransitions, terminalStatuses } from '../../shared/ticket-constants';
import type { AgentResolutionInput } from '../../shared/schemas';
import type { TokenPayload } from '../auth';
import { activityEntry } from '../domain/activity';
import { postingRefusal } from '../domain/agentPolicy';
import { commentEvent, patchEvents } from '../domain/outbox';
import { assertAgent, assertAgentScope } from '../domain/permissions';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import * as comments from '../repositories/commentRepository';
import * as kb from '../repositories/kbRepository';
import * as tickets from '../repositories/ticketRepository';
import { transaction } from '../repositories/transaction';
import { AGENT_IDENTITY } from '../security/accessToken';
import { getSettings } from './agentSettingsService';
import * as outbox from './outboxService';
import { present } from './ticketService';

// The agent answering a ticket itself, with nobody approving it first (auto mode, docs/adr/014). This
// is the one place the agent speaks to a requester alone, so it is the one place the rules are checked
// again, on the server, whatever the agent did or believes: the settings are read fresh (so the kill
// switch works), the mode and the allowlist are checked against the ticket's category as it is now,
// after the agent's own triage, a Security ticket and anything under high confidence are refused, and
// the answer can only be given once. The reply, the status change and their events commit together.

const MAX_ATTEMPTS = 3;

export async function postResolution(user: TokenPayload, input: AgentResolutionInput) {
  assertAgent(user);
  assertAgentScope(user, input.ticketId);

  // A reply may only rely on articles that exist. (That it read them is checked in the agent, where
  // the run's memory is; that they exist is something only the server can say.)
  const cited = [...new Set(input.citedKbIds)];
  const found = await Promise.all(cited.map((id) => kb.findByArticleId(id)));
  const missing = cited.filter((_, index) => !found[index]);
  if (missing.length > 0) {
    throw new ValidationError(`There is no article ${missing.join(', ')}.`, [
      { field: 'citedKbIds', message: 'Cite only articles that exist.' },
    ]);
  }

  for (let attempt = 1; ; attempt += 1) {
    const existing = await tickets.findById(input.ticketId);
    if (!existing) throw new NotFoundError('Ticket not found.');

    if (existing.agent?.proposalStatus === 'posted') {
      throw new ConflictError('DUPLICATE', 'The agent has already answered this ticket.');
    }
    if ((terminalStatuses as readonly string[]).includes(existing.status)) {
      throw new ConflictError('INVALID_TRANSITION', 'The ticket is already finished.');
    }
    // Read on every attempt, so a switch flipped meanwhile is seen.
    const refusal = postingRefusal(await getSettings(), existing.category, input.confidence);
    if (refusal) throw new ForbiddenError(refusal);

    const moves = statusTransitions[existing.status as keyof typeof statusTransitions] as
      readonly string[] | undefined;
    const status = moves?.includes(agentStatus) ? agentStatus : existing.status;

    const updated = await transaction(async (tx) => {
      const next = await tickets.updateAtVersion(
        input.ticketId,
        existing.__v,
        {
          set: {
            status,
            agent: {
              ...existing.agent,
              triageSource: 'agent',
              proposalStatus: 'posted',
              ...(user.runId && /^[a-f\d]{24}$/i.test(user.runId) ? { lastRunId: user.runId } : {}),
            },
          },
          clearResolvedAt: false,
          activity: [
            activityEntry(user, {
              action: 'agent_posted',
              detail: `Answered without review (${cited.join(', ')})`,
            }),
            ...(status !== existing.status
              ? [
                  activityEntry(user, {
                    action: 'status_changed',
                    from: existing.status,
                    to: status,
                    detail: 'Waiting for the requester to confirm',
                  }),
                ]
              : []),
          ],
        },
        tx
      );
      if (!next) return null;

      await comments.create(
        {
          ticketId: input.ticketId,
          body: input.replyMarkdown,
          visibility: 'public',
          author: {
            id: AGENT_IDENTITY.id,
            name: AGENT_IDENTITY.name,
            email: AGENT_IDENTITY.email,
            role: 'agent',
          },
          // No approvedBy: nobody reviewed it, and the interface says so.
          source: 'agent',
        },
        tx
      );
      await outbox.record(
        [commentEvent(existing, user, 'public'), ...patchEvents(existing, next, user)],
        tx
      );
      return next;
    });

    if (updated) return present(updated, user);

    // Lost a race with an edit: look again, a few times, then give up.
    if (!(await tickets.exists(input.ticketId))) throw new NotFoundError('Ticket not found.');
    if (attempt >= MAX_ATTEMPTS) {
      throw new ConflictError(
        'VERSION_CONFLICT',
        'This ticket changed while it was being answered. Try again.'
      );
    }
  }
}
