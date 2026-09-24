import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';
import { deferred, emptyStats, makeTicket, ticketPage, users } from '../test/fixtures.js';
import { useTickets } from './useTickets.js';

vi.mock('../api.js', () => ({
  createTicket: vi.fn(),
  deleteTicket: vi.fn(),
  exportTickets: vi.fn(),
  fetchStats: vi.fn(),
  fetchTickets: vi.fn(),
  updateTicket: vi.fn(),
}));

const onError = vi.fn();
const onSuccess = vi.fn();

const setup = (user = users.admin) =>
  renderHook(({ current }) => useTickets({ user: current, onError, onSuccess }), {
    initialProps: { current: user },
  });

const searchTerms = () => api.fetchTickets.mock.calls.map(([filters]) => filters.search);

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchTickets.mockResolvedValue(ticketPage([makeTicket()]));
  api.fetchStats.mockResolvedValue({ ...emptyStats, total: 1 });
});

describe('loading', () => {
  it('loads the ticket page and the stats once a user is signed in', async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.tickets).toHaveLength(1));

    expect(result.current.stats.total).toBe(1);
    expect(result.current.pagination.total).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('does not call the API while signed out', () => {
    setup(null);

    expect(api.fetchTickets).not.toHaveBeenCalled();
    expect(api.fetchStats).not.toHaveBeenCalled();
  });

  it('reports a failed load and empties the table', async () => {
    const failure = new Error('Tickets are temporarily unavailable.');
    api.fetchTickets.mockRejectedValue(failure);

    const { result } = setup();

    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(result.current.tickets).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('reports a failed stats load without touching the tickets', async () => {
    const failure = new Error('Stats down');
    api.fetchStats.mockRejectedValue(failure);

    const { result } = setup();

    await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    await waitFor(() => expect(result.current.tickets).toHaveLength(1));
    expect(result.current.stats).toBeNull();
  });

  it('clears data and filters when the user signs out', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.tickets).toHaveLength(1));
    act(() => result.current.updateFilter('status', 'open'));

    rerender({ current: null });

    await waitFor(() => expect(result.current.tickets).toEqual([]));
    expect(result.current.filters.status).toBe('');
    expect(result.current.stats).toBeNull();
  });
});

describe('search and filters', () => {
  it('sends one request for a burst of typing, not one per keystroke', async () => {
    const { result } = setup();
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(1));

    act(() => result.current.updateFilter('search', 'v'));
    act(() => result.current.updateFilter('search', 'vp'));
    act(() => result.current.updateFilter('search', 'vpn'));

    expect(result.current.filters.search).toBe('vpn'); // The box updates instantly...
    await waitFor(() => expect(searchTerms()).toContain('vpn'));
    // ...but the intermediate values never reached the server.
    expect(searchTerms()).toEqual(['', 'vpn']);
  });

  it('filters immediately and returns to page 1', async () => {
    api.fetchTickets.mockResolvedValue(ticketPage([makeTicket()], { totalPages: 5 }));
    const { result } = setup();
    await waitFor(() => expect(result.current.pagination.totalPages).toBe(5));

    act(() => result.current.updatePage(3));
    act(() => result.current.updateFilter('priority', 'urgent'));

    await waitFor(() =>
      expect(api.fetchTickets).toHaveBeenLastCalledWith(
        expect.objectContaining({ priority: 'urgent', page: 1 }),
        expect.any(Object)
      )
    );
  });

  it('keeps the requested page inside the available range', async () => {
    api.fetchTickets.mockResolvedValue(ticketPage([makeTicket()], { totalPages: 3 }));
    const { result } = setup();
    await waitFor(() => expect(result.current.pagination.totalPages).toBe(3));

    act(() => result.current.updatePage(99));
    await waitFor(() => expect(result.current.filters.page).toBe(3));

    act(() => result.current.updatePage(-4));
    await waitFor(() => expect(result.current.filters.page).toBe(1));
  });

  it('ignores a slow response that a newer request has replaced', async () => {
    const slow = deferred();
    api.fetchTickets
      .mockReturnValueOnce(Promise.resolve(ticketPage([makeTicket({ title: 'Initial' })])))
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(ticketPage([makeTicket({ title: 'Latest' })]));

    const { result } = setup();
    await waitFor(() => expect(result.current.tickets[0]?.title).toBe('Initial'));

    act(() => result.current.updateFilter('status', 'open')); // Request 2: still pending.
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(2));
    act(() => result.current.updateFilter('status', 'closed')); // Request 3 supersedes it.
    await waitFor(() => expect(result.current.tickets[0]?.title).toBe('Latest'));

    // The abandoned request finally answers, late and out of order.
    await act(async () => slow.resolve(ticketPage([makeTicket({ title: 'Stale' })])));

    expect(result.current.tickets[0].title).toBe('Latest');
    expect(api.fetchTickets.mock.calls[1][1].signal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalledWith(expect.anything()); // Only clears (null), never reports.
  });

  it('does not report a cancelled request as an error', async () => {
    const abort = deferred();
    api.fetchTickets
      .mockReturnValueOnce(abort.promise)
      .mockResolvedValueOnce(ticketPage([makeTicket()]));

    const { result } = setup();
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(1));
    act(() => result.current.updateFilter('status', 'open'));
    await act(async () => abort.reject(new DOMException('Aborted', 'AbortError')));

    await waitFor(() => expect(result.current.tickets).toHaveLength(1));
    expect(onError).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
  });
});

