import shared from '../../shared/ticket-constants.json';

const { adminOnlyTransitions, statusTransitions } = shared;

const isAdminOnly = (from, to) =>
  adminOnlyTransitions.some(([source, target]) => source === from && target === to);

// The API enforces the workflow (see src/server/domain/ticketWorkflow.js) from the
// same transition table. This only decides which options the status menu offers:
// the current status, then the moves this role may make from it.
export function allowedNextStatuses(status, role) {
  const next = (statusTransitions[status] || []).filter(
    (to) => role === 'admin' || !isAdminOnly(status, to)
  );
  return [status, ...next];
}
