import { useState } from 'react';
import TicketRow from './TicketRow.jsx';

export default function TicketTable({ tickets, loading, role, onPatch, onDelete }) {
  const [expandedTicketId, setExpandedTicketId] = useState('');

  const toggleActivity = (id) => setExpandedTicketId((current) => (current === id ? '' : id));

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
              <td colSpan="7" className="empty-state">
                Loading tickets...
              </td>
            </tr>
          ) : tickets.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-state">
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
