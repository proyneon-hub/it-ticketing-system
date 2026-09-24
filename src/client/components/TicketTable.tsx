import { useState } from 'react';
import type { Role, Ticket, TicketChanges } from '../types';
import TicketRow from './TicketRow';

interface TicketTableProps {
  tickets: Ticket[];
  // True until the first page of results has arrived.
  loading: boolean;
  role: Role;
  onPatch: (ticket: Ticket, changes: TicketChanges) => void;
  onDelete: (id: string) => void;
}

export default function TicketTable({
  tickets,
  loading,
  role,
  onPatch,
  onDelete,
}: TicketTableProps) {
  const [expandedTicketId, setExpandedTicketId] = useState('');

  const toggleActivity = (id: string) =>
    setExpandedTicketId((current) => (current === id ? '' : id));

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>SLA</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="empty-state">
                Loading tickets...
              </td>
            </tr>
          ) : tickets.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-state">
                No tickets found.
              </td>
            </tr>
          ) : (
            tickets.map((ticket) => (
              <TicketRow
                key={ticket._id}
                ticket={ticket}
                role={role}
                expanded={expandedTicketId === ticket._id}
                onToggleActivity={toggleActivity}
                onPatch={onPatch}
                onDelete={onDelete}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
