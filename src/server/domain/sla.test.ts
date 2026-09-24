import { HOUR_MS, deriveTimestampChanges, dueAtFor, isSlaBreached } from './sla';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const RAISED = new Date('2026-06-10T08:00:00.000Z');

describe('dueAtFor', () => {
  test.each([
    ['low', 72],
    ['medium', 48],
    ['high', 24],
    ['urgent', 4],
  ] as const)('a %s ticket is due %i hours after it was raised', (priority, hours) => {
    expect(dueAtFor(priority, RAISED).getTime()).toBe(RAISED.getTime() + hours * HOUR_MS);
  });
});

describe('isSlaBreached', () => {
  const past = new Date(NOW.getTime() - HOUR_MS);
  const future = new Date(NOW.getTime() + HOUR_MS);

  test('an unresolved ticket past its deadline is breached', () => {
    expect(isSlaBreached({ status: 'open', dueAt: past }, NOW.getTime())).toBe(true);
    expect(isSlaBreached({ status: 'in-progress', dueAt: past }, NOW.getTime())).toBe(true);
  });

  test.each(['resolved', 'closed'] as const)('a %s ticket stops the clock', (status) => {
    expect(isSlaBreached({ status, dueAt: past }, NOW.getTime())).toBe(false);
  });

  test('a ticket that is not yet due, or has no deadline, is not breached', () => {
    expect(isSlaBreached({ status: 'open', dueAt: future }, NOW.getTime())).toBe(false);
    expect(isSlaBreached({ status: 'open' }, NOW.getTime())).toBe(false);
  });
});

describe('deriveTimestampChanges', () => {
  const open = { status: 'open', priority: 'medium', createdAt: RAISED } as const;

  test('resolving stamps resolvedAt', () => {
    const { set, unset } = deriveTimestampChanges(open, { status: 'resolved' }, NOW);
    expect(set.resolvedAt).toEqual(NOW);
    expect(unset).toEqual({});
  });

  test('closing an already resolved ticket keeps the original resolvedAt', () => {
    const resolvedAt = new Date('2026-06-09T00:00:00.000Z');
    const { set } = deriveTimestampChanges(
      { ...open, status: 'resolved', resolvedAt },
      { status: 'closed' },
      NOW
    );
    expect(set.resolvedAt).toBeUndefined();
  });

  test('a terminal ticket with no resolvedAt (bad data) gets one', () => {
    const { set } = deriveTimestampChanges(
      { ...open, status: 'closed' },
      { status: 'closed' },
      NOW
    );
    expect(set.resolvedAt).toEqual(NOW);
  });

  test('reopening clears resolvedAt', () => {
    const { set, unset } = deriveTimestampChanges(
      { ...open, status: 'resolved', resolvedAt: NOW },
      { status: 'in-progress' },
      NOW
    );
    expect(unset).toEqual({ resolvedAt: 1 });
    expect(set).toEqual({});
  });

  test('a new priority recalculates the deadline from when the ticket was raised', () => {
    const { set } = deriveTimestampChanges(open, { priority: 'urgent' }, NOW);
    expect(set.dueAt).toEqual(dueAtFor('urgent', RAISED));
  });

  test('an explicit dueAt, or an unchanged priority, leaves the deadline alone', () => {
    expect(deriveTimestampChanges(open, { priority: 'urgent', dueAt: NOW }, NOW).set.dueAt).toBe(
      undefined
    );
    expect(deriveTimestampChanges(open, { priority: 'medium' }, NOW).set.dueAt).toBe(undefined);
  });

  test('a ticket without createdAt is measured from now', () => {
    const { set } = deriveTimestampChanges(
      { status: 'open', priority: 'low' },
      { priority: 'high' },
      NOW
    );
    expect(set.dueAt).toEqual(dueAtFor('high', NOW));
  });
});
