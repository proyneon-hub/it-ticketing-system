// The ticket vocabulary shared by the API, the database models and the UI.
// Declared `as const` so the same lists give both the runtime values and the
// literal types (Status, Priority, ...), and a value can never be added in one
// place and forgotten in another.

// The roles a person can hold. This is what the user model, the role picker and the
// role-change endpoint accept, so nobody can be given the agent role through them.
export const roles = ['admin', 'technician', 'user'] as const;
export type Role = (typeof roles)[number];

// The service desk agent is not a user account. It exists only as a short-lived token
// minted by the worker for one ticket (security/accessToken.ts), so it is a separate
// actor role, not a member of `roles`.
export const agentRole = 'agent' as const;

// Everyone who can appear in a token, a comment or a history entry.
export const actorRoles = [...roles, agentRole] as const;
export type ActorRole = (typeof actorRoles)[number];

// `pending-user` means the ticket is waiting on the requester (for a reply, or to confirm a
// fix). The service desk agent sets it when it posts a resolution; the requester's reply, or
// a technician, moves it on.
export const statuses = [
  'open',
  'assigned',
  'in-progress',
  'pending-user',
  'resolved',
  'closed',
] as const;
export type Status = (typeof statuses)[number];

export const priorities = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof priorities)[number];

// Resolved and closed tickets stop the SLA clock.
export const terminalStatuses = ['resolved', 'closed'] as const satisfies readonly Status[];

// Which status a ticket may move to from each status. The API enforces this
// (src/server/domain/ticketWorkflow.ts) and the status menu offers only these moves.
export const statusTransitions = {
  open: ['assigned', 'in-progress', 'pending-user', 'closed'],
  assigned: ['in-progress', 'pending-user', 'open'],
  'in-progress': ['resolved', 'pending-user', 'assigned'],
  'pending-user': ['in-progress', 'resolved', 'closed'],
  resolved: ['closed', 'in-progress'],
  closed: ['in-progress'],
} as const satisfies Record<Status, readonly Status[]>;

// The status the agent may move a ticket to (and the only one). Everything else about a
// ticket's workflow stays with people.
export const agentStatus = 'pending-user' as const satisfies Status;

// While a ticket waits for its requester the team cannot act on it, so its SLA clock is not
// counted: it is not flagged at risk or breached, and the escalation job leaves it alone.
// The deadline itself does not move, so when the ticket is worked again the time it waited
// still counts against it.
export const slaPausedStatuses = ['pending-user'] as const satisfies readonly Status[];

// Moves that exist in the table above but only an admin may make.
export const adminOnlyTransitions = [
  ['closed', 'in-progress'],
] as const satisfies readonly (readonly [Status, Status])[];

export const slaHoursByPriority = {
  low: 72,
  medium: 48,
  high: 24,
  urgent: 4,
} as const satisfies Record<Priority, number>;

// What the security audit log records.
export const auditTypes = [
  'login_success',
  'login_failure',
  'logout',
  'refresh_reuse',
  'role_changed',
  'ticket_deleted',
  'permission_denied',
  'outbox_retried',
] as const;
export type AuditType = (typeof auditTypes)[number];

// Who may read a comment. Internal notes are for staff; a requester never receives one.
export const commentVisibilities = ['public', 'internal'] as const;
export type CommentVisibility = (typeof commentVisibilities)[number];

// Events that leave the system through the outbox (see src/server/domain/outbox.ts).
export const outboxEventTypes = [
  'ticket.created',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.comment_added',
  'ticket.sla_at_risk',
  'ticket.sla_breached',
] as const;
export type OutboxEventType = (typeof outboxEventTypes)[number];

// Who an event is for. Each event is written once per consumer that wants it: the webhook
// sends notifications, the agent triages new tickets. Events written before consumers existed
// have no value here and belong to the webhook.
export const outboxConsumers = ['webhook', 'agent'] as const;
export type OutboxConsumer = (typeof outboxConsumers)[number];

// The events the agent acts on. It triages a ticket when it is created; nothing else it hears
// about, and everything else stays with the webhook.
export const agentEventTypes = ['ticket.created'] as const satisfies readonly OutboxEventType[];

// pending: waiting to be sent (or to be retried). sending: claimed by a worker. delivered:
// the webhook accepted it. dead: gave up after the last attempt; an admin can retry it.
export const outboxStatuses = ['pending', 'sending', 'delivered', 'dead'] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export const slaFilters = ['breached', 'due-soon'] as const;
export type SlaFilter = (typeof slaFilters)[number];

export const sortFields = [
  'ticketNumber',
  'title',
  'status',
  'priority',
  'assignee',
  'dueAt',
  'createdAt',
  'updatedAt',
] as const;
export type SortField = (typeof sortFields)[number];
