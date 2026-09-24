import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  createTicket,
  deleteTicket,
  fetchStats,
  fetchTicket,
  fetchTickets,
  updateTicket,
} from '../api';
import type { Stats, Ticket, TicketChanges, TicketFilters, TicketForm, TicketPage } from '../types';

// One place that knows the cache keys, so a change can invalidate exactly what it affects.
export const ticketKeys = {
  all: ['tickets'] as const,
  list: (filters: TicketFilters) => ['tickets', 'list', filters] as const,
  detail: (id: string) => ['tickets', 'detail', id] as const,
  stats: ['tickets', 'stats'] as const,
};

// While the next page of results loads, the previous one stays on screen instead of
// flashing empty. `isPlaceholderData` says when that is what is showing.
export function useTicketList(filters: TicketFilters) {
  return useQuery({
    queryKey: ticketKeys.list(filters),
    queryFn: ({ signal }) => fetchTickets(filters, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useTicketStats() {
  return useQuery({
    queryKey: ticketKeys.stats,
    queryFn: ({ signal }) => fetchStats({ signal }),
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: ({ signal }) => fetchTicket(id, { signal }).then((data) => data.ticket),
  });
}

function invalidateTickets(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ticketKeys.all });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (form: TicketForm) => createTicket(form),
    onSuccess: () => invalidateTickets(queryClient),
  });
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTicket(id),
    onSuccess: () => invalidateTickets(queryClient),
  });
}

interface EditVariables {
  ticket: Ticket;
  changes: TicketChanges;
}

interface CachedQuery {
  key: QueryKey;
  data: unknown;
}

// Applies an edit to every cached copy of the ticket: in each page of the list and in
// its detail view.
function patchCachedTicket(queryClient: QueryClient, id: string, changes: TicketChanges): void {
  const patch = (ticket: Ticket): Ticket =>
    ticket._id === id ? { ...ticket, ...changes } : ticket;

  queryClient.setQueriesData<TicketPage>({ queryKey: ['tickets', 'list'] }, (page) =>
    page ? { ...page, data: page.data.map(patch), tickets: page.tickets.map(patch) } : page
  );
  queryClient.setQueryData<Ticket>(ticketKeys.detail(id), (ticket) =>
    ticket ? patch(ticket) : ticket
  );
}

// Edits show at once and are undone if the server refuses them. The edit is sent with the
// ticket's version (If-Match), so a stale change fails with a 409 instead of overwriting
// someone else's work; in that case the screen goes back to what it showed before and then
// reloads what the server has now.
export function useUpdateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ticket, changes }: EditVariables) =>
      updateTicket(ticket._id, changes, { version: ticket.__v }),

    onMutate: async ({ ticket, changes }) => {
      // An in-flight refetch would land after the optimistic change and undo it.
      await queryClient.cancelQueries({ queryKey: ticketKeys.all });
      const snapshot: CachedQuery[] = queryClient
        .getQueriesData({ queryKey: ticketKeys.all })
        .map(([key, data]) => ({ key, data }));

      patchCachedTicket(queryClient, ticket._id, changes);
      return { snapshot };
    },

    onError: (_error, _variables, context) => {
      for (const { key, data } of context?.snapshot ?? []) queryClient.setQueryData(key, data);
    },

    // Success or failure, the server is the source of truth: fetch it again.
    onSettled: () => invalidateTickets(queryClient),
  });
}

export type { Stats };
