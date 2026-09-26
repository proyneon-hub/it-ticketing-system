import { useState, type FormEvent } from 'react';
import type { ApiError } from '../api';
import { formatDate } from '../lib/format';
import { useAddComment, useComments } from '../queries/comments';
import type { CommentVisibility, Role } from '../types';
import Alert from './Alert';

const MAX_LENGTH = 2000;

const roleLabel = (role: string): string =>
  role === 'user' ? 'Requester' : role === 'agent' ? 'Agent' : 'Staff';

// A ticket's conversation. Everyone signed in who can see the ticket reads and writes public
// comments; staff can also leave internal notes. The server decides what each role receives,
// so a requester's list simply never contains a note; the label below only explains it to staff.
export default function CommentThread({ ticketId, role }: { ticketId: string; role: Role }) {
  const comments = useComments(ticketId);
  const add = useAddComment(ticketId);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<CommentVisibility>('public');
  const staff = role !== 'user';
  const trimmed = body.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    add.mutate(
      { body: trimmed, visibility: staff ? visibility : 'public' },
      {
        onSuccess: () => {
          setBody('');
          setVisibility('public');
        },
      }
    );
  }

  return (
    <div className="comment-thread">
      <h3>Comments</h3>

      {comments.isPending ? <p role="status">Loading comments...</p> : null}
      {comments.isError ? (
        <Alert
          type="error"
          message={(comments.error as ApiError).message}
          requestId={(comments.error as ApiError).requestId}
        />
      ) : null}
      {comments.data && comments.data.length === 0 ? <p>No comments yet.</p> : null}

      {comments.data?.length ? (
        <ol className="comment-list">
          {comments.data.map((comment) => (
            <li
              key={comment._id}
              className={comment.visibility === 'internal' ? 'comment internal' : 'comment'}
              data-testid="comment"
            >
              <div className="comment-meta">
                <strong>{comment.author.name}</strong>
                <span>{roleLabel(comment.author.role)}</span>
                {comment.source === 'agent' ? (
                  <span className="ai-badge">
                    AI-generated
                    {comment.approvedBy ? ` · approved by ${comment.approvedBy.name}` : ''}
                  </span>
                ) : null}
                {comment.visibility === 'internal' ? (
                  <span className="comment-badge">
                    Internal note · not visible to the requester
                  </span>
                ) : null}
                <small>{formatDate(comment.createdAt)}</small>
              </div>
              <p>{comment.body}</p>
            </li>
          ))}
        </ol>
      ) : null}

      <form className="comment-form" onSubmit={submit}>
        <label htmlFor="comment-body">{staff ? 'Add a reply or note' : 'Add a comment'}</label>
        <textarea
          id="comment-body"
          data-testid="comment-body"
          rows={3}
          maxLength={MAX_LENGTH}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />

        {staff ? (
          <fieldset className="comment-visibility">
            <legend>Who can see this</legend>
            <label>
              <input
                type="radio"
                name="comment-visibility"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
              />
              Reply to the requester
            </label>
            <label>
              <input
                type="radio"
                name="comment-visibility"
                checked={visibility === 'internal'}
                onChange={() => setVisibility('internal')}
              />
              Internal note (staff only)
            </label>
          </fieldset>
        ) : null}

        {add.isError && !(add.error as ApiError).sessionEnded ? (
          <Alert
            type="error"
            message={(add.error as ApiError).message}
            requestId={(add.error as ApiError).requestId}
          />
        ) : null}

        <button className="primary-button" type="submit" disabled={!trimmed || add.isPending}>
          {add.isPending
            ? 'Posting...'
            : visibility === 'internal' && staff
              ? 'Add note'
              : 'Post comment'}
        </button>
      </form>
    </div>
  );
}
