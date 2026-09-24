# Test Plan

## Project overview

The IT Ticketing System is a full-stack service desk with role-based access, ticket lifecycle management, SLA tracking and demo authentication. This plan defines what is tested, at which layer, and how to run it. The strategy and its rationale are in [ADR 002](adr/002-layered-test-strategy.md); the suites and diagrams are in [QA_ARCHITECTURE.md](QA_ARCHITECTURE.md).

## Scope

In scope:

- Demo sign-in for the admin, technician and requester roles
- Role-based ticket visibility and permissions
- Ticket creation, update, delete, filtering, sorting, pagination, export and SLA display
- Protected API behaviour, validation and error handling
- Dashboard stats and seeded demo data
- Operability: health and readiness probes, request ids, the Docker image
- Accessibility of the main screens
- Build, lint and CI checks

Out of scope for the demo:

- Real password reset flows
- Persistent user administration
- Email or notification delivery
- A production identity provider

## Test environments

| Environment                                              | Used for                                          |
| -------------------------------------------------------- | ------------------------------------------------- |
| Node.js 24 (supported range 22 through 26)               | All local and CI runs                             |
| In-memory MongoDB (`mongodb-memory-server`)              | API integration and contract tests                |
| Vite dev server with mocked API responses                | Mocked browser regression and accessibility tests |
| Docker Compose stack (production image and real MongoDB) | Real-stack smoke tests, in CI and locally         |
| A deployed demo                                          | Post-deploy smoke tests, run manually             |
| Chromium, Firefox, WebKit                                | Mocked browser regression and Axe                 |

## User roles

| Role       | Purpose            | Expected access                                    |
| ---------- | ------------------ | -------------------------------------------------- |
| Admin      | Service desk owner | Full ticket queue, update workflow, delete tickets |
| Technician | Support analyst    | Full ticket queue, update workflow and assignment  |
| User       | Requester          | Create and view only their own tickets             |

## Automated coverage map

| Requirement                                                              | Where it is tested                                                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sessions: sign-in, refresh rotation and reuse, sign-out                  | `auth.integration.test.ts`, `accessToken.test.ts`, `password.test.ts`, `tests/smoke-live/session.spec.ts`, `tests/e2e-mocked/auth.spec.ts`                                     |
| Admin user management, last-admin guard, audit log                       | `auth.integration.test.ts`, `tests/smoke-live/session.spec.ts` (LIVE-ADMIN-001)                                                                                                |
| Sign-in, token expiry and tampered tokens                                | `auth.test.ts`, `security.test.ts`, `tests/e2e-mocked/auth.spec.ts`, `tests/smoke-live/login.spec.ts`                                                                          |
| Role permissions and requester scoping                                   | `tickets.integration.test.ts` (real database), `tests/e2e-mocked/role-permissions.spec.ts`, `tests/smoke-live/requester-scope.spec.ts`                                         |
| Status workflow, versioned edits, error codes                            | `ticketWorkflow.test.ts` (all 25 status pairs), `tickets.integration.test.ts`, `tests/smoke-live/workflow.spec.ts`                                                             |
| Domain rules: SLA, activity, permissions, CSV                            | `sla.test.ts`, `activity.test.ts`, `permissions.test.ts`, `csv.test.ts` (no database)                                                                                          |
| Layer boundaries (routes, services, domain)                              | `architecture.test.ts`                                                                                                                                                         |
| Ticket lifecycle and activity history                                    | `tickets.integration.test.ts`, `tests/e2e-mocked/ticket-lifecycle.spec.ts`, `tests/smoke-live/ticket-lifecycle.spec.ts`                                                        |
| SLA due dates, breached and due-soon filters, stats                      | `tickets.integration.test.ts`, `TicketRow.test.tsx`, `format.test.ts`                                                                                                          |
| Filters, sorting and pagination                                          | `tickets.integration.test.ts`, `useTicketFilters.test.tsx`, `App.test.tsx`, `tests/e2e-mocked/filters-export.spec.ts`                                                          |
| Full-text search, ranking and index use (`explain()`)                    | `tickets.integration.test.ts` (search)                                                                                                                                         |
| CSV export: formulas, streaming, no row cap                              | `tickets.integration.test.ts`, `tests/e2e-mocked/filters-export.spec.ts`                                                                                                       |
| Input validation and error responses                                     | `tickets.integration.test.ts`, `security.test.ts`, `openapi.contract.test.ts`                                                                                                  |
| API contract and documentation                                           | `openapi.contract.test.ts`, `tests/smoke-live/docs.spec.ts`                                                                                                                    |
| Loading, empty and error states, request-id reference                    | `App.test.tsx`, `SmallComponents.test.tsx`, `tests/e2e-mocked/error-handling.spec.ts`                                                                                          |
| Search debounce and stale-response handling                              | `App.test.tsx`, `useDebouncedValue.test.ts`                                                                                                                                    |
| Session restore and expiry                                               | `AuthContext.test.tsx`, `api.test.ts`, `App.test.tsx`, `tests/smoke-live/session.spec.ts`                                                                                      |
| Security headers, CORS, rate limiting, startup config                    | `security.test.ts`                                                                                                                                                             |
| Health, readiness and request tracing                                    | `tickets.integration.test.ts`, `security.test.ts`, `tests/smoke-live/readiness.spec.ts`, Support-Ops `test_health_check.py`                                                    |
| Routing, deep links and route guards                                     | `App.test.tsx`, `pages.test.tsx`, `tests/e2e-mocked/routing.spec.ts`, `tests/smoke-live/session.spec.ts`                                                                       |
| Optimistic edits and rollback on a conflict                              | `tickets.test.tsx`, `App.test.tsx`, `tests/e2e-mocked/ticket-lifecycle.spec.ts` (TICKET-008)                                                                                   |
| Admin users and audit log pages                                          | `pages.test.tsx`, `tests/e2e-mocked/routing.spec.ts`, `tests/accessibility/detail-and-admin.a11y.spec.ts`                                                                      |
| Comments and internal notes: a requester never receives one              | `comments.integration.test.ts` (every endpoint), `comments.test.ts`, `CommentThread.test.tsx`, `tests/e2e-mocked/comments.spec.ts`, `tests/smoke-live/comments-trends.spec.ts` |
| Trends: per-day counts, time zones, mean time to resolve, SLA compliance | `trends.test.ts` (windows, DST), `trends.integration.test.ts` (hand-computed, fixed clock), `TrendChart.test.tsx`, `tests/e2e-mocked/trends.spec.ts`                           |
| Accessibility                                                            | `tests/accessibility/` and the manual checklist in [ACCESSIBILITY_TESTING.md](ACCESSIBILITY_TESTING.md)                                                                        |
| Production image and the whole stack                                     | The real-stack job in `.github/workflows/e2e.yml`                                                                                                                              |

