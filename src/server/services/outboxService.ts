import { agentEnabled, webhookConfig } from '../config';
import {
  MAX_ATTEMPTS,
  backoffMs,
  webhookBody,
  webhookFormat,
  withConsumers,
  type OutboxDraft,
} from '../domain/outbox';
import { NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { outboxDeliveries } from '../metrics';
import * as repository from '../repositories/outboxRepository';
import type { OutboxEventRecord, OutboxStatus } from '../repositories/outboxRepository';
import type { Tx } from '../repositories/transaction';

// Ticket events leave the system through an outbox: a change and the event that describes it
// are written in one transaction, and a separate delivery step sends events to the webhook
// afterwards. A failed or slow webhook can therefore never fail or slow a ticket change, and
// a committed change is never left without its event.

// Whether anything is listening: the webhook, the agent, or both.
export const outboxEnabled = (): boolean => webhookConfig() !== null || agentEnabled();

// Records events in the caller's transaction, one copy for each consumer that wants the event
// (see withConsumers). Does nothing when neither the webhook nor the agent is on, so a
// deployment that uses neither collects nothing.
export async function record(drafts: OutboxDraft[], tx: Tx, now: Date = new Date()): Promise<void> {
  const routed = withConsumers(drafts, {
    webhook: webhookConfig() !== null,
    agent: agentEnabled(),
  });
  await repository.enqueue(routed, tx, now);
}

// How long an event stays claimed while it is being sent. Longer than the request timeout,
// so a slow send is never picked up by a second worker; if a worker dies, the event is
// retried once this has passed.
const LOCK_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ERROR_LENGTH = 300;

export interface DeliveryResult {
  // False when no webhook is configured; nothing else happens in that case.
  configured: boolean;
  delivered: number;
  // Sent unsuccessfully and put back for another try.
  retried: number;
  // Sent unsuccessfully for the last time.
  dead: number;
}

export interface DeliveryOptions {
  now?: Date;
  // The most events to send in one call.
  limit?: number;
  // Stop taking new events after this long, so a call fits inside a serverless time limit.
  budgetMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// What is kept of a failure. The webhook URL is a credential (a Discord or Slack URL carries
// its own token), so it is never stored or logged, even if an error message contains it.
function describeFailure(error: unknown, url: string): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.split(url).join('[webhook]').slice(0, MAX_ERROR_LENGTH);
}

async function send(
  event: OutboxEventRecord,
  { url, format }: { url: string; format: string | undefined },
  { timeoutMs, fetchImpl }: Required<Pick<DeliveryOptions, 'timeoutMs' | 'fetchImpl'>>
): Promise<void> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(webhookBody(webhookFormat(url, format), event.type, event.payload)),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`The webhook answered HTTP ${response.status}.`);
}

// Sends due events, oldest first. Each one is claimed atomically, so several workers (or a
// worker and the scheduled job) can run at once without sending anything twice. A failure
// waits with exponential backoff, and after the last attempt the event is marked dead for an
// admin to look at.
export async function deliverPending(options: DeliveryOptions = {}): Promise<DeliveryResult> {
  const config = webhookConfig();
  const result: DeliveryResult = { configured: Boolean(config), delivered: 0, retried: 0, dead: 0 };
  if (!config) {
    logger.debug('No WEBHOOK_URL is set; there is nothing to deliver.');
    return result;
  }

  const {
    now = new Date(),
    limit = 25,
    budgetMs = 8_000,
    timeoutMs = REQUEST_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;
  const startedAt = Date.now();

  for (let sent = 0; sent < limit && Date.now() - startedAt < budgetMs; sent += 1) {
    const event = await repository.claimNext('webhook', now, LOCK_MS);
    if (!event) break;

    try {
      await send(event, config, { timeoutMs, fetchImpl });
      await repository.markDelivered(event._id, new Date());
      result.delivered += 1;
      outboxDeliveries.inc({ result: 'delivered' });
    } catch (error) {
      const reason = describeFailure(error, config.url);
      if (event.attempts >= MAX_ATTEMPTS) {
        await repository.markDead(event._id, reason);
        result.dead += 1;
        outboxDeliveries.inc({ result: 'dead' });
        logger.error(
          { eventId: String(event._id), type: event.type, reason },
          'Outbox event gave up'
        );
      } else {
        await repository.markForRetry(
          event._id,
          new Date(now.getTime() + backoffMs(event.attempts)),
          reason
        );
        result.retried += 1;
        outboxDeliveries.inc({ result: 'retried' });
        logger.warn(
          { eventId: String(event._id), attempts: event.attempts, reason },
          'Outbox delivery failed'
        );
      }
    }
  }
  return result;
}

// --- Admin -------------------------------------------------------------------------

export async function listEvents(status: OutboxStatus | undefined, page: number, limit: number) {
  const { events, total } = await repository.page({ status }, { skip: (page - 1) * limit, limit });
  return {
    events,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

// Puts a dead event back in the queue with a fresh set of attempts.
export async function retryEvent(id: string): Promise<OutboxEventRecord> {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw new ValidationError('Invalid event id.');
  const event = await repository.revive(id, new Date());
  if (!event) throw new NotFoundError('No dead event with that id.');
  return event;
}
