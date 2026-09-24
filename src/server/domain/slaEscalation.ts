import { priorities, type Priority } from '../../shared/ticket-constants';
import type { ActivityEntry, TicketAttrs } from '../../shared/ticket-types';
import { DUE_SOON_WINDOW_MS, isTerminal } from './sla';

// What the scheduled SLA job does to a ticket. The job runs every half hour and must be safe
// to run at any time, any number of times: each step leaves a marker on the ticket
// (slaAtRiskAt, slaBreachedAt) so it happens once, and a rerun finds nothing left to do.
// The time is a parameter throughout, so the rules can be checked against a fixed clock.

export type Escalation = 'at_risk' | 'breached';

type Escalatable = Pick<
  TicketAttrs,
  'status' | 'priority' | 'dueAt' | 'slaAtRiskAt' | 'slaBreachedAt'
>;

// One step up the priority ladder; the top stays where it is.
export function raisedPriority(priority: Priority): Priority {
  const next = priorities[priorities.indexOf(priority) + 1];
  return next ?? priority;
}

// What, if anything, is due for this ticket at `now`. Finished tickets have stopped their
// SLA clock, so they are left alone. A ticket past its deadline is breached whether or not it
// was ever seen "at risk".
export function escalationDue(ticket: Escalatable, now: Date): Escalation | null {
  if (isTerminal(ticket.status) || !ticket.dueAt) return null;

  const due = new Date(ticket.dueAt).getTime();
  if (due < now.getTime()) return ticket.slaBreachedAt ? null : 'breached';
  if (due <= now.getTime() + DUE_SOON_WINDOW_MS) return ticket.slaAtRiskAt ? null : 'at_risk';
  return null;
}

export interface EscalationPlan {
  kind: Escalation;
  // Fields to set. Never dueAt: the deadline stays where it was, so a breached ticket keeps
  // showing how late it is, and raising the priority does not quietly give it a new, later one.
  set: { slaAtRiskAt: Date } | { slaBreachedAt: Date; priority: Priority };
  activity: ActivityEntry;
  // For the event that announces a breach.
  priorityChange?: { from: Priority; to: Priority };
}

const SYSTEM = { actorName: 'SLA automation', actorRole: 'system' } as const;

export function planEscalation(
  kind: Escalation,
  ticket: Pick<TicketAttrs, 'priority'>,
  now: Date
): EscalationPlan {
  if (kind === 'at_risk') {
    return {
      kind,
      set: { slaAtRiskAt: now },
      activity: { ...SYSTEM, action: 'sla_at_risk', detail: 'Due within 24 hours' },
    };
  }

  const to = raisedPriority(ticket.priority);
  const raised = to !== ticket.priority;
  return {
    kind,
    set: { slaBreachedAt: now, priority: to },
    activity: {
      ...SYSTEM,
      action: 'sla_breached',
      ...(raised ? { from: ticket.priority, to } : {}),
      detail: raised ? 'SLA deadline passed; priority raised' : 'SLA deadline passed',
    },
    ...(raised ? { priorityChange: { from: ticket.priority, to } } : {}),
  };
}
