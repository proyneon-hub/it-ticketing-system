import mongoose, { type Model, type Types } from 'mongoose';
import {
  actorRoles,
  commentVisibilities,
  type ActorRole,
  type CommentVisibility,
} from '../../shared/ticket-constants';

export interface CommentAttrs {
  ticketId: Types.ObjectId;
  body: string;
  visibility: CommentVisibility;
  author: { id: string; name: string; email: string; role: ActorRole };
  createdAt: Date;
}

export type CommentRecord = CommentAttrs & { _id: Types.ObjectId };

// Comments are their own collection rather than an array on the ticket, so a busy
// thread cannot grow a ticket document without limit and the ticket list stays light.
const commentSchema = new mongoose.Schema<CommentAttrs>({
  ticketId: { type: mongoose.Schema.Types.ObjectId, required: true },
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  visibility: { type: String, enum: commentVisibilities, default: 'public', required: true },
  author: {
    id: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, maxlength: 254 },
    role: { type: String, enum: actorRoles, required: true },
  },
  createdAt: { type: Date, default: Date.now, required: true },
});

// A ticket's thread is always read oldest first.
commentSchema.index({ ticketId: 1, createdAt: 1 });

const Comment: Model<CommentAttrs> =
  (mongoose.models.Comment as Model<CommentAttrs> | undefined) ||
  mongoose.model<CommentAttrs>('Comment', commentSchema);

export default Comment;
