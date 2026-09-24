import { terminalStatuses } from '../constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// 'in-progress' -> 'In Progress', 'status_changed' -> 'Status Changed'.
export function label(value) {
  return String(value)
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

// met: no SLA left to miss; breached: overdue; due-soon: inside 24h; healthy: otherwise.
export function getSlaState(ticket, now = Date.now()) {
  if (!ticket.dueAt || terminalStatuses.includes(ticket.status)) return 'met';
  const dueAt = new Date(ticket.dueAt).getTime();
  if (dueAt < now) return 'breached';
  if (dueAt - now <= DAY_MS) return 'due-soon';
  return 'healthy';
}

const activityLabels = {
  ticket_created: 'Ticket created',
  ticket_updated: 'Ticket updated',
  status_changed: 'Status changed',
  priority_changed: 'Priority changed',
  assignee_changed: 'Assignee changed',
  ticket_resolved: 'Ticket resolved',
  ticket_closed: 'Ticket closed',
  ticket_reopened: 'Ticket reopened',
};

export function activityLabel(activity) {
  return activityLabels[activity.action] || label(activity.action || 'activity');
}
