import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ActivityTimeline from '../components/ActivityTimeline';
import AgentProposalPanel from '../components/AgentProposalPanel';
import Alert from '../components/Alert';
import CommentThread from '../components/CommentThread';
import { AssigneeInput, PrioritySelect, StatusSelect } from '../components/TicketControls';
import { formatDate, getSlaState, label } from '../lib/format';
import { useTicket } from '../queries/tickets';
import { useTicketActions } from '../queries/useTicketActions';
import type { ApiError } from '../api';

// One ticket in full: its details, the same controls as the queue, and its history.
export default function TicketDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useTicket(id);
  const actions = useTicketActions();

  if (!user) return null; // RequireAuth guarantees a user; this narrows the type.

  if (query.isPending) {
    return (
      <section className="panel" role="status">
        <p>Loading ticket...</p>
      </section>
    );
  }

  if (query.isError) {
    const error = query.error as ApiError;
    const notFound = error.status === 404 || error.status === 400;
    return (
      <section className="panel">
        <h2>{notFound ? 'Ticket not found.' : 'This ticket could not be loaded.'}</h2>
        {notFound ? <p>It may have been deleted, or you may not have access to it.</p> : null}
        {!notFound && !error.sessionEnded ? (
          <Alert type="error" message={error.message} requestId={error.requestId} />
        ) : null}
        <Link to="/tickets">Back to the queue</Link>
      </section>
    );
  }

  const ticket = query.data;
  const sla = getSlaState(ticket);

  async function handleDelete() {
    if (await actions.deleteTicket(ticket._id)) {
      navigate('/tickets', { state: { success: 'Ticket deleted.' } });
    }
  }

  return (
    <section className="panel ticket-detail">
      <p>
        <Link to="/tickets">← Back to the queue</Link>
      </p>

      <div className="section-heading">
        <span className="ticket-number">{ticket.ticketNumber}</span>
        <h2>{ticket.title}</h2>
        <p>{ticket.description || 'No description provided.'}</p>
      </div>

      <dl className="detail-grid">
        <div>
          <dt>Requester</dt>
          <dd>
            {ticket.requesterName || 'Unknown requester'}
            {ticket.requesterEmail ? ` (${ticket.requesterEmail})` : ''}
          </dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>
            {ticket.category || 'General Support'}
            {ticket.agent?.triageSource === 'agent' ? (
              <span className="ai-badge subtle">Triaged by the agent</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>SLA</dt>
          <dd>
            <span className={`sla-chip ${sla}`}>{label(sla)}</span> due {formatDate(ticket.dueAt)}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(ticket.createdAt)}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{formatDate(ticket.updatedAt)}</dd>
        </div>
        {ticket.resolvedAt ? (
          <div>
            <dt>Resolved</dt>
            <dd>{formatDate(ticket.resolvedAt)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="detail-controls">
        <label>
          Status
          <StatusSelect ticket={ticket} role={user.role} onPatch={actions.patchTicket} />
        </label>
        <label>
          Priority
          <PrioritySelect ticket={ticket} role={user.role} onPatch={actions.patchTicket} />
        </label>
        <label>
          Assignee
          <AssigneeInput ticket={ticket} role={user.role} onPatch={actions.patchTicket} />
        </label>
        {user.role === 'admin' ? (
          <button className="danger-button" type="button" onClick={() => void handleDelete()}>
            Delete ticket
          </button>
        ) : null}
      </div>

      {user.role !== 'user' ? <AgentProposalPanel ticket={ticket} /> : null}

      <CommentThread ticketId={ticket._id} role={user.role} />

      <ActivityTimeline ticket={ticket} />
    </section>
  );
}
