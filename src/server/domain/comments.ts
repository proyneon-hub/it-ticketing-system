import type { TokenPayload } from '../auth';
import type { ActorRole, CommentVisibility } from '../../shared/ticket-constants';
import type { ActivityEntry } from '../../shared/ticket-types';
import { ForbiddenError } from '../errors';
import { activityEntry } from './activity';

// Internal notes are staff-only. The rule lives here, on the server: the client
// hides nothing on its own, so a requester's session simply never receives one.

// The visibilities a role may read.
export const readableVisibilities = (role: ActorRole): CommentVisibility[] =>
  role === 'user' ? ['public'] : ['public', 'internal'];

// Throws unless `user` may post a comment with this visibility.
export function assertCanPost(user: TokenPayload, visibility: CommentVisibility): void {
  if (visibility === 'internal' && user.role === 'user') {
    throw new ForbiddenError('Only staff can add internal notes.');
  }
}

// The history entry for a new comment. It never repeats the text, so an internal
// note's content is only ever in the comment itself.
export const commentAddedEntry = (
  user: TokenPayload,
  visibility: CommentVisibility
): ActivityEntry =>
  activityEntry(user, {
    action: 'comment_added',
    detail: visibility === 'internal' ? 'Internal note added' : 'Comment added',
    internal: visibility === 'internal',
  });

// The history a role may see: everything for staff, without internal entries for a requester.
export function visibleActivity<T extends { internal?: boolean | undefined }>(
  activity: T[] | undefined,
  role: ActorRole
): T[] {
  const entries = activity ?? [];
  return role === 'user' ? entries.filter((entry) => !entry.internal) : entries;
}
