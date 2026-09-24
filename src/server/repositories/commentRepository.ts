import type { CommentVisibility } from '../../shared/ticket-constants';
import { Types } from 'mongoose';
import Comment, { type CommentAttrs, type CommentRecord } from '../models/Comment';

export type { CommentRecord };

// A ticket's thread, oldest first, limited to the visibilities the caller may read.
// The visibility filter is part of the query, so a hidden note never leaves the database.
export const listForTicket = (
  ticketId: string,
  visibilities: CommentVisibility[],
  limit: number
): Promise<CommentRecord[]> =>
  Comment.find({ ticketId, visibility: { $in: visibilities } })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean<CommentRecord[]>();

export async function create(
  data: Omit<CommentAttrs, 'createdAt' | 'ticketId'> & { ticketId: string }
): Promise<CommentRecord> {
  const comment = await Comment.create({ ...data, ticketId: new Types.ObjectId(data.ticketId) });
  return comment.toObject() as CommentRecord;
}

export async function deleteForTicket(ticketId: string): Promise<void> {
  await Comment.deleteMany({ ticketId });
}
