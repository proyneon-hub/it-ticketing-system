import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { defaultFilters } from '../constants';
import { deferred, makeTicket, ticketPage } from '../test/fixtures';
import type { Ticket, TicketPage } from '../types';
import { ticketKeys, useUpdateTicket } from './tickets';

vi.mock('../api', async () => (await import('../test/apiMock')).apiMockFactory());

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const listKey = ticketKeys.list(defaultFilters);
const listedStatus = () => client.getQueryData<TicketPage>(listKey)?.data[0]?.status;
const detailStatus = (id: string) => client.getQueryData<Ticket>(ticketKeys.detail(id))?.status;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('editing a ticket', () => {
  function seed() {
    const ticket = makeTicket({ status: 'open', __v: 5 });
    client.setQueryData(listKey, ticketPage([ticket]));
    client.setQueryData(ticketKeys.detail(ticket._id), ticket);
    return ticket;
  }

  it('shows the change at once, in the list and the detail view, before the server answers', async () => {
    const ticket = seed();
    const pending = deferred();
    vi.mocked(api.updateTicket).mockReturnValue(pending.promise as never);
    const { result } = renderHook(() => useUpdateTicket(), { wrapper });

    act(() => result.current.mutate({ ticket, changes: { status: 'in-progress' } }));

    await waitFor(() => expect(listedStatus()).toBe('in-progress'));
    expect(detailStatus(ticket._id)).toBe('in-progress');
    expect(api.updateTicket).toHaveBeenCalledWith(
      ticket._id,
      { status: 'in-progress' },
      { version: 5 } // The version the person was looking at, so a stale edit is refused.
    );
    pending.resolve({ ticket });
  });

  it('puts everything back when the server refuses with a version conflict', async () => {
    const ticket = seed();
    const pending = deferred();
    vi.mocked(api.updateTicket).mockReturnValue(pending.promise as never);
    const { result } = renderHook(() => useUpdateTicket(), { wrapper });

    act(() => result.current.mutate({ ticket, changes: { status: 'in-progress', assignee: 'X' } }));
    await waitFor(() => expect(listedStatus()).toBe('in-progress'));

    pending.reject(
      Object.assign(new Error('This ticket changed since you loaded it.'), {
        status: 409,
        code: 'VERSION_CONFLICT',
      })
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(listedStatus()).toBe('open');
    expect(detailStatus(ticket._id)).toBe('open');
    expect(client.getQueryData<TicketPage>(listKey)?.data[0]?.assignee).toBe('Network Support');
    expect(result.current.error).toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('changes only the ticket that was edited', async () => {
    const edited = makeTicket({ _id: 'a'.repeat(24), status: 'open' });
    const other = makeTicket({ _id: 'b'.repeat(24), status: 'open' });
    client.setQueryData(listKey, ticketPage([edited, other]));
    vi.mocked(api.updateTicket).mockReturnValue(deferred().promise as never);
    const { result } = renderHook(() => useUpdateTicket(), { wrapper });

    act(() => result.current.mutate({ ticket: edited, changes: { status: 'closed' } }));

    await waitFor(() =>
      expect(client.getQueryData<TicketPage>(listKey)?.data[0]?.status).toBe('closed')
    );
    expect(client.getQueryData<TicketPage>(listKey)?.data[1]?.status).toBe('open');
  });

  it('marks what it changed as stale either way, so the server has the last word', async () => {
    const ticket = seed();
    vi.mocked(api.updateTicket).mockResolvedValue({ ticket });
    const { result } = renderHook(() => useUpdateTicket(), { wrapper });

    await act(() => result.current.mutateAsync({ ticket, changes: { priority: 'urgent' } }));

    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(ticketKeys.detail(ticket._id))?.isInvalidated).toBe(true);
  });
});
