import Pagination from './Pagination.jsx';
import TicketFilters from './TicketFilters.jsx';
import TicketTable from './TicketTable.jsx';

export default function TicketDashboard({
  role,
  tickets,
  filters,
  pagination,
  loading,
  exporting,
  onFilterChange,
  onPage,
  onPatch,
  onDelete,
  onExport,
}) {
  return (
    <section className="panel dashboard-card">
      <div className="section-heading horizontal">
        <div>
          <h2>Ticket Dashboard</h2>
          <p>Filter tickets, update assignments, and watch SLA risk.</p>
        </div>
        <button
          className="secondary-button compact-button"
          type="button"
          onClick={onExport}
          disabled={exporting || loading}
          data-testid="ticket-export-button"
        >
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      <TicketFilters filters={filters} onChange={onFilterChange} />
      <TicketTable
        tickets={tickets}
        loading={loading}
        role={role}
        onPatch={onPatch}
        onDelete={onDelete}
      />
      <Pagination pagination={pagination} loading={loading} onPage={onPage} />
    </section>
  );
}
