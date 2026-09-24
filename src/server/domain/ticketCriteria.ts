import type { Priority, SlaFilter, Status } from '../../shared/ticket-constants';

// What a caller is asking for, in the domain's terms. The repository turns it
// into a database query, so nothing above it needs to know how tickets are stored.
export interface TicketCriteria {
  status?: Status | undefined;
  priority?: Priority | undefined;
  // Case-insensitive substring of the assignee's name.
  assignedTo?: string | undefined;
  sla?: SlaFilter | undefined;
  // Free text matched against ticket number, title, people and category.
  search?: string | undefined;
  // Set for requesters: they only see tickets raised under this address.
  requesterEmail?: string | undefined;
  // The instant SLA windows are measured from.
  now: Date;
}
