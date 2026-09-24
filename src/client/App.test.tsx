import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { deferred, makeTicket, ticketPage, users } from './test/fixtures';
import { installDefaultApi, renderApp, renderSignedInAs } from './test/renderApp';

vi.mock('./api', async () => (await import('./test/apiMock')).apiMockFactory());

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultApi();
});

async function signInAs(role: keyof typeof users, route = '/') {
  const user = userEvent.setup();
  const view = renderApp(route);
  await user.click(await screen.findByTestId(`demo-login-${role}`));
  await screen.findByText(`Signed in as ${users[role].name}.`);
  return { user, ...view };
}

// What the API layer does when a session cannot be renewed.
function endSession() {
  const handler = vi.mocked(api.onUnauthorized).mock.calls.at(-1)?.[0];
  act(() => handler?.());
}

describe('signed out', () => {
  it('sends the visitor to the sign-in page, which offers one-click demo accounts', async () => {
    const { router } = renderApp('/');

    expect(await screen.findByText('Sign in to open the service desk.')).toBeInTheDocument();
    expect(await screen.findByTestId('demo-login-admin')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(api.refreshSession).not.toHaveBeenCalled(); // No saved session to restore.
    expect(api.fetchTickets).not.toHaveBeenCalled();
  });

  it.each(['/tickets', '/tickets/665f0f40d5d4f541f8ef1001', '/admin/users', '/admin/audit'])(
    'will not show %s, and asks for a sign-in instead',
    async (route) => {
      const { router } = renderApp(route);

      expect(await screen.findByText('Sign in to open the service desk.')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
      expect(api.fetchTickets).not.toHaveBeenCalled();
      expect(api.fetchUsers).not.toHaveBeenCalled();
    }
  );

  it('takes the visitor where they were going once they sign in', async () => {
    const { router } = await signInAs('admin', '/tickets?status=open&priority=high');

    expect(router.state.location.pathname).toBe('/tickets');
    expect(router.state.location.search).toBe('?status=open&priority=high');
    expect(api.fetchTickets).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open', priority: 'high' }),
      expect.anything()
    );
  });

  it('shows the "Signed in" message on the page it lands on, including a page it was sent to', async () => {
    await signInAs('technician', '/tickets/665f0f40d5d4f541f8ef1001');

    expect(screen.getByText('Signed in as Theo Technician.')).toBeVisible();
  });

  it('signs in with typed credentials', async () => {
    const user = userEvent.setup();
    renderApp('/login');

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'tech@demo.local');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Signed in as Theo Technician.')).toBeInTheDocument();
    expect(api.setAuthToken).toHaveBeenCalledWith('token-technician');
  });

  it('shows why a sign-in failed, with the support reference', async () => {
    const user = userEvent.setup();
    renderApp('/login');

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid demo credentials.', { exact: true })).toBeVisible();
    expect(screen.getByText(/Reference: req-9/)).toBeVisible();
    expect(screen.getByText('Sign in to open the service desk.')).toBeInTheDocument();
  });

  it('shows an unknown address as not found, with a way back', async () => {
    renderApp('/no/such/page');

    expect(await screen.findByText('Page not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the ticket queue' })).toBeInTheDocument();
  });
});

