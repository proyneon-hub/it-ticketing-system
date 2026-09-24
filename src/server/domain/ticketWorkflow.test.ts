import { allowedNextStatuses, assertTransition, isReopen } from './ticketWorkflow';

const statuses = ['open', 'assigned', 'in-progress', 'resolved', 'closed'];

// Written out by hand, not derived from the shared table, so editing the table
// without meaning to fails here.
const legal: Record<string, string[]> = {
  open: ['assigned', 'in-progress', 'closed'],
  assigned: ['in-progress', 'open'],
  'in-progress': ['resolved', 'assigned'],
  resolved: ['closed', 'in-progress'],
  closed: ['in-progress'],
};
const adminOnly = new Set(['closed->in-progress']);

const pairs = statuses.flatMap((from) => statuses.map((to): [string, string] => [from, to]));

describe('assertTransition', () => {
  test.each(pairs)('%s -> %s as a technician', (from, to) => {
    const key = `${from}->${to}`;
    if (from === to || (legal[from].includes(to) && !adminOnly.has(key))) {
      expect(() => assertTransition(from, to, 'technician')).not.toThrow();
    } else if (adminOnly.has(key)) {
      expect(() => assertTransition(from, to, 'technician')).toThrow(
        expect.objectContaining({ statusCode: 403, message: expect.stringMatching(/admin/i) })
      );
    } else {
      expect(() => assertTransition(from, to, 'technician')).toThrow(
        expect.objectContaining({
          statusCode: 409,
          message: `Cannot move a ticket from ${from} to ${to}.`,
        })
      );
    }
  });

  test.each(pairs)('%s -> %s as an admin', (from, to) => {
    if (from === to || legal[from].includes(to)) {
      expect(() => assertTransition(from, to, 'admin')).not.toThrow();
    } else {
      expect(() => assertTransition(from, to, 'admin')).toThrow(
        expect.objectContaining({ statusCode: 409 })
      );
    }
  });

  test('a status that is not in the table is a conflict, not a crash', () => {
    expect(() => assertTransition('archived', 'open', 'admin')).toThrow(
      expect.objectContaining({ statusCode: 409 })
    );
  });
});

describe('allowedNextStatuses', () => {
  test('lists the current status first, then only what the role may move to', () => {
    expect(allowedNextStatuses('closed', 'technician')).toEqual(['closed']);
    expect(allowedNextStatuses('closed', 'admin')).toEqual(['closed', 'in-progress']);
    expect(allowedNextStatuses('open', 'technician')).toEqual([
      'open',
      'assigned',
      'in-progress',
      'closed',
    ]);
  });
});

describe('isReopen', () => {
  test.each([
    ['resolved', 'in-progress', true],
    ['closed', 'in-progress', true],
    ['resolved', 'closed', false],
    ['open', 'in-progress', false],
    ['resolved', 'resolved', false],
  ])('%s -> %s is %s', (from, to, expected) => {
    expect(isReopen(from, to)).toBe(expected);
  });
});
