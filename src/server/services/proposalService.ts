import type { ProposalStatus } from '../../shared/agent-constants';
import { statusTransitions, agentStatus } from '../../shared/ticket-constants';
import type { ApproveProposalInput, RejectProposalInput } from '../../shared/schemas';
import type { TokenPayload } from '../auth';
import { activityEntry } from '../domain/activity';
import { commentEvent, patchEvents } from '../domain/outbox';
import { assertStaff } from '../domain/permissions';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import * as runs from '../repositories/agentRunRepository';
import * as comments from '../repositories/commentRepository';
import * as kb from '../repositories/kbRepository';
import * as tickets from '../repositories/ticketRepository';
import { transaction } from '../repositories/transaction';
import { AGENT_IDENTITY } from '../security/accessToken';
import * as outbox from './outboxService';

// What the agent proposed for a ticket, and a person's decision on it (docs/adr/011). The proposal
// itself lives on the agent's run; the ticket only says where it stands. Approving posts the reply
// as a public comment, marked as the agent's and as approved by that person, and moves the ticket to
// pending-user, all in one transaction. Rejecting posts nothing.

export interface ProposalView {
  status: ProposalStatus;
  runId: string;
  proposal: {
    replyMarkdown: string;
    citedKbIds: string[];
    confidence: string;
    reasoningSummary: string;
  };
  triage?: { category: string; priority: string; assigneeGroup: string } | undefined;
  // The cited articles' titles, so the reviewer can see what the reply is based on.
  citedArticles: { id: string; title: string }[];
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

function assertValidId(id: string): void {
  if (!OBJECT_ID.test(String(id))) throw new ValidationError('Invalid ticket id.');
}

const noProposal = () => new NotFoundError('There is no proposal for this ticket.');

// The ticket and the proposal its agent state points at, or the same "not found" whichever is missing.
async function load(id: string) {
  assertValidId(id);
  const ticket = await tickets.findById(id);
  if (!ticket) throw new NotFoundError('Ticket not found.');
  const runId = ticket.agent?.lastRunId;
  const run = runId ? await runs.findRun(runId) : null;
  if (!run?.proposal) throw noProposal();
  return { ticket, run, proposal: run.proposal };
}

export async function getProposal(user: TokenPayload, id: string): Promise<ProposalView> {
  assertStaff(user);
  const { ticket, run, proposal } = await load(id);

  const articles = await Promise.all(proposal.citedKbIds.map((kbId) => kb.findByArticleId(kbId)));
  return {
    status: ticket.agent?.proposalStatus ?? 'none',
    runId: String(run._id),
    proposal: {
      replyMarkdown: proposal.replyMarkdown,
      citedKbIds: proposal.citedKbIds,
      confidence: proposal.confidence,
      reasoningSummary: proposal.reasoningSummary,
    },
    ...(run.triage ? { triage: run.triage } : {}),
    citedArticles: proposal.citedKbIds.map((kbId, index) => ({
      id: kbId,
      title: articles[index]?.title ?? kbId,
    })),
  };
}

// Called by the worker when a run has ended with a proposal: marks the ticket as waiting for a
// person. It does not touch the ticket's version, so nobody who has the ticket open is made to
// reload because the agent finished.
export async function recordProposal(ticketId: string, runId: unknown): Promise<void> {
  await tickets.setProposalPending(
    ticketId,
    runId,
    // Not a person and not an edit: the record says who wrote the proposal.
    {
      action: 'agent_proposed',
      actorName: AGENT_IDENTITY.name,
      actorRole: 'agent',
      actorEmail: AGENT_IDENTITY.email,
      detail: 'Drafted a reply for a person to approve',
      internal: true,
    }
  );
}

// The status a decision moves the ticket to, if it should move at all: waiting on the requester,
// unless the ticket is already there, or finished, or in a state that cannot go there.
const statusAfterReply = (current: string): string | undefined =>
  statusTransitions[current as keyof typeof statusTransitions]?.includes(agentStatus as never)
    ? agentStatus
    : undefined;

export async function approveProposal(
  user: TokenPayload,
  id: string,
  { replyMarkdown }: ApproveProposalInput
): Promise<{ status: ProposalStatus }> {
  assertStaff(user);
  const { ticket, proposal } = await load(id);
  if (ticket.agent?.proposalStatus !== 'pending') {
    throw new ConflictError('NO_PENDING_PROPOSAL', 'There is no proposal waiting for a decision.');
  }

  const body = replyMarkdown ?? proposal.replyMarkdown;
  // Only a reply a person actually changed counts as edited.
  const decision: ProposalStatus =
    replyMarkdown !== undefined && replyMarkdown.trim() !== proposal.replyMarkdown.trim()
      ? 'edited'
      : 'approved';
  const nextStatus = statusAfterReply(ticket.status);

  const decided = await transaction(async (tx) => {
    const next = await tickets.decideProposal(
      id,
      {
        to: decision,
        fromStatus: ticket.status,
        ...(nextStatus ? { status: nextStatus } : {}),
        activity: [
          activityEntry(user, {
            action: 'proposal_approved',
            detail: decision === 'edited' ? 'Approved after editing' : 'Approved as written',
          }),
          ...(nextStatus
            ? [
                activityEntry(user, {
                  action: 'status_changed',
                  from: ticket.status,
                  to: nextStatus,
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
        ticketId: id,
        body,
        visibility: 'public',
        // Who wrote it, and who took responsibility for sending it.
        author: {
          id: AGENT_IDENTITY.id,
          name: AGENT_IDENTITY.name,
          email: AGENT_IDENTITY.email,
          role: 'agent',
        },
        source: 'agent',
        approvedBy: { id: user.sub, name: user.name, email: user.email },
      },
      tx
    );
    await tickets.appendActivity(
      id,
      activityEntry(user, { action: 'comment_added', detail: 'Reply from the service desk agent' }),
      tx
    );
    await outbox.record(
      [commentEvent(ticket, user, 'public'), ...patchEvents(ticket, next, user)],
      tx
    );
    return next;
  });

  // Someone else decided, or the ticket moved, between reading it and writing.
  if (!decided) {
    throw new ConflictError(
      'NO_PENDING_PROPOSAL',
      'This proposal was decided, or the ticket changed, while you were looking at it. Reload and try again.'
    );
  }
  return { status: decision };
}

export async function rejectProposal(
  user: TokenPayload,
  id: string,
  { reason }: RejectProposalInput
): Promise<{ status: ProposalStatus }> {
  assertStaff(user);
  const { ticket } = await load(id);
  if (ticket.agent?.proposalStatus !== 'pending') {
    throw new ConflictError('NO_PENDING_PROPOSAL', 'There is no proposal waiting for a decision.');
  }

  const decided = await transaction((tx) =>
    tickets.decideProposal(
      id,
      {
        to: 'rejected',
        fromStatus: ticket.status,
        activity: [
          activityEntry(user, {
            action: 'proposal_rejected',
            ...(reason ? { detail: reason } : {}),
          }),
        ],
      },
      tx
    )
  );
  if (!decided) {
    throw new ConflictError(
      'NO_PENDING_PROPOSAL',
      'This proposal was decided, or the ticket changed, while you were looking at it. Reload and try again.'
    );
  }
  return { status: 'rejected' };
}