describe('restoring a session', () => {
  it('restores it through the refresh cookie without asking to sign in again', async () => {
    renderSignedInAs('technician');

    expect(await screen.findByText('Ticket Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Theo Technician')).toBeInTheDocument();
  });

  it('says it is restoring, instead of flashing the sign-in prompt, while it checks', async () => {
    vi.mocked(api.sessionMayExist).mockReturnValue(true);
    const pending = deferred();
    vi.mocked(api.refreshSession).mockReturnValue(pending.promise as never);

    renderApp('/tickets');

    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session');
    expect(screen.queryByText('Sign in to open the service desk.')).not.toBeInTheDocument();

    pending.resolve({ token: 't', user: users.technician });
    expect(await screen.findByText('Ticket Dashboard')).toBeInTheDocument();
  });

  it('falls back to signed out, quietly, when the saved session has ended', async () => {
    vi.mocked(api.sessionMayExist).mockReturnValue(true);
    vi.mocked(api.refreshSession).mockRejectedValue(new Error('Session expired. Sign in again.'));

    renderApp('/tickets');

    expect(await screen.findByText('Sign in to open the service desk.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays on the page it was on after a reload', async () => {
    renderSignedInAs('admin', '/admin/audit');
    vi.mocked(api.fetchAudit).mockResolvedValue({
      events: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 1 },
    });

    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
  });
});

describe('the queue', () => {
  it('shows the queue, stats and workflow for an admin, with delete controls', async () => {
    await signInAs('admin');

    expect(await screen.findByText('Laptop cannot connect to Wi-Fi')).toBeInTheDocument();
    expect(await screen.findByText('Page 1 of 1 · 1 tickets')).toBeInTheDocument();
    expect(screen.getByText('Total Tickets').nextSibling).toHaveTextContent('1');
    expect(screen.getByTestId('ticket-delete-button')).toBeInTheDocument();
  });

  it('hides administrative controls from a requester', async () => {
    await signInAs('user');

    await screen.findByText('Laptop cannot connect to Wi-Fi');
    expect(screen.queryByTestId('ticket-delete-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('ticket-status-select')).toBeDisabled();
    expect(screen.getByLabelText('Requester Email')).toBeDisabled();
  });

  it('shows an empty state', async () => {
    vi.mocked(api.fetchTickets).mockResolvedValue(ticketPage([]));

    await signInAs('admin');

    expect(await screen.findByText('No tickets found.')).toBeInTheDocument();
  });

  it('shows a loading state until the first results arrive', async () => {
    const pending = deferred();
    vi.mocked(api.fetchTickets).mockReturnValue(pending.promise as never);

    await signInAs('admin');

    expect(await screen.findByText('Loading tickets...')).toBeInTheDocument();
    pending.resolve(ticketPage([makeTicket()]));
    expect(await screen.findByText('Laptop cannot connect to Wi-Fi')).toBeInTheDocument();
    expect(screen.queryByText('Loading tickets...')).not.toBeInTheDocument();
  });

  it('reads filters from the address, and ignores values it does not recognise', async () => {
    renderSignedInAs('admin', '/tickets?status=open&priority=high&page=2&sortBy=passwordHash');

    await screen.findByText('Laptop cannot connect to Wi-Fi');

    expect(api.fetchTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'open',
        priority: 'high',
        page: 2,
        sortBy: 'createdAt', // The invalid sort field fell back to the default.
      }),
      expect.anything()
    );
    expect(screen.getByLabelText('Filter by status')).toHaveValue('open');
  });

  it('puts a changed filter in the address, so the view can be shared', async () => {
    const { router } = renderSignedInAs('admin');
    const user = userEvent.setup();
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'assigned');

    expect(router.state.location.search).toBe('?status=assigned');
    await waitFor(() =>
      expect(api.fetchTickets).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'assigned', page: 1 }),
        expect.anything()
      )
    );
  });

  it('sends a single search request, and records it in the address, after typing pauses', async () => {
    const { router } = renderSignedInAs('admin');
    const user = userEvent.setup();
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    vi.mocked(api.fetchTickets).mockClear();

    await user.type(screen.getByLabelText('Search tickets'), 'vpn');

    await waitFor(() => expect(router.state.location.search).toBe('?search=vpn'));
    expect(api.fetchTickets).toHaveBeenCalledTimes(1);
    expect(api.fetchTickets).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'vpn' }),
      expect.anything()
    );
  });

  it('shows the results of the latest search when an earlier one answers last', async () => {
    renderSignedInAs('admin');
    const user = userEvent.setup();
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    const first = deferred();
    const second = deferred();
    vi.mocked(api.fetchTickets)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const search = screen.getByLabelText('Search tickets');

    await user.type(search, 'printer');
    await waitFor(() =>
      expect(api.fetchTickets).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'printer' }),
        expect.anything()
      )
    );
    await user.clear(search);
    await user.type(search, 'vpn');
    await waitFor(() =>
      expect(api.fetchTickets).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'vpn' }),
        expect.anything()
      )
    );

    second.resolve(ticketPage([makeTicket({ title: 'VPN drops every hour' })]));
    expect(await screen.findByText('VPN drops every hour')).toBeInTheDocument();
    first.resolve(ticketPage([makeTicket({ title: 'Printer jam on floor 2' })]));
    await act(async () => {
      await first.promise;
    });

    expect(screen.getByText('VPN drops every hour')).toBeInTheDocument();
    expect(screen.queryByText('Printer jam on floor 2')).not.toBeInTheDocument();
  });

  it('shows an API failure with its request id and keeps the rest of the page usable', async () => {
    vi.mocked(api.fetchTickets).mockRejectedValue(
      Object.assign(new Error('Tickets are temporarily unavailable.'), { requestId: 'req-503' })
    );

    await signInAs('admin');

    expect(
      await screen.findByText('Tickets are temporarily unavailable.', { exact: true })
    ).toBeVisible();
    expect(screen.getByText(/Reference: req-503/)).toBeVisible();
    expect(screen.getByText('Ticket Dashboard')).toBeInTheDocument();
  });

  it('creates a ticket from the form and refreshes the queue', async () => {
    vi.mocked(api.createTicket).mockResolvedValue({ ticket: makeTicket() });
    const { user } = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    const loadsBefore = vi.mocked(api.fetchTickets).mock.calls.length;

    await user.type(screen.getByTestId('ticket-title'), 'Monitor flickers');
    await user.type(screen.getByTestId('ticket-description'), 'Flickers on wake.');
    await user.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(await screen.findByText('Ticket created successfully.')).toBeInTheDocument();
    expect(api.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Monitor flickers' })
    );
    await waitFor(() =>
      expect(vi.mocked(api.fetchTickets).mock.calls.length).toBeGreaterThan(loadsBefore)
    );
    expect(screen.getByTestId('ticket-title')).toHaveValue('');
  });

  it('opens the activity timeline for a ticket', async () => {
    vi.mocked(api.fetchTickets).mockResolvedValue(
      ticketPage([
        makeTicket({
          activity: [{ action: 'ticket_created', actorName: 'Priya Admin', detail: 'Seeded' }],
        }),
      ])
    );
    const { user } = await signInAs('admin');

    await user.click(await screen.findByTestId('ticket-activity-toggle'));

    const timeline = screen.getByTestId('ticket-activity-row');
    expect(within(timeline).getByText('Ticket created')).toBeInTheDocument();
    expect(within(timeline).getByText('Seeded')).toBeInTheDocument();
  });

  it('refreshes on request', async () => {
    const { user } = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    const loadsBefore = vi.mocked(api.fetchTickets).mock.calls.length;

    await user.click(screen.getByTestId('refresh-button'));

    await waitFor(() =>
      expect(vi.mocked(api.fetchTickets).mock.calls.length).toBeGreaterThan(loadsBefore)
    );
  });

  it('downloads the export for the current filters', async () => {
    const createObjectURL = vi.fn(() => 'blob:export');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(api.exportTickets).mockResolvedValue(new Blob(['Ticket ID']));
    renderSignedInAs('admin', '/tickets?status=open');
    const user = userEvent.setup();
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    await user.click(screen.getByTestId('ticket-export-button'));

    expect(await screen.findByText('Ticket export downloaded.')).toBeInTheDocument();
    expect(api.exportTickets).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('deletes only after the user confirms', async () => {
    vi.mocked(api.deleteTicket).mockResolvedValue(null);
    const confirm = vi.spyOn(window, 'confirm');
    const { user } = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByTestId('ticket-delete-button'));
    expect(api.deleteTicket).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByTestId('ticket-delete-button'));
    expect(await screen.findByText('Ticket deleted.')).toBeInTheDocument();
    expect(api.deleteTicket).toHaveBeenCalledWith('665f0f40d5d4f541f8ef1001');
    confirm.mockRestore();
  });
});

