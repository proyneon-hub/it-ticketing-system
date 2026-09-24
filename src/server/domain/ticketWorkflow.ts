import {
  adminOnlyTransitions,
  statusTransitions,
  terminalStatuses,
  type Role,
  type Status,
} from '../../shared/ticket-constants';
import { HttpError } from '../errors';

// The ticket workflow as pure rules: no Express, no Mongoose. The transition
// table lives in shared/ticket-constants.ts so the UI offers exactly the moves
// this file accepts.

// A status that is not in the table (bad data) has no moves rather than crashing.
const movesFrom = (from: string): readonly string[] => statusTransitions[from as Status] ?? [];

const isAdminOnly = (from: string, to: string): boolean =>
  adminOnlyTransitions.some(([source, target]) => source === from && target === to);

function isAllowed(from: string, to: string, role: Role): boolean {
  return movesFrom(from).includes(to) && (role === 'admin' || !isAdminOnly(from, to));
}

// Throws unless `role` may move a ticket from `from` to `to`. Staying on the
// current status is always fine, so a form that re-sends it does not fail.
export function assertTransition(from: string, to: string, role: Role): void {
  if (from === to) return;

  if (!movesFrom(from).includes(to)) {
    throw new HttpError(409, `Cannot move a ticket from ${from} to ${to}.`);
  }
  if (!isAllowed(from, to, role)) {
    throw new HttpError(403, `Only an admin can move a ticket from ${from} to ${to}.`);
  }
}

// Current status first (a select needs its own value), then the moves `role` may make.
export function allowedNextStatuses(from: string, role: Role): string[] {
  return [from, ...movesFrom(from).filter((to) => isAllowed(from, to, role))];
}

const isTerminal = (status: string): boolean =>
  (terminalStatuses as readonly string[]).includes(status);

// Leaving a terminal status means the ticket is being worked again.
export const isReopen = (from: string, to: string): boolean => isTerminal(from) && !isTerminal(to);
