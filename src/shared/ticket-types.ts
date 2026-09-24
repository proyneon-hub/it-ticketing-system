import type { CommentVisibility, Priority, Role, Status } from './ticket-constants';

// One entry in a ticket's history. Written by the service on every change.
export interface ActivityEntry {
  action: string;
  actorName?: string | undefined;
  // 'system' for changes made by an automated job rather than a person.
  actorRole?: Role | 'system' | undefined;
  actorEmail?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  detail?: string | undefined;
  // True for entries about an internal note: staff see them, requesters do not.
  internal?: boolean | undefined;
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
  // Set once by the SLA escalation job, so running it again changes nothing.
  slaAtRiskAt?: Date;
  slaBreachedAt?: Date;
  activity: ActivityEntry[];
  createdByRole: Role;
  createdAt?: Date;
  updatedAt?: Date;
}

// A ticket as the API sends it: dates arrive as ISO strings, and Mongoose adds the
// id and the version (`__v`), which clients send back as If-Match.
export interface Ticket extends Omit<
  TicketAttrs,
  'dueAt' | 'resolvedAt' | 'slaAtRiskAt' | 'slaBreachedAt' | 'createdAt' | 'updatedAt' | 'activity'
> {
  _id: string;
  __v: number;
  dueAt: string;
  resolvedAt?: string;
  slaAtRiskAt?: string;
  slaBreachedAt?: string;
  createdAt: string;
  updatedAt: string;
  activity: (Omit<ActivityEntry, 'createdAt'> & { createdAt?: string })[];
}

// A comment on a ticket, as the API sends it.
export interface Comment {
  _id: string;
  ticketId: string;
  body: string;
  visibility: CommentVisibility;
  author: { id: string; name: string; email: string; role: Role };
  createdAt: string;
}

// What the trends endpoint returns: the numbers behind the trends chart.
export interface Trends {
  days: number;
  timeZone: string;
  series: { date: string; opened: number; resolved: number }[];
  resolution: {
    resolved: number;
    // Mean time to resolve, in hours to one decimal place. Null when nothing was resolved.
    meanHours: number | null;
  };
  sla: {
    resolved: number;
    met: number;
    // Share of resolved tickets that met their deadline, one decimal place. Null when nothing was resolved.
    compliancePercent: number | null;
  };
}
