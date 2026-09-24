import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { priorities, slaFilters, sortFields, statuses } from '../../shared/ticket-constants';
import { defaultFilters } from '../constants';
import type { TicketFilters } from '../types';

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

function parseFilters(params: URLSearchParams): TicketFilters {
  const page = Number(params.get('page'));
  return {
    status: oneOf(params.get('status'), statuses) ?? '',
    priority: oneOf(params.get('priority'), priorities) ?? '',
    sla: oneOf(params.get('sla'), slaFilters) ?? '',
    search: params.get('search') ?? '',
    sortBy: oneOf(params.get('sortBy'), sortFields) ?? defaultFilters.sortBy,
    sortOrder: oneOf(params.get('sortOrder'), ['asc', 'desc'] as const) ?? defaultFilters.sortOrder,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    limit: defaultFilters.limit,
  };
}

// Only what differs from the defaults goes in the address, so /tickets stays clean and a
// filtered view is a link that can be shared or bookmarked.
function toSearchParams(filters: TicketFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of [
    'status',
    'priority',
    'sla',
    'search',
    'sortBy',
    'sortOrder',
    'page',
  ] as const) {
    if (filters[key] !== defaultFilters[key]) params.set(key, String(filters[key]));
  }
  return params;
}

// The ticket list's filters, sorting and page, kept in the URL. Anything unrecognised in
// the address falls back to its default rather than reaching the API.
export function useTicketFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);

  const setFilter = useCallback(
    <K extends keyof TicketFilters>(field: K, value: TicketFilters[K]) => {
      // A different filter starts again from the first page.
      setParams(toSearchParams({ ...filters, [field]: value, page: 1 }), { replace: true });
    },
    [filters, setParams]
  );

  const setPage = useCallback(
    (page: number) => setParams(toSearchParams({ ...filters, page }), { replace: true }),
    [filters, setParams]
  );

  return { filters, setFilter, setPage };
}
