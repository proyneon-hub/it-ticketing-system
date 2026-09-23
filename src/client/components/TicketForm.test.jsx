import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TicketForm from './TicketForm.jsx';

const fill = async (user) => {
  await user.type(screen.getByTestId('ticket-title'), 'VPN is down');
  await user.type(screen.getByTestId('ticket-description'), 'Cannot connect since the update.');
};

describe('requester restrictions', () => {
  it('locks identity and assignment fields for requesters', () => {
    render(<TicketForm role="user" saving={false} onCreate={vi.fn()} />);

    expect(screen.getByLabelText('Requester Name')).toBeDisabled();
    expect(screen.getByLabelText('Requester Email')).toBeDisabled();
    expect(screen.getByLabelText('Assignee')).toBeDisabled();
    expect(screen.getByLabelText('Category')).toBeEnabled();
  });

  it.each(['admin', 'technician'])('lets %s raise a ticket on behalf of someone', (role) => {
    render(<TicketForm role={role} saving={false} onCreate={vi.fn()} />);

    expect(screen.getByLabelText('Requester Name')).toBeEnabled();
    expect(screen.getByLabelText('Requester Email')).toBeEnabled();
    expect(screen.getByLabelText('Assignee')).toBeEnabled();
  });
});

describe('submitting', () => {
  it('sends the entered values and clears the form once the ticket is created', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<TicketForm role="admin" saving={false} onCreate={onCreate} />);
    const user = userEvent.setup();

    await fill(user);
    await user.selectOptions(screen.getByTestId('ticket-priority'), 'urgent');
    await user.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'VPN is down',
        description: 'Cannot connect since the update.',
        priority: 'urgent',
        category: 'General Support',
      })
    );
    expect(screen.getByTestId('ticket-title')).toHaveValue('');
    expect(screen.getByTestId('ticket-priority')).toHaveValue('medium');
  });

  it('keeps what was typed when the ticket is rejected', async () => {
    const onCreate = vi.fn().mockResolvedValue(false);
    render(<TicketForm role="admin" saving={false} onCreate={onCreate} />);
    const user = userEvent.setup();

    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(screen.getByTestId('ticket-title')).toHaveValue('VPN is down');
  });

  it('requires a title and description before submitting', async () => {
    const onCreate = vi.fn();
    render(<TicketForm role="admin" saving={false} onCreate={onCreate} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('ticket-title')).toBeInvalid();
    expect(screen.getByTestId('ticket-description')).toBeInvalid();
  });

  it('disables the button while a ticket is being saved', () => {
    render(<TicketForm role="admin" saving onCreate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled();
  });
});
