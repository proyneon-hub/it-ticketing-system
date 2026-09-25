import type { Comment } from '../../shared/ticket-types';
import type { CreateCommentInput } from '../../shared/schemas';
import type { TokenPayload } from '../auth';
import { assertCanPost, commentAddedEntry, readableVisibilities } from '../domain/comments';
import { activityEntry } from '../domain/activity';
import { commentEvent, patchEvents } from '../domain/outbox';
import { assertAgentScope, requesterScope } from '../domain/permissions';
import { NotFoundError, ValidationError } from '../errors';
import * as comments from '../repositories/commentRepository';
import * as tickets from '../repositories/ticketRepository';
import { transaction } from '../repositories/transaction';
import * as outbox from './outboxService';

// The longest thread returned in one response. A ticket rarely gets near it.
const MAX_COMMENTS = 500;

// A ticket the caller may see, or the same "not found" a missing one gets, so a
// requester cannot tell someone else's ticket from one that does not exist.
async function visibleTicket(user: TokenPayload, id: string) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw new ValidationError('Invalid ticket id.');
  assertAgentScope(user, id);
  const ticket = await tickets.findOne(id, requesterScope(user));
  if (!ticket) throw new NotFoundError('Ticket not found.');
  return ticket;
}

const toComment = (record: comments.CommentRecord): Comment => ({
  _id: String(record._id),
  ticketId: String(record.ticketId),
  body: record.body,
  visibility: record.visibility,
  author: record.author,
  ...(record.source ? { source: record.source } : {}),
  ...(record.approvedBy ? { approvedBy: record.approvedBy } : {}),
  createdAt: record.createdAt.toISOString(),
});

export async function listComments(user: TokenPayload, ticketId: string): Promise<Comment[]> {
  await visibleTicket(user, ticketId);
  const records = await comments.listForTicket(
    ticketId,
    readableVisibilities(user.role),
    MAX_COMMENTS
  );
  return records.map(toComment);
}

export async function addComment(
  user: TokenPayload,
  ticketId: string,
  { body, visibility }: CreateCommentInput
): Promise<Comment> {
  const ticket = await visibleTicket(user, ticketId);
  assertCanPost(user, visibility);

  // The comment, its history entry and its event commit together, or none of them do.
  const record = await transaction(async (tx) => {
    const created = await comments.create(
      {
        ticketId,
        body,
        visibility,
        author: { id: user.sub, name: user.name, email: user.email, role: user.role },
      },
      tx
    );
    await tickets.appendActivity(ticketId, commentAddedEntry(user, visibility), tx);
    await outbox.record([commentEvent(ticket, user, visibility)], tx);

    // A ticket waiting on its requester goes back into work when the requester answers.
    // Internal notes are staff-only, so this only ever follows a public reply.
    if (user.role === 'user' && visibility === 'public' && ticket.status === 'pending-user') {
      const resumed = await tickets.resumeFromPending(
        ticketId,
        activityEntry(user, {
          action: 'status_changed',
          from: 'pending-user',
          to: 'in-progress',
          detail: 'Requester replied',
        }),
        tx
      );
      if (resumed) await outbox.record(patchEvents(ticket, resumed, user), tx);
    }
    return created;
  });
  return toComment(record);
}
