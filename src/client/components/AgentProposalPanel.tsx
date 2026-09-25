import { useState } from 'react';
import type { ApiError } from '../api';
import { label } from '../lib/format';
import { useNotices } from '../notices/NoticeContext';
import { useDecideProposal, useProposal } from '../queries/agent';
import type { ProposalView, Ticket } from '../types';
import Alert from './Alert';

const MIN_LENGTH = 20;
const MAX_LENGTH = 2000;

const DECIDED_TEXT = {
  approved: 'Approved and posted to the requester as written.',
  edited: 'Approved after editing, and posted to the requester.',
  rejected: 'Rejected. Nothing was posted to the requester.',
  posted: 'Posted by the agent on its own. Nobody reviewed it before the requester saw it.',
} as const;

// The agent's drafted reply for a person to approve, edit or reject. Shown to staff only, and only
// for a ticket the agent has proposed something for. The reply is the agent's until a person posts it:
// the requester sees nothing of it, and a comment appears only after Approve (docs/adr/011).
export default function AgentProposalPanel({ ticket }: { ticket: Ticket }) {
  const status = ticket.agent?.proposalStatus;
  const present = Boolean(status && status !== 'none');
  const query = useProposal(ticket._id, present);

  if (!present) return null;

  if (query.isPending) {
    return (
      <section className="agent-panel" aria-label="Drafted reply from the agent" role="status">
        <p>Loading the agent&apos;s drafted reply...</p>
      </section>
    );
  }

  if (query.isError) {
    const error = query.error as ApiError;
    // Nothing to show if the run behind it has gone; anything else is worth saying.
    if (error.status === 404) return null;
    return (
      <section className="agent-panel" aria-label="Drafted reply from the agent">
        <Alert type="error" message={error.message} requestId={error.requestId} />
      </section>
    );
  }

  // Keyed by the run, so a proposal that changes underneath starts a fresh draft.
  return <ProposalCard key={query.data.runId} ticketId={ticket._id} view={query.data} />;
}

function ProposalCard({ ticketId, view }: { ticketId: string; view: ProposalView }) {
  const decide = useDecideProposal(ticketId);
  const { showError, showSuccess, clear } = useNotices();
  const [draft, setDraft] = useState(view.proposal.replyMarkdown);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const pending = view.status === 'pending';
  const trimmed = draft.trim();
  const edited = trimmed !== view.proposal.replyMarkdown.trim();
  const tooShort = trimmed.length < MIN_LENGTH;

  function approve() {
    clear();
    decide.mutate(
      { kind: 'approve', ...(edited ? { replyMarkdown: trimmed } : {}) },
      {
        onSuccess: () =>
          showSuccess('Reply posted to the requester. The ticket now waits for their answer.'),
        onError: showError,
      }
    );
  }

  function reject() {
    clear();
    decide.mutate(
      { kind: 'reject', ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          setRejecting(false);
          showSuccess('Drafted reply rejected. Nothing was sent to the requester.');
        },
        onError: showError,
      }
    );
  }

  return (
    <section className="agent-panel" aria-labelledby="agent-panel-heading">
      <div className="agent-panel-heading">
        <h3 id="agent-panel-heading">Drafted reply from the service desk agent</h3>
        <span className="ai-badge">AI-generated</span>
      </div>

      <dl className="agent-facts">
        <div>
          <dt>Confidence</dt>
          <dd>
            <span className={`confidence ${view.proposal.confidence}`}>
              {label(view.proposal.confidence)}
            </span>
          </dd>
        </div>
        {view.triage ? (
          <div>
            <dt>Triage it chose</dt>
            <dd>
              {view.triage.category} · {label(view.triage.priority)} priority ·{' '}
              {view.triage.assigneeGroup}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Why</dt>
          <dd>{view.proposal.reasoningSummary}</dd>
        </div>
        <div>
          <dt>Based on</dt>
          <dd>
            <ul className="agent-sources">
              {view.citedArticles.map((article) => (
                <li key={article.id}>
                  <strong>{article.id}</strong> {article.title}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      {pending ? (
        <>
          <label htmlFor="proposal-reply">Reply to the requester (you can edit it)</label>
          <textarea
            id="proposal-reply"
            data-testid="proposal-reply"
            rows={7}
            maxLength={MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby="proposal-reply-hint"
          />
          <p id="proposal-reply-hint" className="hint">
            {tooShort
              ? `Write at least ${MIN_LENGTH} characters.`
              : 'The requester sees this exactly as written, marked as AI-generated and approved by you.'}
          </p>

          {rejecting ? (
            <div className="agent-reject">
              <label htmlFor="proposal-reason">Why? (optional, kept in the ticket history)</label>
              <input
                id="proposal-reason"
                type="text"
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="agent-actions">
                <button
                  className="danger-button"
                  type="button"
                  onClick={reject}
                  disabled={decide.isPending}
                >
                  Confirm rejection
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setRejecting(false)}
                  disabled={decide.isPending}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="agent-actions">
              <button
                className="primary-button"
                type="button"
                onClick={approve}
                disabled={decide.isPending || tooShort}
              >
                {decide.isPending
                  ? 'Posting...'
                  : edited
                    ? 'Approve edited reply'
                    : 'Approve and post'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRejecting(true)}
                disabled={decide.isPending}
              >
                Reject
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p role="status" className="agent-decided">
            {DECIDED_TEXT[view.status as keyof typeof DECIDED_TEXT] ?? label(view.status)}
          </p>
          <blockquote className="agent-reply">{view.proposal.replyMarkdown}</blockquote>
        </>
      )}
    </section>
  );
}
