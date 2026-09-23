import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createTicket,
  deleteTicket,
  exportTickets,
  fetchStats,
  fetchTickets,
  updateTicket,
} from '../api.js';
import { SEARCH_DEBOUNCE_MS, defaultFilters } from '../constants.js';
import { useDebouncedValue } from './useDebouncedValue.js';

const emptyPagination = { page: 1, limit: defaultFilters.limit, total: 0, totalPages: 1 };

// Everything the dashboard needs: the filtered ticket page, dashboard stats, and
// the actions that change them. Requests are cancelled when the filters change
// again before they finish, so a slow response can never overwrite a newer one.
export function useTickets({ user, onError, onSuccess }) {
  const userId = user?.sub ?? null;
  const [filters, setFilters] = useState(defaultFilters);
  // The last request that finished, and the key it answered. `loading` is
  // derived from that key rather than stored, so it is true from the very first
  // render of a new request and there is no state to keep in sync.
  const [settled, setSettled] = useState({ key: null, tickets: [], pagination: emptyPagination });
  const [stats, setStats] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // A different person signing in (or out) starts from a clean slate. Adjusting
  // state during render like this is React's pattern for resetting on a changed input.
  const [previousUserId, setPreviousUserId] = useState(userId);
  if (previousUserId !== userId) {
    setPreviousUserId(userId);
    setFilters(defaultFilters);
    setSettled({ key: null, tickets: [], pagination: emptyPagination });
    setStats(null);
  }

  // The search box updates instantly; the request waits until typing pauses.
  const debouncedSearch = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  // Keyed by value, not identity: typing changes `filters` on every keystroke,
  // but the request only changes when the debounced search (or another filter) does.
  const filtersKey = JSON.stringify({ ...filters, search: debouncedSearch });
  const activeFilters = useMemo(() => JSON.parse(filtersKey), [filtersKey]);
  const requestKey = `${userId}#${filtersKey}#${reloadKey}`;

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!userId) return undefined;

    const controller = new AbortController();
    onError(null);

    fetchTickets(activeFilters, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return; // A newer request replaced this one.
        setSettled({
          key: requestKey,
          tickets: data.data || data.tickets || [],
          pagination: data.pagination || { ...emptyPagination, limit: activeFilters.limit },
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return; // Superseded by a newer request.
        setSettled({ key: requestKey, tickets: [], pagination: emptyPagination });
        onError(error);
      });

    return () => controller.abort();
  }, [userId, activeFilters, requestKey, onError]);

  // Stats do not depend on the filters, so they reload only after a change.
  useEffect(() => {
    if (!userId) return undefined;

    const controller = new AbortController();

    fetchStats({ signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setStats(data);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStats(null);
        onError(error);
      });

    return () => controller.abort();
  }, [userId, reloadKey, onError]);

  const loading = Boolean(userId) && settled.key !== requestKey;
  const { tickets, pagination } = settled;

  const updateFilter = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value, page: 1 }));
  }, []);

  const updatePage = useCallback(
    (nextPage) => {
      const page = Math.min(Math.max(nextPage, 1), pagination.totalPages || 1);
      setFilters((current) => ({ ...current, page }));
    },
    [pagination.totalPages]
  );

  // Resolves to true when the ticket was created, so the form knows to reset.
  const create = useCallback(
    async (form) => {
      setSaving(true);
      onError(null);
      onSuccess('');

      try {
        await createTicket(form);
        onSuccess('Ticket created successfully.');
        setFilters((current) => ({ ...current, page: 1 }));
        refresh();
        return true;
      } catch (error) {
        onError(error);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [onError, onSuccess, refresh]
  );

  const patch = useCallback(
    async (id, changes) => {
      onError(null);
      onSuccess('');

      try {
        await updateTicket(id, changes);
        onSuccess('Ticket updated.');
        refresh();
      } catch (error) {
        onError(error);
      }
    },
    [onError, onSuccess, refresh]
  );

  const remove = useCallback(
    async (id) => {
      if (!window.confirm('Delete this ticket? This cannot be undone.')) return;

      onError(null);
      onSuccess('');

      try {
        await deleteTicket(id);
        onSuccess('Ticket deleted.');
        refresh();
      } catch (error) {
        onError(error);
      }
    },
    [onError, onSuccess, refresh]
  );

  const exportCsv = useCallback(async () => {
    setExporting(true);
    onError(null);
    onSuccess('');

    try {
      const blob = await exportTickets(activeFilters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tickets.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onSuccess('Ticket export downloaded.');
    } catch (error) {
      onError(error);
    } finally {
      setExporting(false);
    }
  }, [activeFilters, onError, onSuccess]);

  return {
    filters,
    tickets,
    stats,
    pagination,
    loading,
    saving,
    exporting,
    updateFilter,
    updatePage,
    refresh,
    create,
    patch,
    remove,
    exportCsv,
  };
}
