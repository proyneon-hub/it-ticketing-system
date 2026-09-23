# ADR 001: Store tickets as documents with embedded activity history

Status: accepted

## Context

A ticket is nearly always read together with its timeline: the queue shows the ticket, and opening it shows who changed what. The activity history is append-only, and a single ticket accumulates a handful of entries, not thousands. Ticket numbers (`TKT-0001`) must be unique and human-friendly, and the busiest queries filter and sort tickets by status, priority and due date.

## Decision

- One `tickets` collection. Activity entries are an embedded array on the ticket.
- Every change appends its activity entry with `$push` **in the same update** as the field change, so the history cannot disagree with the ticket's state and no multi-document transaction is needed.
- Ticket numbers come from a `counters` document incremented with an atomic `$inc`, which stays unique and gap-free when tickets are created concurrently (covered by an integration test that creates five at once).
- One compound index on `status, priority, dueAt, createdAt` serves the dashboard filters. `_id` is added as a tie-breaker to every sort so pages are stable.
- Sorting by priority ranks the enum with `$indexOfArray` at query time instead of storing a numeric rank. That avoids a data migration on the existing demo database.

## Consequences

- Reading a ticket with its full timeline is one read, and history and state change atomically.
- Activity arrays grow with every change. That is acceptable at service-desk volumes; if audit reporting across tickets becomes a requirement, activity should move to its own collection.
- Cross-ticket questions such as "everything this technician touched last week" need a scan or a separate collection. A relational model would answer them more naturally.
- Query-time priority ranking costs an aggregation pipeline for that one sort. It is fine at this scale; a stored rank plus an index would be the next step if it ever is not.

## Alternatives considered

- **Relational schema (tickets and activity tables).** Better for reporting and joins, and a reasonable choice for a production system. MongoDB was chosen at the start for the MERN stack and fast iteration, and the access pattern above fits a document well. This decision should be revisited if reporting needs grow.
- **Separate activity collection now.** More flexible, but every update would need two writes without a transaction, which reopens the risk of history and state disagreeing.
