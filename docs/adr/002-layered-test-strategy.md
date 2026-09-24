# ADR 002: Layered test strategy

Status: accepted

## Context

The first version tested the API with Jest and Supertest against a fully mocked Mongoose model, and the browser with Playwright against mocked API responses. Both suites were fast and green, and neither one exercised query logic, role scoping in the database, or the real request path from browser to database.

## Decision

Test at several layers, and let each one catch what the layer below cannot.

| Layer              | Tooling                                     | What it proves                                                                                  |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Unit and component | Vitest, Testing Library                     | Pure logic, hooks and components, including race conditions such as stale search responses      |
| API integration    | Vitest, Supertest, in-memory MongoDB        | Query building, role scoping, SLA logic, pagination and persistence against a real database     |
| Contract           | Vitest, Ajv, OpenAPI                        | Every real response matches the published schema, and the docs cannot drift from the code       |
| Browser regression | Playwright, Axe (Chromium, Firefox, WebKit) | User workflows and accessibility, with controlled API responses so it is fast and deterministic |
| Real-stack smoke   | Playwright against Docker Compose           | The production image, a real MongoDB and a real browser working together                        |
| Post-deploy smoke  | Same suite, run manually                    | The deployed environment, guarded by an enable flag and cleaned-up test data                    |

Rules that keep the layers honest:

- **Mocks mirror the real API.** Fixtures use the response shapes from the OpenAPI document.
- **A smoke test asserts that data loaded, not only that the page rendered.** An empty dashboard must not satisfy "shows only my tickets".
- **Coverage thresholds act as a ratchet**, enforced in CI for the API and the frontend.
- **A new regression test must fail against the old code.** Where practical this was checked by running the new tests on the previous commit, or by reintroducing the bug.

## Evidence that it works

Each layer earned its place during the upgrade that introduced it:

- **Integration tests** run against the previous commit failed 16 of 44 tests, exposing real defects the old mocked API tests could not see: alphabetical priority sorting, an SLA filter that overwrote the status filter, a requester being able to reassign their own ticket to another queue, and a 500 for an over-long title.
- **The contract test** found that 401 and 403 responses were written inline and bypassed the error handler, so they lacked the `requestId` the spec promised.
- **The real-stack smoke test** found a regression that all 66 mocked browser executions and 88 unit tests had passed: sign-in returns the user as `id` while `/auth/me` returns `sub`, and the client read only `sub`, so the dashboard stayed empty after every sign-in. The mocks had returned `sub` for both.
- **A hook unit test** found that the "debounced" search still sent a request per keystroke.

## Consequences

- The real-stack job adds several minutes to CI, and needs Docker.
- Fixtures must be kept faithful to the API. The contract test and the OpenAPI document are what make that checkable.
- More suites means more to maintain, so each one is small and focused, and the README states which layer to run for which question.
