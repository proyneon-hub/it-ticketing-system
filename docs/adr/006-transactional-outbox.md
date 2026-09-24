# ADR 006: A transactional outbox for notifications, on a replica set

Status: accepted

## Context

The service should tell people about new tickets, assignments, status changes, comments and SLA risk by posting to a chat webhook. Doing that inside the request has two bad outcomes: a slow or failing webhook slows or fails the ticket change, and a crash between "saved the ticket" and "sent the message" loses the message. The reverse is also possible: announcing a change that then fails to save.

## Decision

- **Write the event with the change.** A ticket create or edit, a comment, and an SLA step each write an `OutboxEvent` in the same MongoDB transaction as the change. The event exists if and only if the change committed. Tests force the event write to fail and check that the ticket, the edit and the comment are all rolled back, and that an edit refused with a `409` leaves no event.
- **Send it afterwards.** A delivery step claims events one at a time with an atomic `findOneAndUpdate` (so any number of workers can run without sending an event twice), posts to `WEBHOOK_URL` with a five-second timeout, and marks the event delivered. A failure is retried with exponential backoff and jitter (about 30 seconds, then 1, 2, 4 and 8 minutes). After the sixth attempt the event is `dead`, and an admin can list dead events and retry them. A worker that dies mid-send is recovered when its lock expires.
- **Where it runs.** The same delivery function is called by `POST /api/jobs/outbox-delivery` (from a GitHub Actions timer, because Vercel's free plan only runs a cron once a day) and by a Compose `worker` container on an interval. The SLA escalation job runs alongside it.
- **A replica set everywhere.** Transactions need one. Atlas is one already; Compose runs `mongod --replSet` with a health check that initiates it; local development and the tests use a one-node in-memory replica set.
- **Off unless configured.** With no `WEBHOOK_URL` no event is recorded, so a deployment that does not want notifications collects nothing.
- **Nothing that leaves the system contains a comment or a description.** Events carry ticket number, title, status, priority, assignee and who acted; a comment event says only whether it was internal. Titles are typed by requesters, so the message also stops `@everyone` and `<!channel>` from notifying a channel.

## Consequences

- Delivery is at least once: an event can be sent twice if the webhook accepted it but the worker died before recording that. Receivers should tolerate a duplicate.
- Notifications are delayed by up to the job interval (30 minutes in the scheduled workflow, 30 seconds in the container worker), not instant.
- Ticket writes now cost a transaction. Creating a ticket went from about 9 to 16 ms at the median in the load test.
- Delivered events are kept for 14 days (a TTL index) and dead ones until an admin acts; the backlog by status is exported as a metric.
- A standalone MongoDB no longer works for this application.

## Alternatives considered

- **Call the webhook inside the request.** Simple, and wrong in the two ways above.
- **Change streams.** Would avoid the outbox collection, but they also need a replica set, need a long-running consumer (not available on serverless), and lose an event if the consumer is down longer than the oplog window.
- **A message broker.** The right tool at larger scale; a second piece of infrastructure to run for a service this size.
