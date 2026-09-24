import type { Priority, Role, Status } from './ticket-constants';

// One entry in a ticket's history. Written by the service on every change.
export interface ActivityEntry {
  action: string;
  actorName?: string | undefined;
  actorRole?: Role | undefined;
  actorEmail?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  detail?: string | undefined;
  createdAt?: Date | undefined;
}

// The fields stored for a ticket. Plain data: no database types, so the domain
// layer can describe tickets without knowing how they are stored.
export interface TicketAttrs {
  ticketNumber?: string;
  title: string;
  description: string;
  requesterName: string;
  requesterEmail: string;
  requesterUserId: string;
  status: Status;
  priority: Priority;
  assignee: string;
  category: string;
  dueAt?: Date;
  resolvedAt?: Date;
  activity: ActivityEntry[];
  createdByRole: Role;
  createdAt?: Date;
  updatedAt?: Date;
}
