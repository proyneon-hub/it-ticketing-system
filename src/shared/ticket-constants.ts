// The ticket vocabulary shared by the API, the database models and the UI.
// Declared `as const` so the same lists give both the runtime values and the
// literal types (Status, Priority, ...), and a value can never be added in one
// place and forgotten in another.

export const roles = ['admin', 'technician', 'user'] as const;
export type Role = (typeof roles)[number];

export const statuses = ['open', 'assigned', 'in-progress', 'resolved', 'closed'] as const;
export type Status = (typeof statuses)[number];

export const priorities = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof priorities)[number];

// Resolved and closed tickets stop the SLA clock.
export const terminalStatuses = ['resolved', 'closed'] as const satisfies readonly Status[];

// Which status a ticket may move to from each status. The API enforces this
// (src/server/domain/ticketWorkflow.ts) and the status menu offers only these moves.
export const statusTransitions = {
  open: ['assigned', 'in-progress', 'closed'],
  assigned: ['in-progress', 'open'],
  'in-progress': ['resolved', 'assigned'],
  resolved: ['closed', 'in-progress'],
  closed: ['in-progress'],
} as const satisfies Record<Status, readonly Status[]>;

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
