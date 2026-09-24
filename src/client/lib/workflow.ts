import {
  adminOnlyTransitions,
  statusTransitions,
  type Role,
  type Status,
} from '../../shared/ticket-constants';

const isAdminOnly = (from: string, to: string): boolean =>
  adminOnlyTransitions.some(([source, target]) => source === from && target === to);

// The API enforces the workflow (see src/server/domain/ticketWorkflow.ts) from the
// same transition table. This only decides which options the status menu offers:
// the current status, then the moves this role may make from it.
export function allowedNextStatuses(status: string, role: Role): string[] {
  const moves: readonly string[] = statusTransitions[status as Status] ?? [];
  return [status, ...moves.filter((to) => role === 'admin' || !isAdminOnly(status, to))];
}
