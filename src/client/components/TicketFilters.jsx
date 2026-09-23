import { priorities, sortOptions, statuses } from '../constants.js';
import { label } from '../lib/format.js';

export default function TicketFilters({ filters, onChange }) {
  return (
    <div className="filters">
      <input
        value={filters.search}
        onChange={(event) => onChange('search', event.target.value)}
        placeholder="Search tickets or TKT ID..."
        aria-label="Search tickets"
        data-testid="ticket-search"
      />
      <select
        value={filters.status}
        onChange={(event) => onChange('status', event.target.value)}
        aria-label="Filter by status"
        data-testid="ticket-status-filter"
      >
        <option value="">All statuses</option>
        {statuses.map((status) => (
          <option value={status} key={status}>
            {label(status)}
          </option>
        ))}
      </select>
      <select
        value={filters.priority}
        onChange={(event) => onChange('priority', event.target.value)}
        aria-label="Filter by priority"
      >
        <option value="">All priorities</option>
        {priorities.map((priority) => (
          <option value={priority} key={priority}>
            {label(priority)}
          </option>
        ))}
      </select>
      <select
        value={filters.sla}
        onChange={(event) => onChange('sla', event.target.value)}
        aria-label="Filter by SLA state"
      >
        <option value="">All SLA states</option>
        <option value="breached">Breached SLA</option>
        <option value="due-soon">Due in 24h</option>
      </select>
      <select
        value={filters.sortBy}
        onChange={(event) => onChange('sortBy', event.target.value)}
        aria-label="Sort tickets by"
      >
        {sortOptions.map(([value, name]) => (
          <option value={value} key={value}>
            {name}
          </option>
        ))}
      </select>
      <select
        value={filters.sortOrder}
        onChange={(event) => onChange('sortOrder', event.target.value)}
        aria-label="Sort direction"
      >
        <option value="desc">Descending</option>
        <option value="asc">Ascending</option>
      </select>
    </div>
  );
}