describe('editing a ticket in the queue', () => {
  it('sends the edit with the ticket version, and confirms it', async () => {
    vi.mocked(api.updateTicket).mockResolvedValue({ ticket: makeTicket() });
    const { user } = await signInAs('technician');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    await user.selectOptions(screen.getByTestId('ticket-status-select'), 'in-progress');

    expect(api.updateTicket).toHaveBeenCalledWith(
      '665f0f40d5d4f541f8ef1001',
      { status: 'in-progress' },
      { version: 2 }
    );
    expect(await screen.findByText('Ticket updated.')).toBeInTheDocument();
  });

  // The optimistic update: the menu shows the new status straight away, and goes back if the
  // server refuses, with the reason and a reload of what the server now has.
  it('shows the new status at once, and rolls it back with an explanation on a conflict', async () => {
    const pending = deferred();
    vi.mocked(api.updateTicket).mockReturnValue(pending.promise as never);
    const { user } = await signInAs('technician');
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    const loadsBefore = vi.mocked(api.fetchTickets).mock.calls.length;

    await user.selectOptions(screen.getByTestId('ticket-status-select'), 'in-progress');
    await waitFor(() =>
      expect(screen.getByTestId('ticket-status-select')).toHaveValue('in-progress')
    );

    pending.reject(
      Object.assign(
        new Error('This ticket changed since you loaded it. Reload it and try again.'),
        {
          status: 409,
          code: 'VERSION_CONFLICT',
        }
      )
    );

    expect(
      await screen.findByText('This ticket changed since you loaded it. Reload it and try again.')
    ).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('ticket-status-select')).toHaveValue('open'));
    await waitFor(() =>
      expect(vi.mocked(api.fetchTickets).mock.calls.length).toBeGreaterThan(loadsBefore)
    );
    // The reload does not wipe the message that explains it.
    expect(screen.getByText(/This ticket changed since you loaded it/)).toBeVisible();
  });

  it('offers a technician only the moves the workflow allows', async () => {
    await signInAs('technician');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    const options = Array.from(
      screen.getByTestId('ticket-status-select').querySelectorAll('option')
    ).map((option) => option.value);

    expect(options).toEqual(['open', 'assigned', 'in-progress', 'closed']);
  });
});

