import type { TicketAttrs } from '../../shared/ticket-types';
import { escalationDue, planEscalation, raisedPriority } from './slaEscalation';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00Z');
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * HOUR);

type Fields = Pick<TicketAttrs, 'status' | 'priority' | 'dueAt' | 'slaAtRiskAt' | 'slaBreachedAt'>;
const ticket = (overrides: Partial<Fields> = {}): Fields => ({
  status: 'open',
  priority: 'high',
  dueAt: at(72),
  ...overrides,
});

describe('raisedPriority', () => {
  test.each([
    ['low', 'medium'],
    ['medium', 'high'],
    ['high', 'urgent'],
    ['urgent', 'urgent'],
  ] as const)('%s becomes %s', (from, to) => {
    expect(raisedPriority(from)).toBe(to);
  });
});

describe('escalationDue', () => {
  test('a deadline that has passed is a breach, whether or not it was seen at risk', () => {
    expect(escalationDue(ticket({ dueAt: at(-1) }), NOW)).toBe('breached');
    expect(escalationDue(ticket({ dueAt: at(-1), slaAtRiskAt: at(-20) }), NOW)).toBe('breached');
  });

  test('a deadline within 24 hours is at risk, up to and including the 24th hour', () => {
    expect(escalationDue(ticket({ dueAt: at(23) }), NOW)).toBe('at_risk');
    expect(escalationDue(ticket({ dueAt: at(24) }), NOW)).toBe('at_risk');
    expect(escalationDue(ticket({ dueAt: at(0) }), NOW)).toBe('at_risk');
  });

  test('a deadline further off is left alone', () => {
    expect(escalationDue(ticket({ dueAt: at(24.01) }), NOW)).toBeNull();
    expect(escalationDue(ticket({ dueAt: at(72) }), NOW)).toBeNull();
  });

  test('each step happens once: the marker stops a repeat', () => {
    expect(escalationDue(ticket({ dueAt: at(-1), slaBreachedAt: at(-0.5) }), NOW)).toBeNull();
    expect(escalationDue(ticket({ dueAt: at(5), slaAtRiskAt: at(-1) }), NOW)).toBeNull();
  });

  test.each(['resolved', 'closed'] as const)('a %s ticket has stopped its clock', (status) => {
    expect(escalationDue(ticket({ status, dueAt: at(-10) }), NOW)).toBeNull();
    expect(escalationDue(ticket({ status, dueAt: at(5) }), NOW)).toBeNull();
  });

  test.each(['open', 'assigned', 'in-progress'] as const)('a %s ticket is watched', (status) => {
    expect(escalationDue(ticket({ status, dueAt: at(-1) }), NOW)).toBe('breached');
  });

  test('a ticket waiting on its requester has paused its clock: nothing is due, past or soon', () => {
    expect(escalationDue(ticket({ status: 'pending-user', dueAt: at(-10) }), NOW)).toBeNull();
    expect(escalationDue(ticket({ status: 'pending-user', dueAt: at(5) }), NOW)).toBeNull();
  });

  test('a ticket with no deadline is left alone', () => {
    const { dueAt: _dueAt, ...withoutDue } = ticket();
    expect(escalationDue(withoutDue, NOW)).toBeNull();
  });
});

describe('planEscalation', () => {
  test('at risk records a marker and history, and changes nothing else', () => {
    const plan = planEscalation('at_risk', ticket(), NOW);
    expect(plan.set).toEqual({ slaAtRiskAt: NOW });
    expect(plan.activity).toMatchObject({
      action: 'sla_at_risk',
      actorName: 'SLA automation',
      actorRole: 'system',
    });
    expect(plan.priorityChange).toBeUndefined();
  });

  test('a breach raises the priority one step and says so in the history', () => {
    const plan = planEscalation('breached', ticket({ priority: 'medium' }), NOW);
    expect(plan.set).toEqual({ slaBreachedAt: NOW, priority: 'high' });
    expect(plan.activity).toMatchObject({ action: 'sla_breached', from: 'medium', to: 'high' });
    expect(plan.priorityChange).toEqual({ from: 'medium', to: 'high' });
  });

  test('an urgent ticket is marked but stays urgent', () => {
    const plan = planEscalation('breached', ticket({ priority: 'urgent' }), NOW);
    expect(plan.set).toEqual({ slaBreachedAt: NOW, priority: 'urgent' });
    expect(plan.activity.from).toBeUndefined();
    expect(plan.activity.detail).toBe('SLA deadline passed');
    expect(plan.priorityChange).toBeUndefined();
  });

  test('never moves the deadline (an explicit exception to the rule that a priority change resets it)', () => {
    for (const kind of ['at_risk', 'breached'] as const) {
      expect(Object.keys(planEscalation(kind, ticket(), NOW).set)).not.toContain('dueAt');
    }
  });
});
