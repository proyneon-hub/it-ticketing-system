import type {
  Priority,
  Role,
  SlaFilter,
  SortField,
  Status,
  AuditType,
} from '../shared/ticket-constants';
import type { Ticket } from '../shared/ticket-types';

export type { AuditType, Priority, Role, SlaFilter, SortField, Status, Ticket };

// The signed-in user, as the client uses it.
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// A demo account offered as a one-click sign-in. Its password is public on purpose.
export interface DemoUser extends User {
  demoPassword: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// What the ticket list is filtered, sorted and paged by. Empty strings mean "any".
export interface TicketFilters {
  status: Status | '';
  priority: Priority | '';
  sla: SlaFilter | '';
  search: string;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TicketPage {
  tickets: Ticket[];
  data: Ticket[];
  pagination: Pagination;
}

export interface Stats {
  total: number;
  byStatus: Partial<Record<Status, number>>;
  byPriority: Partial<Record<Priority, number>>;
  sla: { breached: number; dueSoon: number };
}

// The form for a new ticket.
export interface TicketForm {
  title: string;
  description: string;
  requesterName: string;
  requesterEmail: string;
  priority: Priority;
  category: string;
  assignee: string;
}

// What a ticket edit can change from the UI.
export type TicketChanges = Partial<
  Pick<Ticket, 'status' | 'priority' | 'assignee' | 'title' | 'description' | 'category'>
>;

// A user as the admin page lists them.
export interface UserSummary extends User {
  createdAt: string;
}

export interface AuditEvent {
  _id: string;
  type: AuditType;
  outcome: 'success' | 'failure' | 'denied';
  actor?: { id?: string; email?: string; role?: Role };
  target?: { type: string; id?: string; label?: string };
  detail?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  at: string;
}

export interface AuditQuery {
  type: AuditType | '';
  page: number;
  limit: number;
}

export interface AuditPage {
  events: AuditEvent[];
  pagination: Pagination;
}
