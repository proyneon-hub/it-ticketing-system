import type { Comment } from '../../shared/ticket-types';
import type { CreateCommentInput } from '../../shared/schemas';
import type { TokenPayload } from '../auth';
import { assertCanPost, commentAddedEntry, readableVisibilities } from '../domain/comments';
import { requesterScope } from '../domain/permissions';
import { NotFoundError, ValidationError } from '../errors';
import * as comments from '../repositories/commentRepository';
import * as tickets from '../repositories/ticketRepository';

// The longest thread returned in one response. A ticket rarely gets near it.
const MAX_COMMENTS = 500;

// A ticket the caller may see, or the same "not found" a missing one gets, so a
// requester cannot tell someone else's ticket from one that does not exist.
async function visibleTicket(user: TokenPayload, id: string): Promise<void> {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw new ValidationError('Invalid ticket id.');
  if (!(await tickets.findOne(id, requesterScope(user)))) {
    throw new NotFoundError('Ticket not found.');
  }
}

const toComment = (record: comments.CommentRecord): Comment => ({
  _id: String(record._id),
  ticketId: String(record.ticketId),
  body: record.body,
  visibility: record.visibility,
  author: record.author,
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
  await visibleTicket(user, ticketId);
  assertCanPost(user, visibility);

  const record = await comments.create({
    ticketId,
    body,
    visibility,
    author: { id: user.sub, name: user.name, email: user.email, role: user.role },
  });
  await tickets.appendActivity(ticketId, commentAddedEntry(user, visibility));
  return toComment(record);
}
