import type { TicketAgent } from '../../shared/ticket-types';
import type { TokenPayload } from '../auth';

// How an edit changes what the ticket records about the agent's triage. Pure, so the rules are
// checked without a database.

const OBJECT_ID = /^[a-f\d]{24}$/i;

const TRIAGE_FIELDS = ['category', 'priority', 'assignee'] as const;

const touchesTriage = (patch: object): boolean =>
  TRIAGE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(patch, field));

// The `agent` field a ticket should carry after `user` applies `patch`, or undefined when the edit
// leaves it alone.
//   - The agent setting category, priority or group: the triage is the agent's, from this run.
//   - A person changing any of them after the agent did: the triage is now a person's, and stays
//     that way, so the record shows who decided last.
//   - Anything else (a status change, a title fix, a person's first triage) leaves it as it was.
export function nextAgentState(
  existing: TicketAgent | undefined,
  patch: object,
  user: Pick<TokenPayload, 'role' | 'runId'>
): TicketAgent | undefined {
  if (!touchesTriage(patch)) return undefined;

  if (user.role === 'agent') {
    // A run id that is not a database id cannot be stored as one, so it is left out, not guessed at.
    const runId = user.runId && OBJECT_ID.test(user.runId) ? user.runId : undefined;
    return { ...existing, triageSource: 'agent', ...(runId ? { lastRunId: runId } : {}) };
  }
  if (existing?.triageSource === 'agent') return { ...existing, triageSource: 'human' };
  return undefined;
}
