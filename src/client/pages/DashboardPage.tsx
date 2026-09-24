import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import { StatsGrid, WorkflowStrip } from '../components/StatsGrid';
import TicketDashboard from '../components/TicketDashboard';
import TicketForm from '../components/TicketForm';
import { SEARCH_DEBOUNCE_MS, defaultFilters, terminalStatuses } from '../constants';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useTicketFilters } from '../hooks/useTicketFilters';
import { getSlaState } from '../lib/format';
import { useTicketList, useTicketStats } from '../queries/tickets';
import { useTicketActions } from '../queries/useTicketActions';
import type { Pagination, TicketFilters } from '../types';

const emptyPagination: Pagination = {
  page: 1,
  limit: defaultFilters.limit,
  total: 0,
  totalPages: 1,
};

// The queue: stats, the create form, and the filtered, paged list. Filters live in the
// URL, so a view can be bookmarked or shared.
export default function DashboardPage() {
  const { user } = useAuth();
  const { filters, setFilter, setPage } = useTicketFilters();
  const list = useTicketList(filters);
  const stats = useTicketStats();
  const actions = useTicketActions();

  // The search box updates instantly; the request (and the URL) wait until typing pauses.
  const [searchText, setSearchText] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedSearch !== filters.search) setFilter('search', debouncedSearch);
  }, [debouncedSearch, filters.search, setFilter]);

  const tickets = useMemo(() => list.data?.data ?? [], [list.data]);
  const activeCount = useMemo(
    () =>
      tickets.filter((ticket) => !(terminalStatuses as readonly string[]).includes(ticket.status))
        .length,
    [tickets]
  );
  const breachedVisibleCount = useMemo(
    () => tickets.filter((ticket) => getSlaState(ticket) === 'breached').length,
    [tickets]
  );

  if (!user) return null; // RequireAuth guarantees a user; this narrows the type.

  function changeFilter(field: keyof TicketFilters, value: string) {
    if (field === 'search') setSearchText(value);
    else setFilter(field, value as never);
  }

  async function handleCreate(form: Parameters<typeof actions.createTicket>[0]) {
    const created = await actions.createTicket(form);
    if (created) setPage(1);
    return created;
  }

  async function handleDelete(id: string) {
    await actions.deleteTicket(id);
  }

  const failure = list.error ?? stats.error;

  return (
    <>
      {failure && !(failure as { sessionEnded?: boolean }).sessionEnded ? (
        <Alert
          type="error"
          message={failure.message}
          requestId={(failure as { requestId?: string }).requestId}
        />
      ) : null}

      <StatsGrid
        stats={stats.data}
        activeCount={activeCount}
        breachedVisibleCount={breachedVisibleCount}
      />
      <WorkflowStrip stats={stats.data} />

      <section className="layout-grid">
        <TicketForm role={user.role} saving={actions.saving} onCreate={handleCreate} />
        <TicketDashboard
          role={user.role}
          tickets={tickets}
          filters={{ ...filters, search: searchText }}
          pagination={list.data?.pagination ?? emptyPagination}
          loading={list.isPending}
          fetching={list.isFetching}
          exporting={actions.exporting}
          onFilterChange={changeFilter}
          onPage={setPage}
          onPatch={actions.patchTicket}
          onDelete={handleDelete}
          onExport={() => void actions.exportCsv(filters)}
          onRefresh={() => {
            void list.refetch();
            void stats.refetch();
          }}
        />
      </section>
    </>
  );
}