## Manual smoke tests

Run these after significant changes, or to demonstrate the app.

| ID     | Area            | Test case                                                           |
| ------ | --------------- | ------------------------------------------------------------------- |
| TC-001 | Sign-in         | Admin can sign in                                                   |
| TC-002 | Sign-in         | Technician can sign in                                              |
| TC-003 | Sign-in         | Requester can sign in                                               |
| TC-004 | Ticket creation | Requester can create a ticket                                       |
| TC-005 | Role access     | Requester sees only their own tickets                               |
| TC-006 | Role access     | Technician sees the full ticket queue                               |
| TC-007 | Role access     | Requester cannot delete tickets                                     |
| TC-008 | Role access     | Technician cannot delete tickets                                    |
| TC-009 | Admin           | Admin can delete a ticket                                           |
| TC-010 | Workflow        | A ticket can move from open to assigned                             |
| TC-011 | Workflow        | A ticket can move to in-progress                                    |
| TC-012 | Workflow        | A ticket can move to resolved                                       |
| TC-013 | SLA             | The dashboard shows breached and due-soon tickets                   |
| TC-014 | API             | Protected routes reject unauthenticated requests                    |
| TC-015 | API             | An invalid ticket payload returns a validation error                |
| TC-016 | Operations      | An error in the UI shows a reference that appears in the server log |
| TC-017 | Docs            | `/api/docs` loads and **Try it out** works with a signed-in token   |

## Edge cases and where they are covered

| Edge case                                       | Covered by                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| Database unavailable                            | `security.test.ts` (503 with guidance; readiness reports `down`)          |
| Expired or malformed bearer token               | `auth.test.ts`, `security.test.ts`, `api.test.ts`, `AuthContext.test.tsx` |
| Empty search result                             | `tests/e2e-mocked/filters-export.spec.ts`, `App.test.tsx`                 |
| Assigned status with no assignee                | `tickets.integration.test.ts`                                             |
| Resolved or closed tickets with an overdue date | `tickets.integration.test.ts` (excluded from breached), `format.test.ts`  |
| Reopening a resolved ticket                     | `tickets.integration.test.ts` (`resolvedAt` cleared)                      |
| Concurrent ticket creation                      | `tickets.integration.test.ts` (unique, gap-free numbers)                  |
| Tickets that tie on the sort key                | `tickets.integration.test.ts` (stable pages)                              |
| Regex characters and search operators in search | `tickets.integration.test.ts`                                             |
| Long text near the model limits                 | `tickets.integration.test.ts` (title over 120 characters rejected)        |
| Slow responses arriving out of order            | `App.test.tsx`, `tickets.test.tsx`                                        |

Defects found by this plan are recorded in [DEFECT_LOG.md](DEFECT_LOG.md).

## Acceptance criteria

- `npm run format:check`, `npm run lint` and `npm run typecheck:playwright` pass.
- `npm run test:coverage` passes with the coverage thresholds met.
- `npm run test:e2e` and `npm run test:a11y` pass in all three browsers.
- `npm run build` passes.
- The real-stack smoke suite passes against the Docker Compose stack.
- Admin, technician and requester workflows work end to end.
- No role can read or change data outside its permission boundary.
