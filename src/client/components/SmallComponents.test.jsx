import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { defaultFilters } from '../constants.js';
import Alert from './Alert.jsx';
import DemoAccounts from './DemoAccounts.jsx';
import Pagination from './Pagination.jsx';
import { StatsGrid, WorkflowStrip } from './StatsGrid.jsx';
import TicketFilters from './TicketFilters.jsx';
import { demoUsers } from '../test/fixtures.js';

describe('Alert', () => {
  it('shows an error with its support reference, keeping the message separately readable', () => {
    render(<Alert type="error" message="Database unavailable." requestId="req-42" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Database unavailable.', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-42/)).toBeInTheDocument();
  });

  it('omits the reference when the server sent no request id', () => {
    render(<Alert type="error" message="Nope." />);

    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });

  it('announces success politely and renders nothing without a message', () => {
    const { rerender, container } = render(<Alert type="success" message="Ticket updated." />);
    expect(screen.getByRole('status')).toHaveTextContent('Ticket updated.');

    rerender(<Alert type="success" message="" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Pagination', () => {
  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(
      <Pagination pagination={{ page: 1, totalPages: 3, total: 25 }} onPage={vi.fn()} />
    );
    expect(screen.getByText('Page 1 of 3 · 25 tickets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    rerender(<Pagination pagination={{ page: 3, totalPages: 3, total: 25 }} onPage={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('asks for the neighbouring page and locks while loading', async () => {
    const onPage = vi.fn();
    const { rerender } = render(
      <Pagination pagination={{ page: 2, totalPages: 3, total: 25 }} onPage={onPage} />
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPage.mock.calls).toEqual([[3], [1]]);

    rerender(
      <Pagination pagination={{ page: 2, totalPages: 3, total: 25 }} loading onPage={onPage} />
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('TicketFilters', () => {
  it('reports each control by the field it changes', async () => {
    const onChange = vi.fn();
    render(<TicketFilters filters={defaultFilters} onChange={onChange} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Search tickets'), 'a');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'assigned');
    await user.selectOptions(screen.getByLabelText('Filter by priority'), 'urgent');
    await user.selectOptions(screen.getByLabelText('Filter by SLA state'), 'breached');
    await user.selectOptions(screen.getByLabelText('Sort tickets by'), 'priority');
    await user.selectOptions(screen.getByLabelText('Sort direction'), 'asc');

    expect(onChange.mock.calls).toEqual([
      ['search', 'a'],
      ['status', 'assigned'],
      ['priority', 'urgent'],
      ['sla', 'breached'],
      ['sortBy', 'priority'],
      ['sortOrder', 'asc'],
    ]);
  });
});

describe('DemoAccounts', () => {
  it('renders nothing until the demo users have loaded', () => {
    const { container } = render(<DemoAccounts demoUsers={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('signs in with the chosen role credentials', async () => {
    const onSelect = vi.fn();
    render(<DemoAccounts demoUsers={demoUsers} onSelect={onSelect} />);

    await userEvent.setup().click(screen.getByTestId('demo-login-technician'));

    expect(onSelect).toHaveBeenCalledWith({
      email: 'tech@demo.local',
      password: 'technician-password',
    });
  });
});

describe('stats', () => {
  it('prefers server stats, and falls back to what is visible while they load', () => {
    const { rerender } = render(
      <StatsGrid stats={null} activeCount={4} breachedVisibleCount={2} />
    );
    expect(screen.getByText('Total Tickets').nextSibling).toHaveTextContent('-');
    expect(screen.getByText('SLA Breached').nextSibling).toHaveTextContent('2');

    rerender(
      <StatsGrid
        stats={{ total: 12, sla: { breached: 5, dueSoon: 3 } }}
        activeCount={4}
        breachedVisibleCount={2}
      />
    );
    expect(screen.getByText('Total Tickets').nextSibling).toHaveTextContent('12');
    expect(screen.getByText('SLA Breached').nextSibling).toHaveTextContent('5');
    expect(screen.getByText('Due In 24h').nextSibling).toHaveTextContent('3');
  });

  it('lists every workflow status with its count, defaulting to zero', () => {
    render(<WorkflowStrip stats={{ byStatus: { open: 7 } }} />);

    expect(screen.getByText('Open').nextSibling).toHaveTextContent('7');
    expect(screen.getByText('In Progress').nextSibling).toHaveTextContent('0');
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });
});
