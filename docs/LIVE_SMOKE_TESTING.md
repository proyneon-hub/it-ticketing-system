# Live Smoke Testing

## Purpose

The live smoke suite checks the real frontend, API, authentication, and database integration without installing mocked API routes. It is separate from the deterministic mocked regression suite in `tests/e2e-mocked`.

## Safety Controls

- The suite skips unless `LIVE_SMOKE_ENABLED=true` is explicitly set.
- Login and ticket tests also skip unless their `E2E_*` credentials are configured.
- The ticket test creates a uniquely named `PW-LIVE-<timestamp>` record and deletes only that record in a `finally` block.
- Run the suite only against a resettable demo or non-production environment. Do not enable live writes against production data.

## Required Environment

```dotenv
LIVE_BASE_URL=http://127.0.0.1:5000
LIVE_API_URL=http://127.0.0.1:5000/api
E2E_ADMIN_EMAIL=
E2E_ADMIN_PASSWORD=
E2E_TECH_EMAIL=
E2E_TECH_PASSWORD=
E2E_USER_EMAIL=
E2E_USER_PASSWORD=
LIVE_SMOKE_ENABLED=false
```

`LIVE_API_URL` is documented for external tooling; the Playwright suite uses `LIVE_BASE_URL` and calls `/api` relative to it.

## Run Locally

Start the target environment, set `LIVE_SMOKE_ENABLED=true` and test credentials, then run:

```bash
npm run test:smoke:live
```

Without the enable flag, all tests skip with a safety reason.

## Coverage

- `health.spec.ts`: health endpoint reachability and basic response schema.
- `login.spec.ts`: real login page and configured admin dashboard access.
- `ticket-lifecycle.spec.ts`: dedicated test-ticket creation, visibility, and cleanup.

## Validation status

The configured suite passed on 2026-07-13 against the project's resettable demo deployment using its non-real demo admin account. The test created one `PW-LIVE-*` ticket and removed it before completion. Local values stay in ignored `.env`; CI still requires repository secrets.

CI should run this suite only after deployment, on a schedule, or through a manual workflow with repository secrets.