describe('actions', () => {
  it('creates a ticket, returns to page 1, reloads, and reports success', async () => {
    api.createTicket.mockResolvedValue({ ticket: {} });
    const { result } = setup();
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(1));

    let created;
    await act(async () => {
      created = await result.current.create({ title: 'New' });
    });

    expect(created).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith('Ticket created successfully.');
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(2));
    expect(result.current.saving).toBe(false);
  });

  it('reports a rejected ticket and tells the form not to reset', async () => {
    const failure = new Error('Title is required.');
    api.createTicket.mockRejectedValue(failure);
    const { result } = setup();

    let created;
    await act(async () => {
      created = await result.current.create({ title: '' });
    });

    expect(created).toBe(false);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onSuccess).not.toHaveBeenCalledWith('Ticket created successfully.');
  });

  it('patches a ticket against the version it loaded, then refreshes the list', async () => {
    api.updateTicket.mockResolvedValue({ ticket: {} });
    const ticket = makeTicket({ __v: 7 });
    api.fetchTickets.mockResolvedValue(ticketPage([ticket]));
    const { result } = setup();
    await waitFor(() => expect(result.current.tickets).toHaveLength(1));

    await act(async () => result.current.patch(ticket._id, { status: 'resolved' }));

    expect(api.updateTicket).toHaveBeenCalledWith(
      ticket._id,
      { status: 'resolved' },
      { version: 7 }
    );
    expect(onSuccess).toHaveBeenCalledWith('Ticket updated.');
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(2));
  });

  it('reloads the list after a 409 so the user sees the ticket as it is now', async () => {
    const conflict = Object.assign(new Error('This ticket changed since you loaded it.'), {
      status: 409,
      code: 'VERSION_CONFLICT',
    });
    api.updateTicket.mockRejectedValue(conflict);
    const { result } = setup();
    await waitFor(() => expect(result.current.tickets).toHaveLength(1));
    expect(api.fetchTickets).toHaveBeenCalledTimes(1);

    await act(async () => result.current.patch(makeTicket()._id, { priority: 'urgent' }));

    expect(onError).toHaveBeenCalledWith(conflict);
    expect(onSuccess).not.toHaveBeenCalledWith('Ticket updated.');
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(2));
    // The reload must not wipe the message that explains why it happened.
    expect(onError.mock.calls.at(-1)).toEqual([conflict]);
  });

  it('also reloads when the status move is no longer allowed from the current state', async () => {
    const stale = Object.assign(new Error('Cannot move a ticket from open to resolved.'), {
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    api.updateTicket.mockRejectedValue(stale);
    const { result } = setup();
    await waitFor(() => expect(result.current.tickets).toHaveLength(1));

    await act(async () => result.current.patch(makeTicket()._id, { status: 'resolved' }));

    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(2));
  });

  it('does not reload after other failures, even another 409', async () => {
    api.updateTicket.mockRejectedValue(
      Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' })
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.tickets).toHaveLength(1));

    await act(async () => result.current.patch(makeTicket()._id, { priority: 'urgent' }));

    expect(api.fetchTickets).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected patch', async () => {
    const failure = new Error('Users cannot update workflow fields.');
    api.updateTicket.mockRejectedValue(failure);
    const { result } = setup();

    await act(async () => result.current.patch('abc', { status: 'closed' }));

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('deletes only after the user confirms', async () => {
    api.deleteTicket.mockResolvedValue(null);
    const confirm = vi.spyOn(window, 'confirm');
    const { result } = setup();
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(1));

    confirm.mockReturnValueOnce(false);
    await act(async () => result.current.remove('abc'));
    expect(api.deleteTicket).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await act(async () => result.current.remove('abc'));
    expect(api.deleteTicket).toHaveBeenCalledWith('abc');
    expect(onSuccess).toHaveBeenCalledWith('Ticket deleted.');
  });

  it('reports a failed delete', async () => {
    const failure = new Error('Ticket not found.');
    api.deleteTicket.mockRejectedValue(failure);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = setup();

    await act(async () => result.current.remove('abc'));

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('downloads the export for the filters in effect', async () => {
    api.exportTickets.mockResolvedValue(new Blob(['Ticket ID']));
    URL.createObjectURL = vi.fn(() => 'blob:export');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = setup();
    await waitFor(() => expect(api.fetchTickets).toHaveBeenCalledTimes(1));

    await act(async () => result.current.exportCsv());

    expect(api.exportTickets).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'createdAt' })
    );
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
    expect(onSuccess).toHaveBeenCalledWith('Ticket export downloaded.');
    expect(result.current.exporting).toBe(false);
  });

  it('reports a failed export', async () => {
    const failure = new Error('Export failed.');
    api.exportTickets.mockRejectedValue(failure);
    const { result } = setup();

    await act(async () => result.current.exportCsv());

    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.exporting).toBe(false);
  });
});
