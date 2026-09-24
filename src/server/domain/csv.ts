import type { TicketAttrs } from '../../shared/ticket-types';
import { isSlaBreached } from './sla';

// Spreadsheet apps execute cells that start with = + - @, so text a requester
// controls (like a title) is prefixed with an apostrophe to keep it inert.
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_HEADER = [
  'Ticket ID',
  'Title',
  'Status',
  'Priority',
  'Requester',
  'Assigned To',
  'Created At',
  'Updated At',
  'SLA Due At',
  'SLA Breached',
];

type CsvTicket = Pick<
  TicketAttrs,
  | 'ticketNumber'
  | 'title'
  | 'status'
  | 'priority'
  | 'requesterEmail'
  | 'requesterName'
  | 'assignee'
  | 'createdAt'
  | 'updatedAt'
  | 'dueAt'
> & { _id: { toString(): string } };

export const csvLine = (cells: unknown[]): string => cells.map(csvEscape).join(',');

export const csvHeaderLine = (): string => csvLine(CSV_HEADER);

export function ticketToCsvLine(ticket: CsvTicket, now: number = Date.now()): string {
  return csvLine([
    ticket.ticketNumber || ticket._id.toString(),
    ticket.title,
    ticket.status,
    ticket.priority,
    ticket.requesterEmail || ticket.requesterName,
    ticket.assignee,
    ticket.createdAt,
    ticket.updatedAt,
    ticket.dueAt,
    isSlaBreached(ticket, now) ? 'Yes' : 'No',
  ]);
}
