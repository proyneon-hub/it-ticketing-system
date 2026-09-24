# ADR 005: An explicit status workflow, and optimistic concurrency on edits

Status: accepted

## Context

Any status could jump to any other, so a ticket could go from `open` straight to `closed`, and a closed one could be moved back by anyone (DEF-013). Separately, an edit read the ticket, computed a change and wrote it back, so two people editing at once silently overwrote each other, and the `from` value in the activity history could describe a state that no longer existed (DEF-014).

## Decision

**The workflow is a table, in one place.** `src/shared/ticket-constants.ts` lists the moves each status allows (`open` to `assigned`, `in-progress` or `closed`; `assigned` to `in-progress` or `open`; `in-progress` to `resolved` or `assigned`; `resolved` to `closed` or `in-progress`; `closed` back to `in-progress`, admin only). The API enforces it in a pure domain function, an illegal move is a `409` with code `INVALID_TRANSITION`, and the status menu in the UI is built from the same table, so the two cannot disagree. Setting a status to its current value is allowed and does nothing. `assigned` and `in-progress` need an assignee. Reopening clears `resolvedAt`.

**Edits are optimistic and atomic.** Every ticket carries Mongoose's version number, `__v`. The client sends the version it loaded as `If-Match`; the API answers `409 VERSION_CONFLICT` if it is not current, and returns the new version in an `ETag`. The write itself is one `findOneAndUpdate` whose filter includes the version and which increments it, so a change and the history entries computed from a ticket are only ever applied to exactly that version. A caller that sends no `If-Match` gets up to three automatic retries against the fresh ticket rather than an error, because it never claimed to have seen a particular version.

**Machine writes take part too.** The SLA job bumps the version when it raises a priority, and a comment does not (it appends history only), so a comment never makes someone else's edit fail.

## Consequences

- A stale edit is refused with a message and nothing is written. In the UI a refused status or priority change rolls back the row and shows why.
- History is trustworthy: each `from` is the value that was actually replaced.
- Adding a status means editing one table, then the tests that walk all 25 status pairs.
- A person who edits a ticket for a long time can be refused and has to reload; that is the point, but it is friction.

## Alternatives considered

- **Last write wins.** What it did before; loses data silently.
- **Locks on the ticket.** They need a timeout and a way to release them, and they punish the many for the few.
- **A transaction around every edit.** It would work, but a single guarded write is cheaper and needs no replica set for this path.
- **Per-field merging.** Friendlier, but a status change and an assignment interact (the assignee rule), so merging fields independently could produce a state the workflow forbids.