describe('ending a session', () => {
  it('signs out, returns to the sign-in page and forgets the previous data', async () => {
    const { user, router } = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign in to open the service desk.')).toBeInTheDocument();
    expect(screen.queryByText('Laptop cannot connect to Wi-Fi')).not.toBeInTheDocument();
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/login');
  });

  it('returns to sign-in with an explanation when the session expires', async () => {
    await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    endSession();

    expect(await screen.findByText('Your session expired. Sign in again.')).toBeVisible();
    expect(screen.getByText('Sign in to open the service desk.')).toBeInTheDocument();
  });

  it('does not let the failed request replace that explanation', async () => {
    const { user } = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    // The next list request finds the session gone: the API layer ends it, then fails the request.
    vi.mocked(api.fetchTickets).mockImplementation(async () => {
      endSession();
      throw Object.assign(new Error('Authentication required.'), {
        status: 401,
        sessionEnded: true,
      });
    });

    await user.click(screen.getByTestId('refresh-button'));

    expect(await screen.findByText('Your session expired. Sign in again.')).toBeVisible();
    expect(screen.queryByText('Authentication required.')).not.toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('shows the admin pages to admins only', async () => {
    const { unmount } = renderSignedInAs('admin');
    await screen.findByText('Ticket Dashboard');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    unmount();

    renderSignedInAs('technician');
    await screen.findByText('Ticket Dashboard');
    const staffNav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(staffNav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(within(staffNav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it.each(['technician', 'user'] as const)('keeps a %s out of the admin pages', async (role) => {
    renderSignedInAs(role, '/admin/users');

    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
    expect(api.fetchUsers).not.toHaveBeenCalled();
  });

  it('opens a ticket from the queue', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket: makeTicket() });
    const { user, router } = await signInAs('admin');

    await user.click(await screen.findByRole('link', { name: 'TKT-0001' }));

    expect(router.state.location.pathname).toBe('/tickets/665f0f40d5d4f541f8ef1001');
    expect(await screen.findByRole('link', { name: '← Back to the queue' })).toBeInTheDocument();
    expect(api.fetchTicket).toHaveBeenCalledWith('665f0f40d5d4f541f8ef1001', expect.anything());
  });
});
