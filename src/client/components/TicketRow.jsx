import { Fragment } from 'react';
import { priorities, statuses } from '../constants.js';
import { formatDate, getSlaState, label } from '../lib/format.js';
import ActivityTimeline from './ActivityTimeline.jsx';

// What each role may touch is decided by the API; the controls mirror it:
// requesters can edit priority only, technicians can work the ticket, and only
// admins can delete.
export default function TicketRow({ ticket, role, expanded, onToggleActivity, onPatch, onDelete }) {
  const slaState = getSlaState(ticket);
  const isRequester = role === 'user';
  const name = ticket.ticketNumber || ticket.title;

  return (
    <Fragment>
      <tr data-testid="ticket-row">
        <td className="ticket-cell">
          <span className="ticket-number">{ticket.ticketNumber || 'Pending ID'}</span>
          <strong>{ticket.title}</strong>
          <p>{ticket.description || 'No description provided.'}</p>
          <small>
            {ticket.category || 'General Support'} | {ticket.requesterName || 'Unknown requester'}{' '}
            {ticket.requesterEmail ? `(${ticket.requesterEmail})` : ''}
          </small>
        </td>
        <td>
          <select
            className={`pill ${ticket.status}`}
            value={ticket.status}
            onChange={(event) => onPatch(ticket._id, { status: event.target.value })}
            disabled={isRequester}
            aria-label={`Status for ${name}`}
            data-testid="ticket-status-select"
          >
            {statuses.map((status) => (
              <option value={status} key={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </td>
        <td>
          <select
            className={`pill ${ticket.priority}`}
            value={ticket.priority}
            onChange={(event) => onPatch(ticket._id, { priority: event.target.value })}
            aria-label={`Priority for ${name}`}
          >
            {priorities.map((priority) => (
              <option value={priority} key={priority}>
                {label(priority)}
              </option>
            ))}
          </select>
        </td>
        <td>
          {/* Uncontrolled so typing is not interrupted; the key remounts the input
              if the server stores a different value than the one typed. */}
          <input
            key={`${ticket._id}-${ticket.assignee}`}
            className="assignee-input"
            defaultValue={ticket.assignee}
            aria-label={`Assignee for ${name}`}
            onBlur={(event) => {
              if (event.target.value !== ticket.assignee) {
                onPatch(ticket._id, { assignee: event.target.value });
              }
            }}
            disabled={isRequester}
          />
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
          <td colSpan="7">
            <ActivityTimeline ticket={ticket} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
