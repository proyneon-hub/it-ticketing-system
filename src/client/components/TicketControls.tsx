import { priorities } from '../constants';
import { label } from '../lib/format';
import { allowedNextStatuses } from '../lib/workflow';
import type { Priority, Role, Status, Ticket, TicketChanges } from '../types';

// The controls that change a ticket, shared by the queue and the detail page. What each
// role may touch is decided by the API; the controls mirror it: requesters can edit
// priority only, and the status menu offers only the moves the workflow allows.

interface ControlProps {
  ticket: Ticket;
  role: Role;
  onPatch: (ticket: Ticket, changes: TicketChanges) => void;
}

const nameOf = (ticket: Ticket) => ticket.ticketNumber || ticket.title;

export function StatusSelect({ ticket, role, onPatch }: ControlProps) {
  return (
    <select
      className={`pill ${ticket.status}`}
      value={ticket.status}
      onChange={(event) => onPatch(ticket, { status: event.target.value as Status })}
      disabled={role === 'user'}
      aria-label={`Status for ${nameOf(ticket)}`}
      data-testid="ticket-status-select"
    >
      {allowedNextStatuses(ticket.status, role).map((status) => (
        <option value={status} key={status}>
          {label(status)}
        </option>
      ))}
    </select>
  );
}

export function PrioritySelect({ ticket, onPatch }: ControlProps) {
  return (
    <select
      className={`pill ${ticket.priority}`}
      value={ticket.priority}
      onChange={(event) => onPatch(ticket, { priority: event.target.value as Priority })}
      aria-label={`Priority for ${nameOf(ticket)}`}
    >
      {priorities.map((priority) => (
        <option value={priority} key={priority}>
          {label(priority)}
        </option>
      ))}
    </select>
  );
}

export function AssigneeInput({ ticket, role, onPatch }: ControlProps) {
  return (
    // Uncontrolled so typing is not interrupted; the key remounts the input if the
    // server stores a different value than the one typed.
    <input
      key={`${ticket._id}-${ticket.assignee}`}
      className="assignee-input"
      defaultValue={ticket.assignee}
      aria-label={`Assignee for ${nameOf(ticket)}`}
      onBlur={(event) => {
        if (event.target.value !== ticket.assignee) {
          onPatch(ticket, { assignee: event.target.value });
        }
      }}
      disabled={role === 'user'}
    />
  );
}
