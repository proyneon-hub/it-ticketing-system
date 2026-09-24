import { slaEvent } from '../domain/outbox';
import { escalationDue, planEscalation } from '../domain/slaEscalation';
import * as repository from '../repositories/ticketRepository';
import { transaction } from '../repositories/transaction';
import * as outbox from './outboxService';

export interface EscalationResult {
  // Tickets that had just passed their deadline; each was raised one priority step (unless urgent already).
  breached: number;
  // Tickets newly within 24 hours of their deadline.
  atRisk: number;
  // True when the run stopped at its limit with more still to do; the next run continues.
  more: boolean;
}

// How many tickets one call examines, and how many it reads at a time.
const RUN_LIMIT = 500;
const BATCH = 100;

// Looks for tickets that have reached an SLA milestone and records it. Safe to run at any
// time and any number of times: each step is written once, guarded by a marker on the ticket
// (slaAtRiskAt, slaBreachedAt), so a second run right after the first finds nothing. `now` is
// a parameter so the result can be checked against a fixed clock.
export async function escalate(now: Date = new Date()): Promise<EscalationResult> {
  const result: EscalationResult = { breached: 0, atRisk: 0, more: false };
  let examined = 0;

  while (examined < RUN_LIMIT) {
    const batch = await repository.escalationCandidates(now, Math.min(BATCH, RUN_LIMIT - examined));
    if (batch.length === 0) return result;
    examined += batch.length;
    let progressed = false;

    for (const ticket of batch) {
      const kind = escalationDue(ticket, now);
      if (!kind) continue;
      const plan = planEscalation(kind, ticket, now);

      const applied = await transaction(async (tx) => {
        const updated = await repository.applySlaStep(
          ticket._id,
          {
            marker: kind === 'breached' ? 'slaBreachedAt' : 'slaAtRiskAt',
            set: plan.set,
            activity: plan.activity,
            ...(kind === 'breached' ? { expectedPriority: ticket.priority } : {}),
          },
          tx
        );
        if (updated) {
          await outbox.record(
            [slaEvent(kind === 'breached' ? 'breached' : 'at_risk', updated, plan.priorityChange)],
            tx,
            now
          );
        }
        return Boolean(updated);
      });

      if (applied) {
        progressed = true;
        if (kind === 'breached') result.breached += 1;
        else result.atRisk += 1;
      }
    }

    // A full batch of tickets that could not be updated (each changed under us) would be read
    // again forever; the next run picks them up instead.
    if (!progressed) return result;
  }

  result.more = true;
  return result;
}
