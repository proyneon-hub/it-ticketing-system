import { activityLabel, formatDate, getSlaState, label } from './format';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-06-01T12:00:00Z').getTime();
const due = (offsetHours: number) => new Date(NOW + offsetHours * HOUR).toISOString();

describe('label', () => {
  it.each([
    ['in-progress', 'In Progress'],
    ['status_changed', 'Status Changed'],
    ['admin', 'Admin'],
  ])('turns %s into %s', (input, expected) => {
    expect(label(input)).toBe(expected);
  });
});

describe('getSlaState', () => {
  it('is breached once an unresolved ticket passes its due date', () => {
    expect(getSlaState({ status: 'open', dueAt: due(-1) }, NOW)).toBe('breached');
  });

  it('is due-soon inside the final 24 hours, including the boundary', () => {
    expect(getSlaState({ status: 'open', dueAt: due(5) }, NOW)).toBe('due-soon');
    expect(getSlaState({ status: 'open', dueAt: due(24) }, NOW)).toBe('due-soon');
  });

  it('is healthy with more than 24 hours left', () => {
    expect(getSlaState({ status: 'in-progress', dueAt: due(25) }, NOW)).toBe('healthy');
  });

  it.each(['resolved', 'closed'] as const)('is met for %s tickets even when overdue', (status) => {
    expect(getSlaState({ status, dueAt: due(-100) }, NOW)).toBe('met');
  });

  it('is met when the ticket has no due date', () => {
    expect(getSlaState({ status: 'open' } as never, NOW)).toBe('met');
  });
});

describe('activityLabel', () => {
  it('uses friendly names for known actions and a readable fallback otherwise', () => {
    expect(activityLabel({ action: 'status_changed' })).toBe('Status changed');
    expect(activityLabel({ action: 'ticket_reopened' })).toBe('Ticket reopened');
    expect(activityLabel({ action: 'comment_added' })).toBe('Comment added');
    expect(activityLabel({ action: 'something_new' })).toBe('Something New');
    expect(activityLabel({})).toBe('Activity');
  });
});

describe('formatDate', () => {
  it('shows a placeholder for missing dates and a localized date otherwise', () => {
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('2026-06-01T12:00:00Z')).toMatch(/2026/);
  });
});
