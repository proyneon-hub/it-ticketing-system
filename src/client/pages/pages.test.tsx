import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { deferred, makeTicket, users } from '../test/fixtures';
import { installDefaultApi, renderSignedInAs } from '../test/renderApp';
import type { AuditEvent, UserSummary } from '../types';

vi.mock('../api', async () => (await import('../test/apiMock')).apiMockFactory());

const ID = '665f0f40d5d4f541f8ef1001';

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultApi();
});

describe('ticket detail', () => {
  const ticket = makeTicket({
    resolvedAt: '2026-06-02T09:00:00.000Z',
    activity: [{ action: 'ticket_created', actorName: 'Priya Admin', detail: 'Seeded' }],
  });

  it('shows the ticket in full, with its history and the same controls as the queue', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket });
    renderSignedInAs('technician', `/tickets/${ID}`);

    expect(await screen.findByRole('heading', { name: ticket.title })).toBeInTheDocument();
    expect(screen.getByText('TKT-0001')).toBeInTheDocument();
    expect(screen.getByText(/Avery Johnson/)).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Ticket Activity Timeline')).toBeInTheDocument();
    expect(screen.getByText('Seeded')).toBeInTheDocument();
    expect(screen.getByLabelText('Status for TKT-0001')).toBeEnabled();
  });

  it('sends an edit with the ticket version', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket });
    vi.mocked(api.updateTicket).mockResolvedValue({ ticket });
    renderSignedInAs('technician', `/tickets/${ID}`);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: ticket.title });

    await user.selectOptions(screen.getByLabelText('Priority for TKT-0001'), 'urgent');

    expect(api.updateTicket).toHaveBeenCalledWith(ID, { priority: 'urgent' }, { version: 2 });
    expect(await screen.findByText('Ticket updated.')).toBeInTheDocument();
  });

  it('limits a requester to priority, and offers delete to admins only', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket });
    const { unmount } = renderSignedInAs('user', `/tickets/${ID}`);
    await screen.findByRole('heading', { name: ticket.title });
    expect(screen.getByLabelText('Status for TKT-0001')).toBeDisabled();
    expect(screen.getByLabelText('Priority for TKT-0001')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete ticket' })).not.toBeInTheDocument();
    unmount();

    renderSignedInAs('admin', `/tickets/${ID}`);
    expect(await screen.findByRole('button', { name: 'Delete ticket' })).toBeInTheDocument();
  });

  it('returns to the queue, with a message, after an admin deletes the ticket', async () => {
    vi.mocked(api.fetchTicket).mockResolvedValue({ ticket });
    vi.mocked(api.deleteTicket).mockResolvedValue(null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { router } = renderSignedInAs('admin', `/tickets/${ID}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete ticket' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tickets'));
    expect(await screen.findByText('Ticket deleted.')).toBeInTheDocument();
  });

  it.each([404, 400])('says so when the ticket cannot be found (%i)', async (status) => {
    vi.mocked(api.fetchTicket).mockRejectedValue(
      Object.assign(new Error('Ticket not found.'), { status })
    );
    renderSignedInAs('technician', `/tickets/${ID}`);

    expect(await screen.findByText('Ticket not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the queue' })).toBeInTheDocument();
  });

  it('shows other failures with their reference', async () => {
    vi.mocked(api.fetchTicket).mockRejectedValue(
      Object.assign(new Error('Database unavailable.'), { status: 503, requestId: 'req-5' })
    );
    renderSignedInAs('technician', `/tickets/${ID}`);

    expect(await screen.findByText('This ticket could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Database unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-5/)).toBeInTheDocument();
  });

  it('shows a loading state', async () => {
    vi.mocked(api.fetchTicket).mockReturnValue(deferred().promise as never);
    renderSignedInAs('technician', `/tickets/${ID}`);

    expect(await screen.findByText('Loading ticket...')).toBeInTheDocument();
  });
});

describe('admin: users', () => {
  const summaries: UserSummary[] = Object.values(users).map((user) => ({
    ...user,
    createdAt: '2026-06-01T12:00:00.000Z',
  }));

  it('lists everyone with their role, marking the signed-in admin', async () => {
    vi.mocked(api.fetchUsers).mockResolvedValue({ users: summaries });
    renderSignedInAs('admin', '/admin/users');

    const rows = await screen.findAllByTestId('user-row');

    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('(you)')).toBeInTheDocument();
    expect(screen.getByLabelText('Role for tech@demo.local')).toHaveValue('technician');
  });

  it('changes a role and confirms it', async () => {
    vi.mocked(api.fetchUsers).mockResolvedValue({ users: summaries });
    vi.mocked(api.changeUserRole).mockResolvedValue({
      user: { ...users.technician, role: 'admin' },
    });
    renderSignedInAs('admin', '/admin/users');
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Role for tech@demo.local'), 'admin');

    expect(api.changeUserRole).toHaveBeenCalledWith('usr_tech', 'admin');
    expect(await screen.findByText('tech@demo.local is now Admin.')).toBeInTheDocument();
  });

  it('explains a refusal, such as demoting the last admin, with its reference', async () => {
    vi.mocked(api.fetchUsers).mockResolvedValue({ users: summaries });
    vi.mocked(api.changeUserRole).mockRejectedValue(
      Object.assign(new Error('There must always be at least one admin.'), {
        status: 409,
        code: 'LAST_ADMIN',
        requestId: 'req-77',
      })
    );
    renderSignedInAs('admin', '/admin/users');
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Role for admin@demo.local'), 'user');

    expect(await screen.findByText('There must always be at least one admin.')).toBeVisible();
    expect(screen.getByText(/Reference: req-77/)).toBeVisible();
  });

  it('does not send a change when the role is the same', async () => {
    vi.mocked(api.fetchUsers).mockResolvedValue({ users: summaries });
    renderSignedInAs('admin', '/admin/users');
    const user = userEvent.setup();

    await user.selectOptions(
      await screen.findByLabelText('Role for tech@demo.local'),
      'technician'
    );

    expect(api.changeUserRole).not.toHaveBeenCalled();
  });

  it('shows a loading state and a load failure', async () => {
    vi.mocked(api.fetchUsers).mockRejectedValue(
      Object.assign(new Error('Users are unavailable.'), { requestId: 'req-8' })
    );
    renderSignedInAs('admin', '/admin/users');

    expect(await screen.findByText('Users are unavailable.')).toBeVisible();
  });
});

describe('admin: audit log', () => {
  const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
    _id: 'e1',
    type: 'login_success',
    outcome: 'success',
    actor: { email: 'tech@demo.local', role: 'technician' },
    ip: '203.0.113.9',
    at: '2026-06-01T12:00:00.000Z',
    ...overrides,
  });
  const page = (events: AuditEvent[], overrides = {}) => ({
    events,
    pagination: { page: 1, limit: 25, total: events.length, totalPages: 1, ...overrides },
  });

  it('lists security events with who, what and from where', async () => {
    vi.mocked(api.fetchAudit).mockResolvedValue(
      page([
        event(),
        event({
          _id: 'e2',
          type: 'role_changed',
          actor: { email: 'admin@demo.local', role: 'admin' },
          target: { type: 'user', label: 'tech@demo.local' },
          detail: 'Role changed from technician to admin.',
        }),
      ])
    );
    renderSignedInAs('admin', '/admin/audit');

    const rows = await screen.findAllByTestId('audit-row');

    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Login Success')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('203.0.113.9')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Role Changed')).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('Role changed from technician to admin.')
    ).toBeInTheDocument();
  });

  it('says when nothing has been recorded', async () => {
    vi.mocked(api.fetchAudit).mockResolvedValue(page([]));
    renderSignedInAs('admin', '/admin/audit');

    expect(await screen.findByText('No events recorded.')).toBeInTheDocument();
  });

  it('filters by event type, keeping the choice in the address', async () => {
    vi.mocked(api.fetchAudit).mockResolvedValue(page([event()]));
    const { router } = renderSignedInAs('admin', '/admin/audit');
    const user = userEvent.setup();
    await screen.findAllByTestId('audit-row');

    await user.selectOptions(screen.getByLabelText('Filter by event type'), 'login_failure');

    expect(router.state.location.search).toBe('?type=login_failure');
    await waitFor(() =>
      expect(api.fetchAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'login_failure', page: 1 }),
        expect.anything()
      )
    );
  });

  it('pages through the log', async () => {
    vi.mocked(api.fetchAudit).mockResolvedValue(page([event()], { total: 60, totalPages: 3 }));
    const { router } = renderSignedInAs('admin', '/admin/audit');
    const user = userEvent.setup();
    expect(await screen.findByText('Page 1 of 3 · 60 events')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(router.state.location.search).toBe('?page=2');
    await waitFor(() =>
      expect(api.fetchAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
        expect.anything()
      )
    );
  });

  it('shows a load failure', async () => {
    vi.mocked(api.fetchAudit).mockRejectedValue(new Error('Audit unavailable.'));
    renderSignedInAs('admin', '/admin/audit');

    expect(await screen.findByText('Audit unavailable.')).toBeVisible();
  });
});
