import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import * as api from './api.js';
import {
  demoUsers,
  emptyStats,
  makeTicket,
  sessionUser,
  ticketPage,
  users,
} from './test/fixtures.js';

vi.mock('./api.js', () => ({
  createTicket: vi.fn(),
  deleteTicket: vi.fn(),
  exportTickets: vi.fn(),
  fetchDemoUsers: vi.fn(),
  fetchMe: vi.fn(),
  fetchStats: vi.fn(),
  fetchTickets: vi.fn(),
  hasAuthToken: vi.fn(),
  login: vi.fn(),
  onUnauthorized: vi.fn(),
  setAuthToken: vi.fn(),
  updateTicket: vi.fn(),
}));

let expireSession;

beforeEach(() => {
  vi.clearAllMocks();
  expireSession = undefined;
  api.onUnauthorized.mockImplementation((handler) => {
    expireSession = handler;
  });
  api.hasAuthToken.mockReturnValue(false);
  api.fetchDemoUsers.mockResolvedValue({ users: demoUsers });
  api.fetchTickets.mockResolvedValue(ticketPage([makeTicket()]));
  api.fetchStats.mockResolvedValue({ ...emptyStats, total: 1, byStatus: { open: 1 } });
  api.login.mockImplementation(async ({ email }) => {
    const user = Object.values(users).find((candidate) => candidate.email === email);
    if (!user) throw Object.assign(new Error('Invalid demo credentials.'), { requestId: 'req-9' });
    return { token: `token-${user.role}`, user };
  });
});

async function signInAs(role) {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByTestId(`demo-login-${role}`));
  await screen.findByText(`Signed in as ${users[role].name}.`);
  return user;
}

describe('signed out', () => {
  it('invites the visitor to sign in and offers one-click demo accounts', async () => {
    render(<App />);

    expect(screen.getByText('Sign in to open the service desk.')).toBeInTheDocument();
    expect(await screen.findByTestId('demo-login-admin')).toBeInTheDocument();
    expect(api.fetchMe).not.toHaveBeenCalled(); // No saved session to restore.
    expect(api.fetchTickets).not.toHaveBeenCalled();
  });

  it('signs in with typed credentials', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'tech@demo.local');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Signed in as Theo Technician.')).toBeInTheDocument();
    expect(api.setAuthToken).toHaveBeenCalledWith('token-technician');
  });

  it('shows why a sign-in failed, with the support reference', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid demo credentials.', { exact: true })).toBeVisible();
    expect(screen.getByText(/Reference: req-9/)).toBeVisible();
    expect(screen.getByText('Sign in to open the service desk.')).toBeInTheDocument();
  });

  it('restores a saved session without asking to sign in again', async () => {
    api.hasAuthToken.mockReturnValue(true);
    api.fetchMe.mockResolvedValue({ user: sessionUser(users.technician) });

    render(<App />);

    expect(await screen.findByText('Ticket Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Theo Technician')).toBeInTheDocument();
  });

  it('falls back to signed out when the saved session is no longer valid', async () => {
    api.hasAuthToken.mockReturnValue(true);
    api.fetchMe.mockRejectedValue(new Error('Authentication required.'));

    render(<App />);

    await waitFor(() => expect(api.setAuthToken).toHaveBeenCalledWith(''));
    expect(screen.getByText('Sign in to open the service desk.')).toBeInTheDocument();
  });
});

