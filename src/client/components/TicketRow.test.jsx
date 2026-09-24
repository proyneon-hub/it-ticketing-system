import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeTicket } from '../test/fixtures.js';
import TicketRow from './TicketRow.jsx';

const HOUR = 60 * 60 * 1000;

function renderRow({ ticket = makeTicket(), role = 'admin', expanded = false, ...handlers } = {}) {
  const props = {
    onToggleActivity: vi.fn(),
    onPatch: vi.fn(),
    onDelete: vi.fn(),
    ...handlers,
  };

  render(
    <table>
      <tbody>
        <TicketRow ticket={ticket} role={role} expanded={expanded} {...props} />
      </tbody>
    </table>
  );

  return props;
}

describe('status workflow', () => {
  const statusValues = () =>
    Array.from(screen.getByLabelText('Status for TKT-0001').querySelectorAll('option')).map(
      (option) => option.value
    );

  it('offers only the moves the workflow allows from the current status', () => {
    renderRow({ role: 'technician', ticket: makeTicket({ status: 'open' }) });

    expect(statusValues()).toEqual(['open', 'assigned', 'in-progress', 'closed']);
  });

  it('hides reopening a closed ticket from technicians', () => {
    renderRow({ role: 'technician', ticket: makeTicket({ status: 'closed' }) });

    expect(statusValues()).toEqual(['closed']);
  });

  it('lets admins reopen a closed ticket', () => {
    renderRow({ role: 'admin', ticket: makeTicket({ status: 'closed' }) });

    expect(statusValues()).toEqual(['closed', 'in-progress']);
  });
});

describe('role-based controls', () => {
  it('gives admins full control including delete', () => {
    renderRow({ role: 'admin' });

    expect(screen.getByLabelText('Status for TKT-0001')).toBeEnabled();
    expect(screen.getByLabelText('Assignee for TKT-0001')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('lets technicians work the ticket but not delete it', () => {
    renderRow({ role: 'technician' });

    expect(screen.getByLabelText('Status for TKT-0001')).toBeEnabled();
    expect(screen.getByLabelText('Assignee for TKT-0001')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('limits requesters to priority', () => {
    renderRow({ role: 'user' });

    expect(screen.getByLabelText('Status for TKT-0001')).toBeDisabled();
    expect(screen.getByLabelText('Assignee for TKT-0001')).toBeDisabled();
    expect(screen.getByLabelText('Priority for TKT-0001')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('editing', () => {
  it('patches the status and priority the user picks', async () => {
    const { onPatch } = renderRow();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Status for TKT-0001'), 'in-progress');
    await user.selectOptions(screen.getByLabelText('Priority for TKT-0001'), 'urgent');

    expect(onPatch).toHaveBeenNthCalledWith(1, '665f0f40d5d4f541f8ef1001', {
      status: 'in-progress',
    });
    expect(onPatch).toHaveBeenNthCalledWith(2, '665f0f40d5d4f541f8ef1001', { priority: 'urgent' });
  });

  it('saves an assignee only when it actually changed', async () => {
    const { onPatch } = renderRow();
    const user = userEvent.setup();
    const assignee = screen.getByLabelText('Assignee for TKT-0001');

    await user.click(assignee);
    await user.tab(); // Blur without editing.
    expect(onPatch).not.toHaveBeenCalled();

    await user.clear(assignee);
    await user.type(assignee, 'Theo Technician');
    await user.tab();
    expect(onPatch).toHaveBeenCalledWith('665f0f40d5d4f541f8ef1001', {
      assignee: 'Theo Technician',
    });
  });

  it('asks the parent to delete or toggle the activity timeline', async () => {
    const { onDelete, onToggleActivity } = renderRow();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Activity' }));

    expect(onDelete).toHaveBeenCalledWith('665f0f40d5d4f541f8ef1001');
    expect(onToggleActivity).toHaveBeenCalledWith('665f0f40d5d4f541f8ef1001');
  });
});

describe('display', () => {
  it.each([
    ['breached', -2, 'open'],
    ['due-soon', 6, 'open'],
    ['healthy', 60, 'open'],
    ['met', -2, 'resolved'],
  ])('shows the %s SLA state', (state, offsetHours, status) => {
    const dueAt = new Date(Date.now() + offsetHours * HOUR).toISOString();
    renderRow({ ticket: makeTicket({ dueAt, status }) });

    expect(document.querySelector('.sla-chip')).toHaveClass(state);
  });

  it('falls back gracefully for a ticket with missing details', () => {
    renderRow({
      ticket: makeTicket({
        ticketNumber: undefined,
        description: '',
        category: '',
        requesterName: '',
        requesterEmail: '',
      }),
    });

    expect(screen.getByText('Pending ID')).toBeInTheDocument();
    expect(screen.getByText('No description provided.')).toBeInTheDocument();
    expect(screen.getByText(/General Support \| Unknown requester/)).toBeInTheDocument();
  });

  it('shows the activity timeline only when expanded', () => {
    const activity = [
      {
        action: 'status_changed',
        from: 'open',
        to: 'assigned',
        actorName: 'Theo Technician',
        createdAt: '2026-06-01T12:00:00Z',
      },
    ];
    const ticket = makeTicket({ activity });

    const { unmount } = render(
      <table>
        <tbody>
          <TicketRow ticket={ticket} role="admin" expanded={false} onPatch={vi.fn()} />
        </tbody>
      </table>
    );
    expect(screen.queryByText('Ticket Activity Timeline')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    unmount();

    renderRow({ ticket, expanded: true });
    expect(screen.getByText('Ticket Activity Timeline')).toBeInTheDocument();
    expect(screen.getByText('Status changed')).toBeInTheDocument();
    expect(screen.getByText('open to assigned')).toBeInTheDocument();
    expect(screen.getByText(/Theo Technician/)).toBeInTheDocument();
  });

  it('says so when a ticket has no recorded activity', () => {
    renderRow({ ticket: makeTicket({ activity: [] }), expanded: true });

    expect(screen.getByText('No activity has been recorded for this ticket.')).toBeInTheDocument();
  });
});
