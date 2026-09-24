import type {
  Pagination as PaginationInfo,
  Role,
  Ticket,
  TicketChanges,
  TicketFilters,
} from '../types';
import Pagination from './Pagination';
import TicketFiltersBar from './TicketFilters';
import TicketTable from './TicketTable';

interface TicketDashboardProps {
  role: Role;
  tickets: Ticket[];
  filters: TicketFilters;
  pagination: PaginationInfo;
  // True until the first results arrive.
  loading: boolean;
  // True while any request for the list is in flight, including a refresh.
  fetching: boolean;
  exporting: boolean;
  onFilterChange: (field: keyof TicketFilters, value: string) => void;
  onPage: (page: number) => void;
  onPatch: (ticket: Ticket, changes: TicketChanges) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onRefresh: () => void;
}

export default function TicketDashboard({
  role,
  tickets,
  filters,
  pagination,
  loading,
  fetching,
  exporting,
  onFilterChange,
  onPage,
  onPatch,
  onDelete,
  onExport,
  onRefresh,
}: TicketDashboardProps) {
  return (
    <section className="panel dashboard-card">
      <div className="section-heading horizontal">
        <div>
          <h2>Ticket Dashboard</h2>
          <p>Filter tickets, update assignments, and watch SLA risk.</p>
        </div>
        <div className="session-actions">
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={onRefresh}
            disabled={fetching}
            data-testid="refresh-button"
          >
            {fetching ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={onExport}
            disabled={exporting || fetching}
            data-testid="ticket-export-button"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      <TicketFiltersBar filters={filters} onChange={onFilterChange} />
      <TicketTable
        tickets={tickets}
        loading={loading}
        role={role}
        onPatch={onPatch}
        onDelete={onDelete}
      />
      <Pagination pagination={pagination} loading={fetching} onPage={onPage} />
    </section>
  );
}