describe('signed in', () => {
  it('shows the queue, stats and workflow for an admin, with delete controls', async () => {
    await signInAs('admin');

    expect(await screen.findByText('Laptop cannot connect to Wi-Fi')).toBeInTheDocument();
    expect(screen.getByText('Total Tickets').nextSibling).toHaveTextContent('1');
    expect(screen.getByTestId('ticket-delete-button')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1 · 1 tickets')).toBeInTheDocument();
  });

  it('hides administrative controls from a requester', async () => {
    await signInAs('user');

    await screen.findByText('Laptop cannot connect to Wi-Fi');
    expect(screen.queryByTestId('ticket-delete-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('ticket-status-select')).toBeDisabled();
    expect(screen.getByLabelText('Requester Email')).toBeDisabled();
  });

  it('shows an empty state and a loading state', async () => {
    api.fetchTickets.mockResolvedValue(ticketPage([]));

    await signInAs('admin');

    expect(await screen.findByText('No tickets found.')).toBeInTheDocument();
  });

  it('sends a single search request after typing pauses', async () => {
    const user = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    api.fetchTickets.mockClear();

    await user.type(screen.getByLabelText('Search tickets'), 'vpn');

    await waitFor(() =>
      expect(api.fetchTickets).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'vpn' }),
        expect.any(Object)
      )
    );
    expect(api.fetchTickets).toHaveBeenCalledTimes(1);
  });

  it('shows an API failure with its request id and keeps the rest of the page usable', async () => {
    api.fetchTickets.mockRejectedValue(
      Object.assign(new Error('Tickets are temporarily unavailable.'), { requestId: 'req-503' })
    );

    await signInAs('admin');

    expect(
      await screen.findByText('Tickets are temporarily unavailable.', { exact: true })
    ).toBeVisible();
    expect(screen.getByText(/Reference: req-503/)).toBeVisible();
    expect(screen.getByText('Ticket Dashboard')).toBeInTheDocument();
  });

  it('updates a ticket and confirms it', async () => {
    api.updateTicket.mockResolvedValue({ ticket: {} });
    const user = await signInAs('technician');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    await user.selectOptions(screen.getByTestId('ticket-status-select'), 'in-progress');

    expect(api.updateTicket).toHaveBeenCalledWith(
      '665f0f40d5d4f541f8ef1001',
      { status: 'in-progress' },
      { version: 2 }
    );
    expect(await screen.findByText('Ticket updated.')).toBeInTheDocument();
  });

  it('creates a ticket from the form and refreshes the queue', async () => {
    api.createTicket.mockResolvedValue({ ticket: makeTicket() });
    const user = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');
    const loadsBefore = api.fetchTickets.mock.calls.length;

    await user.type(screen.getByTestId('ticket-title'), 'Monitor flickers');
    await user.type(screen.getByTestId('ticket-description'), 'Flickers on wake.');
    await user.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(await screen.findByText('Ticket created successfully.')).toBeInTheDocument();
    expect(api.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Monitor flickers' })
    );
    await waitFor(() => expect(api.fetchTickets.mock.calls.length).toBeGreaterThan(loadsBefore));
    expect(screen.getByTestId('ticket-title')).toHaveValue('');
  });

  it('opens the activity timeline for a ticket', async () => {
    api.fetchTickets.mockResolvedValue(
      ticketPage([
        makeTicket({
          activity: [{ action: 'ticket_created', actorName: 'Priya Admin', detail: 'Seeded' }],
        }),
      ])
    );
    const user = await signInAs('admin');

    await user.click(await screen.findByTestId('ticket-activity-toggle'));

    const timeline = screen.getByTestId('ticket-activity-row');
    expect(within(timeline).getByText('Ticket created')).toBeInTheDocument();
    expect(within(timeline).getByText('Seeded')).toBeInTheDocument();
  });

  it('signs out and forgets the previous session', async () => {
    const user = await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByText('Sign in to open the service desk.')).toBeInTheDocument();
    expect(screen.queryByText('Laptop cannot connect to Wi-Fi')).not.toBeInTheDocument();
    expect(api.setAuthToken).toHaveBeenLastCalledWith('');
  });

  it('returns to sign-in with an explanation when the session expires', async () => {
    await signInAs('admin');
    await screen.findByText('Laptop cannot connect to Wi-Fi');

    // The API layer reports a 401 for a token it was holding.
    await waitFor(() => expect(expireSession).toBeTypeOf('function'));
    expireSession();

    expect(await screen.findByText('Your session expired. Sign in again.')).toBeVisible();
    expect(screen.getByText('Sign in to open the service desk.')).toBeInTheDocument();
  });
});
