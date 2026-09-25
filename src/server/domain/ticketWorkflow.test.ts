import { allowedNextStatuses, assertTransition, isReopen } from './ticketWorkflow';

const statuses = ['open', 'assigned', 'in-progress', 'pending-user', 'resolved', 'closed'];

// Written out by hand, not derived from the shared table, so editing the table
// without meaning to fails here.
const legal: Record<string, string[]> = {
  open: ['assigned', 'in-progress', 'pending-user', 'closed'],
  assigned: ['in-progress', 'pending-user', 'open'],
  'in-progress': ['resolved', 'pending-user', 'assigned'],
  'pending-user': ['in-progress', 'resolved', 'closed'],
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
      'pending-user',
      'closed',
    ]);
    expect(allowedNextStatuses('pending-user', 'technician')).toEqual([
      'pending-user',
      'in-progress',
      'resolved',
      'closed',
    ]);
  });

  test('a ticket that is finished cannot be handed back to the requester', () => {
    expect(allowedNextStatuses('resolved', 'admin')).not.toContain('pending-user');
    expect(allowedNextStatuses('closed', 'admin')).not.toContain('pending-user');
  });
});

describe('the agent', () => {
  test.each(['open', 'assigned', 'in-progress'])(
    'may hand a %s ticket to the requester',
    (from) => {
      expect(() => assertTransition(from, 'pending-user', 'agent')).not.toThrow();
    }
  );

  test('cannot hand a finished ticket to the requester', () => {
    expect(() => assertTransition('resolved', 'pending-user', 'agent')).toThrow(
      expect.objectContaining({ statusCode: 409 })
    );
  });

  test('cannot make the admin-only move, like any other non-admin', () => {
    expect(() => assertTransition('closed', 'in-progress', 'agent')).toThrow(
      expect.objectContaining({ statusCode: 403 })
    );
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
