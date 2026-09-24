# Defect Log

Real defects found while reviewing and testing this project, with how each was found, why it happened and how it is now guarded. Every entry has a regression test that fails against the code without the fix. That was checked by running the new tests against the previous commit, or by reintroducing the bug.

Severity follows impact: **High** breaks a security boundary or core workflow, **Medium** gives wrong results or a wrong status code, **Low** is cosmetic or narrow.

| ID                                                                                    | Severity | Summary                                                        | Origin                                    |
| ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- | ----------------------------------------- |
| [DEF-001](#def-001-a-requester-could-move-their-ticket-into-another-users-queue)      | High     | Requester could reassign their own ticket to another requester | Original code                             |
| [DEF-002](#def-002-priority-sorting-was-alphabetical)                                 | Medium   | Sorting by priority was alphabetical                           | Original code                             |
| [DEF-003](#def-003-the-sla-filter-overwrote-the-status-filter)                        | Medium   | SLA filter overwrote the status filter                         | Original code                             |
| [DEF-004](#def-004-an-over-long-title-returned-500)                                   | Medium   | Over-long title returned 500 instead of 400                    | Original code                             |
| [DEF-005](#def-005-csv-export-allowed-spreadsheet-formula-injection)                  | Medium   | CSV export allowed spreadsheet formula injection               | Original code                             |
| [DEF-006](#def-006-resolvedat-was-reset-and-never-cleared)                            | Medium   | `resolvedAt` reset on every update and never cleared on reopen | Original code                             |
| [DEF-007](#def-007-the-sla-due-date-ignored-priority-changes)                         | Medium   | SLA due date ignored priority changes                          | Original code                             |
| [DEF-008](#def-008-page-order-was-not-deterministic)                                  | Low      | Page order not deterministic when tickets tie                  | Original code                             |
| [DEF-009](#def-009-search-fired-a-request-per-keystroke-and-could-show-stale-results) | Low      | Search request per keystroke; stale responses could win        | Original code                             |
| [DEF-010](#def-010-the-dashboard-stayed-empty-after-signing-in-against-the-real-api)  | High     | Dashboard empty after sign-in against the real API             | Introduced and caught during the refactor |
| [DEF-011](#def-011-401-and-403-responses-lacked-a-request-id)                         | Low      | 401/403 responses had no `requestId`                           | Introduced and caught during the upgrade  |
| [DEF-012](#def-012-input-validation-gaps)                                             | Low      | Malformed email and query-string objects accepted              | Original code                             |
| [DEF-013](#def-013-any-status-could-jump-to-any-other)                                | Medium   | Any status could jump to any other, including open to resolved | Original code                             |
| [DEF-014](#def-014-concurrent-edits-were-lost-and-the-activity-log-could-be-wrong)    | Medium   | Concurrent edits were lost; activity `from` could be stale     | Original code                             |
| [DEF-015](#def-015-serverless-deployments-signed-tokens-with-a-public-secret)         | High     | Serverless deployments signed tokens with a public secret      | Original code                             |

---

## DEF-001: A requester could move their ticket into another user's queue

- **Severity:** High (authorization)
- **Found by:** Code review, then confirmed with a failing integration test.
- **Reproduce:** Sign in as `user@demo.local`. `PATCH /api/tickets/:id` on your own ticket with `{"requesterEmail": "someone.else@example.com"}`.
- **Expected:** `403`; requesters may only edit descriptive fields.
- **Actual:** `200`. The ticket left the requester's own scope and appeared in another requester's queue.
- **Root cause:** `requesterName` and `requesterEmail` were in the list of fields a requester may edit, and requester scoping is based on `requesterEmail`.
- **Fix:** Requesters may edit only `title`, `description`, `priority` and `category`. The 403 message now names requester fields.
- **Regression test:** `a requester cannot reassign a ticket to another requester` (`tickets.integration.test.ts`).

## DEF-002: Priority sorting was alphabetical

- **Severity:** Medium
- **Found by:** Code review; confirmed by test.
- **Reproduce:** `GET /api/tickets?sortBy=priority&sortOrder=desc`.
- **Expected:** urgent, high, medium, low.
- **Actual:** urgent, medium, low, high (a plain string sort of the enum).
- **Root cause:** `priority` is stored as a string, and Mongo sorts strings alphabetically.
- **Fix:** Rank the priority by its position in the priority list at query time (`$indexOfArray`). This needs no data migration. See [ADR 001](adr/001-ticket-document-model.md).
- **Regression tests:** `sorts by priority severity, not alphabetically` and `paginates priority-sorted results too`.

## DEF-003: The SLA filter overwrote the status filter

- **Severity:** Medium
- **Found by:** Code review; confirmed by test.
- **Reproduce:** `GET /api/tickets?status=in-progress&sla=breached`.
- **Expected:** overdue tickets that are also in progress.
- **Actual:** every overdue unresolved ticket, regardless of status. `status=resolved&sla=breached` also returned unresolved tickets.
- **Root cause:** the SLA branch assigned `filter.status` unconditionally, replacing the user's status filter.
- **Fix:** combine them. An SLA filter on its own excludes resolved and closed tickets; with a status filter the status is kept, and a terminal status with an SLA filter correctly matches nothing.
- **Regression tests:** `an SLA filter combines with the status filter instead of overwriting it` and `a terminal status with an SLA filter matches nothing`.

## DEF-004: An over-long title returned 500

- **Severity:** Medium
- **Found by:** Running the integration suite against the previous commit.
- **Reproduce:** `POST /api/tickets` with a 121-character title.
- **Expected:** `400` naming the `title` field.
- **Actual:** `500 Internal Server Error`.
- **Root cause:** hand-written validation did not cover the model's length limits, and Mongoose's `ValidationError` fell through to the generic 500 branch.
- **Fix:** Zod schemas validate every field with the same limits as the model, and the error handler maps Mongoose validation, cast and duplicate-key errors to 400 and 409 with field details.
- **Regression tests:** `rejects an over-long title with a field-level 400`, plus the table of rejected inputs.

## DEF-005: CSV export allowed spreadsheet formula injection

- **Severity:** Medium (security)
- **Found by:** Code review.
- **Reproduce:** Create a ticket titled `=HYPERLINK("http://evil.example","click")`, then export as admin and open the file in a spreadsheet.
- **Expected:** the text is shown as text.
- **Actual:** the spreadsheet evaluates it as a formula. A requester controls the title an admin later exports.
- **Fix:** cells beginning with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an apostrophe (the OWASP recommendation).
- **Regression test:** `neutralises spreadsheet formulas in user-controlled text`.

## DEF-006: `resolvedAt` was reset and never cleared

- **Severity:** Medium
- **Found by:** Code review; confirmed by test.
- **Reproduce:** Resolve a ticket, then close it, then reopen it.
- **Expected:** `resolvedAt` keeps the first resolution time when the ticket is closed, and is cleared on reopen.
- **Actual:** it was overwritten on every update with a terminal status and stayed set after the ticket was reopened.
- **Fix:** set it on the transition into a terminal status, keep it while the ticket stays terminal, and `$unset` it on reopen.
- **Regression test:** `sets resolvedAt on resolution, keeps it on close, and clears it on reopen`.

## DEF-007: The SLA due date ignored priority changes

- **Severity:** Medium
- **Found by:** Code review; confirmed by test.
- **Reproduce:** Create a `low` ticket (72 hour SLA), then raise it to `urgent`.
- **Expected:** the due date becomes creation time plus 4 hours.
- **Actual:** the due date stayed at 72 hours, so an urgent ticket could not show as breached in time. Separately, `dueAt` differed from `createdAt` plus the SLA by a few milliseconds because the two were stamped at slightly different moments.
- **Fix:** recalculate on priority change unless an explicit `dueAt` is sent, and pin `createdAt` to the instant the SLA is measured from.
- **Regression tests:** `recalculates the SLA due date when priority changes`, `keeps an explicit due date instead of recalculating it`, `derives the SLA due date from priority`.

## DEF-008: Page order was not deterministic

- **Severity:** Low
- **Found by:** Running the integration suite against the previous commit.
- **Reproduce:** Sort by a column many tickets share (for example `status`) and page through the results.
- **Expected:** a stable order, so no ticket is repeated or skipped between pages.
- **Actual:** ties came back in whatever order the database produced, which is not guaranteed to be the same from one page request to the next.
- **Fix:** `_id` is added as a tie-breaker to every sort.
- **Regression test:** `pages through tickets that tie on the sort key in a stable order`. It uses mixed priorities so it only passes with an explicit tie-breaker; it was checked by removing the tie-breaker and watching the test fail.

## DEF-009: Search fired a request per keystroke and could show stale results

- **Severity:** Low
- **Found by:** Code review of the 800-line `App` component.
- **Reproduce:** Type `vpn` quickly on a slow connection.
- **Expected:** one request for `vpn`, and the results of the latest request always win.
- **Actual:** three requests, and a slow response for `v` could arrive after the response for `vpn` and replace it.
- **Fix:** debounce the search, and abort superseded requests with `AbortController`. Responses that resolve just before being aborted are ignored as well.
- **Regression tests:** `sends one request for a burst of typing, not one per keystroke`, `ignores a slow response that a newer request has replaced`.
- **Note:** the first version of this fix did not work. It still sent a request per keystroke because the effect depended on object identity, not value. The unit test above caught it.

## DEF-010: The dashboard stayed empty after signing in against the real API

- **Severity:** High. It was never released: it was introduced in the frontend refactor and caught before merging.
- **Found by:** the real-stack smoke test (`LIVE-TICKET-001`). The server log showed no ticket requests after `POST /auth/login`.
- **Reproduce:** sign in with any account against the real API. The dashboard rendered, but tickets and stats never loaded; reloading the page fixed it.
- **Root cause:** the refactored client identified the user by `user.sub`. `POST /auth/login` returns the user as `id`; only `/auth/me` returns `sub`, so the value was `undefined` right after signing in and no request was ever started.
- **Why the tests missed it:** the Playwright mock and the Vitest fixtures both returned `sub` from sign-in. All 66 mocked browser executions and 88 unit tests passed. Two live smoke tests passed too, because a dashboard that never loads has zero rows, and zero rows satisfy "shows only my tickets".
- **Fix:** `useAuth` normalizes both shapes into one user at the boundary.
- **Regression tests and safeguards:** a unit test for the two shapes; fixtures and the Playwright mock now use the real response shapes, which makes the unit tests fail on the old code; the live smoke tests now assert that data loaded. The check was to reintroduce the bug and confirm three live tests fail. See [ADR 002](adr/002-layered-test-strategy.md).

## DEF-011: 401 and 403 responses lacked a request id

- **Severity:** Low
- **Found by:** the OpenAPI contract test.
- **Reproduce:** `GET /api/tickets` without a token.
- **Expected:** the error body includes `requestId`, as documented.
- **Actual:** the header was present but the body had none, because auth failures were written inline and skipped the shared error handler.
- **Fix:** auth failures go through `next(error)` like every other error.
- **Regression test:** `errors share one documented shape and always carry a request id`.

## DEF-012: Input validation gaps

- **Severity:** Low
- **Found by:** Running the integration suite against the previous commit.
- **Actual:** a malformed requester email was accepted (`201`), and query-string objects such as `?search[$ne]=x` were accepted and stringified instead of rejected.
- **Fix:** the Zod schemas reject both with a `400` and a specific message.
- **Regression tests:** `rejects a malformed requester email` and `rejects the list query search[$ne]=x`.

## DEF-013: Any status could jump to any other

- **Severity:** Medium
- **Found by:** Code review against the documented workflow (`open -> assigned -> in-progress -> resolved -> closed`).
- **Reproduce:** `PATCH /api/tickets/:id` with `{"status": "resolved"}` on an `open`, unassigned ticket, or `{"status": "open"}` on a `closed` one.
- **Expected:** a `409` for a move the workflow does not allow, and reopening a closed ticket limited to admins.
- **Actual:** `200`. Tickets could be resolved without ever being worked, and closed tickets reopened by anyone.
- **Root cause:** the API validated that the status was one of the five values, never that the move from the current status was allowed.
- **Fix:** an explicit transition table in `src/shared/ticket-constants.json` (now `.ts`), enforced by `src/server/domain/ticketWorkflow.ts`. The status menu offers only the allowed moves. Reopening now also logs `ticket_reopened`, and re-sending the current status no longer logs a second `ticket_resolved`.
- **Regression tests:** a table-driven unit test over all 25 status pairs for technicians and admins (the expected table is written out by hand, not read from the file under test), plus integration tests for the `409`, the admin-only reopen and the activity entries.

## DEF-014: Concurrent edits were lost and the activity log could be wrong

- **Severity:** Medium
- **Found by:** Code review of `updateTicket`, which read the ticket and then wrote it in a separate call.
- **Reproduce:** two clients edit the same ticket at once, for example one sets the priority while another sets the assignee. Both read the same ticket.
- **Expected:** the second edit is refused or applied on top of the first, and each activity entry records the value that was actually replaced.
- **Actual:** both writes succeeded and the `from` value in the activity entries came from the copy read before the other write, so the history could show a change that never happened in that order.
- **Root cause:** read-then-write with no guard between the two.
- **Fix:** tickets carry a version (`__v`). Every update is one atomic `findOneAndUpdate` filtered on the version it was computed from. `If-Match` lets a client refuse an edit made against a version it has not seen (`409`); without it a lost race is recomputed against the fresh ticket, up to three times.
- **Regression tests:** two concurrent edits from the same version give exactly one `200` and one `409` and one activity entry; three concurrent edits without `If-Match` all succeed and the recorded `from`/`to` values chain correctly.
- **Note:** the first client implementation cleared the "this ticket changed" message when the list reloaded after the `409`. The mocked browser test caught it, and a unit test now pins the order.

## DEF-015: Serverless deployments signed tokens with a public secret

- **Severity:** High (authentication)
- **Found by:** Code review of `getAuthSecret()`.
- **Reproduce:** deploy to a serverless platform without `AUTH_SECRET`. Build a token for any user with the development secret, which is in this repository, and call the API with it.
- **Expected:** the deployment refuses to authenticate.
- **Actual:** `server.ts` refused to boot without a secret, but serverless entry points logged a warning and used the public development secret, so anyone could mint an admin token.
- **Root cause:** the boot-time check does not run on serverless entry points, and the fallback was kept so the demo would not go offline.
- **Fix:** in production, signing or verifying a token with a missing or sub-32-character secret returns `503 Server authentication is not configured.` The rest of the API stays up, and `/api/ready` reports `authConfigured` so a deployment can be checked without signing in. The live smoke test asserts it.
- **Regression tests:** a token forged with the development secret is not accepted in production; sign-in returns `503` instead of issuing a token; unset, short and valid secrets in production and development.
