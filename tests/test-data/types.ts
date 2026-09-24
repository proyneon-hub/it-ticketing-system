export type UserRole = 'admin' | 'technician' | 'user';
export type TicketStatus = 'open' | 'assigned' | 'in-progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TestUser {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface NewTicketData {
  title: string;
  description: string;
  category: string;
  priority: TicketPriority;
}

export interface MockUser {
  sub: string;
  name: string;
  email: string;
  role: UserRole;
  demoPassword: string;
}

export interface MockActivity {
  action: string;
  detail?: string;
  from?: TicketStatus;
  to?: TicketStatus;
  actorName: string;
  actorRole: UserRole;
  createdAt: string;
}

export interface MockTicket {
  _id: string;
  ticketNumber: string;
  title: string;
  description: string;
  requesterName: string;
  requesterEmail: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  assignee: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  activity: MockActivity[];
  // Ticket version, as the real API returns it; sent back as If-Match on edits.
  __v: number;
}

export interface MockDashboardStats {
  total: number;
  byStatus: Record<TicketStatus, number>;
  byPriority: Record<TicketPriority, number>;
  sla: {
    breached: number;
    dueSoon: number;
  };
}
