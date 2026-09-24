import { priorities, statuses, terminalStatuses } from '../shared/ticket-constants';
import type { Credentials, TicketFilters, TicketForm } from './types';

// Status and priority lists come from the same module the API validates against,
// so the UI can never offer a value the server would reject.
export { priorities, statuses, terminalStatuses };

export const sortOptions: [TicketFilters['sortBy'], string][] = [
  ['createdAt', 'Newest first'],
  ['ticketNumber', 'Ticket ID'],
  ['priority', 'Priority'],
  ['status', 'Status'],
  ['dueAt', 'SLA due date'],
];

export const emptyTicketForm: TicketForm = {
  title: '',
  description: '',
  requesterName: '',
  requesterEmail: '',
  priority: 'medium',
  category: 'General Support',
  assignee: '',
};

export const defaultFilters: TicketFilters = {
  status: '',
  priority: '',
  sla: '',
  search: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  page: 1,
  limit: 10,
};

export const defaultCredentials: Credentials = {
  email: 'admin@demo.local',
  password: 'AdminPass123!',
};

export const SEARCH_DEBOUNCE_MS = 300;
