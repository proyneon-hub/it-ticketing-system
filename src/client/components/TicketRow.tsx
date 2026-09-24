import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, getSlaState, label } from '../lib/format';
import type { Role, Ticket, TicketChanges } from '../types';
import ActivityTimeline from './ActivityTimeline';
import { AssigneeInput, PrioritySelect, StatusSelect } from './TicketControls';

interface TicketRowProps {
  ticket: Ticket;
  role: Role;
  expanded: boolean;
  onToggleActivity: (id: string) => void;
  onPatch: (ticket: Ticket, changes: TicketChanges) => void;
  onDelete: (id: string) => void;
}

// What each role may touch is decided by the API; the controls mirror it:
// requesters can edit priority only, technicians can work the ticket within the
// workflow, and only admins can delete or reopen a closed ticket.
export default function TicketRow({
  ticket,
  role,
  expanded,
  onToggleActivity,
  onPatch,
  onDelete,
}: TicketRowProps) {
  const slaState = getSlaState(ticket);

  return (
    <Fragment>
      <tr data-testid="ticket-row">
        <td className="ticket-cell">
          <Link className="ticket-number" to={`/tickets/${ticket._id}`}>
            {ticket.ticketNumber || 'Pending ID'}
          </Link>
          <strong>{ticket.title}</strong>
          <p>{ticket.description || 'No description provided.'}</p>
          <small>
            {ticket.category || 'General Support'} | {ticket.requesterName || 'Unknown requester'}{' '}
            {ticket.requesterEmail ? `(${ticket.requesterEmail})` : ''}
          </small>
        </td>
        <td>
          <StatusSelect ticket={ticket} role={role} onPatch={onPatch} />
        </td>
        <td>
          <PrioritySelect ticket={ticket} role={role} onPatch={onPatch} />
        </td>
        <td>
          <AssigneeInput ticket={ticket} role={role} onPatch={onPatch} />
        </td>
        <td>
          <span className={`sla-chip ${slaState}`}>{label(slaState)}</span>
          <small className="stacked-date">{formatDate(ticket.dueAt)}</small>
        </td>
        <td>{formatDate(ticket.createdAt)}</td>
        <td className="row-actions">
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => onToggleActivity(ticket._id)}
            aria-expanded={expanded}
            data-testid="ticket-activity-toggle"
          >
            Activity
          </button>
          {role === 'admin' ? (
            <button
              className="danger-button compact-button"
              type="button"
              onClick={() => onDelete(ticket._id)}
              data-testid="ticket-delete-button"
            >
              Delete
            </button>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr className="activity-row" data-testid="ticket-activity-row">
          <td colSpan={7}>
            <ActivityTimeline ticket={ticket} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
