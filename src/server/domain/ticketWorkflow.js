const {
  adminOnlyTransitions,
  statusTransitions,
  terminalStatuses,
} = require('../../shared/ticket-constants.json');
const { HttpError } = require('../errors');

// The ticket workflow as pure rules: no Express, no Mongoose. The transition
// table lives in shared/ticket-constants.json so the UI offers exactly the
// moves this file accepts.

const isAdminOnly = (from, to) =>
  adminOnlyTransitions.some(([source, target]) => source === from && target === to);

function isAllowed(from, to, role) {
  return (
    (statusTransitions[from] || []).includes(to) && (role === 'admin' || !isAdminOnly(from, to))
  );
}

// Throws unless `role` may move a ticket from `from` to `to`. Staying on the
// current status is always fine, so a form that re-sends it does not fail.
function assertTransition(from, to, role) {
  if (from === to) return;

  if (!(statusTransitions[from] || []).includes(to)) {
    throw new HttpError(409, `Cannot move a ticket from ${from} to ${to}.`);
  }
  if (!isAllowed(from, to, role)) {
    throw new HttpError(403, `Only an admin can move a ticket from ${from} to ${to}.`);
  }
}

// Current status first (a select needs its own value), then the moves `role` may make.
function allowedNextStatuses(from, role) {
  return [from, ...(statusTransitions[from] || []).filter((to) => isAllowed(from, to, role))];
}

// Leaving a terminal status means the ticket is being worked again.
const isReopen = (from, to) => terminalStatuses.includes(from) && !terminalStatuses.includes(to);

module.exports = { allowedNextStatuses, assertTransition, isReopen };
