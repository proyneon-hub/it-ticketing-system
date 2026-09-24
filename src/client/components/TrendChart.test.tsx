import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeTrends } from '../test/fixtures';
import TrendChart, { niceScale, shortDate } from './TrendChart';

describe('niceScale', () => {
  it.each([
    [0, 1, [0, 1]],
    [3, 3, [0, 1, 2, 3]],
    [7, 8, [0, 2, 4, 6, 8]],
    [12, 15, [0, 5, 10, 15]],
    [43, 60, [0, 20, 40, 60]],
    [180, 200, [0, 50, 100, 150, 200]],
  ])('for a maximum of %i the axis tops out at %i with even ticks', (max, top, ticks) => {
    expect(niceScale(max)).toEqual({ top, ticks });
  });

  it('always covers the largest value, with whole-number ticks', () => {
    for (let max = 0; max <= 500; max += 7) {
      const { top, ticks } = niceScale(max);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(ticks.every(Number.isInteger)).toBe(true);
    }
  });
});

describe('shortDate', () => {
  it('formats a calendar date without shifting it across a time zone', () => {
    expect(shortDate('2026-06-13')).toBe('Jun 13');
    expect(shortDate('2026-01-01')).toBe('Jan 1');
  });
});

describe('the chart', () => {
  const { series } = makeTrends();

  it('names both series in a legend', () => {
    render(<TrendChart series={series} />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Opened')).toBeInTheDocument();
    expect(within(legend).getByText('Resolved')).toBeInTheDocument();
  });

  it('has every number available as a table, hidden until asked for', async () => {
    render(<TrendChart series={series} />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: 'Show as table' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(toggle);

    const table = screen.getByRole('table');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((row) => Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent))
    ).toEqual([
      ['Jun 13', '2', '0'],
      ['Jun 14', '5', '1'],
      ['Jun 15', '1', '1'],
    ]);
    await user.click(screen.getByRole('button', { name: 'Hide table' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reads out a day at a time from the keyboard', async () => {
    render(<TrendChart series={series} />);
    const user = userEvent.setup();
    const plot = screen.getByRole('group', { name: /Tickets opened and resolved per day/ });

    await user.tab(); // The legend has no stops; the table button comes first.
    await user.tab();
    expect(plot).toHaveFocus();
    // Focus starts at the latest day.
    expect(screen.getByRole('status')).toHaveTextContent('Jun 15');
    expect(screen.getByRole('status')).toHaveTextContent('1 opened');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status')).toHaveTextContent('Jun 14');
    expect(screen.getByRole('status')).toHaveTextContent('5 opened');
    expect(screen.getByRole('status')).toHaveTextContent('1 resolved');

    await user.keyboard('{Home}');
    expect(screen.getByRole('status')).toHaveTextContent('Jun 13');
    await user.keyboard('{ArrowLeft}'); // Stops at the first day.
    expect(screen.getByRole('status')).toHaveTextContent('Jun 13');

    await user.keyboard('{End}');
    expect(screen.getByRole('status')).toHaveTextContent('Jun 15');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('draws one line per series', () => {
    const { container } = render(<TrendChart series={series} />);
    expect(container.querySelectorAll('path.line')).toHaveLength(2);
  });

  it('copes with a single day and with none', () => {
    const { rerender, container } = render(<TrendChart series={series.slice(0, 1)} />);
    expect(container.querySelectorAll('path.line')).toHaveLength(2);
    rerender(<TrendChart series={[]} />);
    expect(container.querySelectorAll('path.line')).toHaveLength(2);
  });
});
