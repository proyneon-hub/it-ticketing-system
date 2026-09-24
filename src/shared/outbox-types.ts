import type { CommentVisibility, OutboxEventType } from './ticket-constants';

// What is sent about a ticket when something happens to it. Deliberately small and free of
// long text a person typed (no descriptions, no comment bodies), because it leaves the system. The title is the one typed field included; the message writer neutralises anything in it that could ping a channel.
export interface OutboxPayload {
  ticket: {
    id: string;
    number: string;
    title: string;
    status: string;
    priority: string;
    assignee: string;
  };
  // Null for an event raised by an automated job rather than a person.
  actor: { name: string; role: string } | null;
  change?: { from?: string; to?: string };
  visibility?: CommentVisibility;
}

export interface OutboxDraft {
  type: OutboxEventType;
  payload: OutboxPayload;
}
