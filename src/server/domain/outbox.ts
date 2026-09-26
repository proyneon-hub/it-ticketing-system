import type { TokenPayload } from '../auth';
import {
  agentEventTypes,
  type CommentVisibility,
  type OutboxEventType,
} from '../../shared/ticket-constants';
import type { OutboxDraft, OutboxPayload } from '../../shared/outbox-types';
import type { TicketAttrs } from '../../shared/ticket-types';

// What leaves the system when something happens to a ticket, and how it is retried and
// worded. Pure: no database and no network here. The outbox worker (services/outboxService.ts)
// does the sending.

export type { OutboxDraft, OutboxEventType, OutboxPayload };

type TicketFacts = Pick<
  TicketAttrs,
  'ticketNumber' | 'title' | 'status' | 'priority' | 'assignee'
> & { _id: unknown };

const snapshot = (ticket: TicketFacts): OutboxPayload['ticket'] => ({
  id: String(ticket._id),
  number: ticket.ticketNumber ?? '',
  title: ticket.title,
  status: ticket.status,
  priority: ticket.priority,
  assignee: ticket.assignee,
});

const actorOf = (user: TokenPayload): OutboxPayload['actor'] => ({
  name: user.name,
  role: user.role,
});

export const createdEvent = (ticket: TicketFacts, user: TokenPayload): OutboxDraft => ({
  type: 'ticket.created',
  payload: { ticket: snapshot(ticket), actor: actorOf(user) },
});

// The events an edit produces, by comparing the ticket before and after it. Moving a
// ticket to "Unassigned" is not an assignment, so it produces none.
export function patchEvents(
  before: Pick<TicketAttrs, 'status' | 'assignee'>,
  after: TicketFacts,
  user: TokenPayload
): OutboxDraft[] {
  const events: OutboxDraft[] = [];

  if (before.status !== after.status) {
    events.push({
      type: 'ticket.status_changed',
      payload: {
        ticket: snapshot(after),
        actor: actorOf(user),
        change: { from: before.status, to: after.status },
      },
    });
  }
  if (before.assignee !== after.assignee && after.assignee !== 'Unassigned') {
    events.push({
      type: 'ticket.assigned',
      payload: {
        ticket: snapshot(after),
        actor: actorOf(user),
        change: { from: before.assignee, to: after.assignee },
      },
    });
  }
  return events;
}

// A comment is reported without its text: the webhook goes to a chat channel, and an
// internal note must not be readable there by people who may not read it in the app.
export const commentEvent = (
  ticket: TicketFacts,
  user: TokenPayload,
  visibility: CommentVisibility
): OutboxDraft => ({
  type: 'ticket.comment_added',
  payload: { ticket: snapshot(ticket), actor: actorOf(user), visibility },
});

// Raised by the SLA job, so there is no person behind it.
export const slaEvent = (
  kind: 'at_risk' | 'breached',
  ticket: TicketFacts,
  change?: { from: string; to: string }
): OutboxDraft => ({
  type: kind === 'breached' ? 'ticket.sla_breached' : 'ticket.sla_at_risk',
  payload: { ticket: snapshot(ticket), actor: null, ...(change ? { change } : {}) },
});

// --- Routing ----------------------------------------------------------------------

// Gives each event to the consumers that want it. The webhook takes every event when it is
// configured; the agent takes only the events it acts on, when it is enabled. An event two
// consumers want is written twice, one copy each, so they claim, retry and finish
// independently: a failing webhook cannot hold up the agent, and the reverse.
export function withConsumers(
  drafts: OutboxDraft[],
  enabled: { webhook: boolean; agent: boolean }
): OutboxDraft[] {
  return drafts.flatMap((draft): OutboxDraft[] => [
    ...(enabled.webhook ? [{ ...draft, consumer: 'webhook' as const }] : []),
    ...(enabled.agent && (agentEventTypes as readonly string[]).includes(draft.type)
      ? [{ ...draft, consumer: 'agent' as const }]
      : []),
  ]);
}

// --- Retrying ---------------------------------------------------------------------

// Six tries in all: the first, then five retries after roughly 30 s, 1 min, 2 min, 4 min and 8 min.
export const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60 * 1000;
const JITTER = 0.2;

// How long to wait after `attempt` failed attempts: doubling each time up to an hour, and
// spread by up to 20% either way so many events that failed together do not all retry
// together. `random` (0 to 1) is a parameter so the result can be checked.
export function backoffMs(attempt: number, random: number = Math.random()): number {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  const spread = 1 + (random * 2 - 1) * JITTER;
  return Math.round(base * spread);
}

// --- Wording ----------------------------------------------------------------------

export type WebhookFormat = 'discord' | 'slack' | 'json';

// The receiving service decides the shape of the body. A hostname that is not recognised
// gets plain JSON (the text and the raw event), which works with generic receivers.
export function webhookFormat(url: string, override?: string): WebhookFormat {
  if (override === 'discord' || override === 'slack' || override === 'json') return override;
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)discord(app)?\.com$/.test(host)) return 'discord';
    if (/(^|\.)slack\.com$/.test(host)) return 'slack';
  } catch {
    // Not a URL; the caller rejects that before getting here.
  }
  return 'json';
}

// One line a person can read in a chat channel.
export function describeEvent(type: OutboxEventType, payload: OutboxPayload): string {
  const { number, title, priority, assignee } = payload.ticket;
  const label = `${number || 'Ticket'} "${title}"`;
  const by = payload.actor ? ` by ${payload.actor.name}` : '';

  switch (type) {
    case 'ticket.created':
      return `New ${priority} ticket ${label}${by}.`;
    case 'ticket.status_changed':
      return `${label} moved from ${payload.change?.from} to ${payload.change?.to}${by}.`;
    case 'ticket.assigned':
      return `${label} assigned to ${assignee}${by}.`;
    case 'ticket.comment_added':
      return payload.visibility === 'internal'
        ? `Internal note added to ${label}${by}.`
        : `New comment on ${label}${by}.`;
    case 'ticket.sla_at_risk':
      return `SLA at risk: ${label} (${priority}, ${assignee}) is due within 24 hours.`;
    case 'ticket.sla_breached':
      return payload.change
        ? `SLA breached: ${label} is overdue and was raised from ${payload.change.from} to ${payload.change.to}.`
        : `SLA breached: ${label} is overdue.`;
  }
}

// Slack reads <...> in a message as a command (<!channel> pings everyone), so anything a
// person typed into a title has its angle brackets and ampersands escaped.
const escapeForSlack = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The body to POST. Ticket titles are typed by requesters, so the message is written so that
// a title such as "@everyone" or "<!channel>" cannot ping a whole channel.
export function webhookBody(
  format: WebhookFormat,
  type: OutboxEventType,
  payload: OutboxPayload
): unknown {
  const text = describeEvent(type, payload);
  // An empty parse list tells Discord not to turn any @mention in the text into a notification.
  if (format === 'discord') return { content: text, allowed_mentions: { parse: [] } };
  if (format === 'slack') return { text: escapeForSlack(text) };
  return { text, type, payload };
}
