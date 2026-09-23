# Live Smoke Testing

## Purpose

The smoke suite checks the real frontend, API, authentication and database working together, with no mocked API routes. It is separate from the deterministic mocked regression suite in `tests/e2e-mocked`.

It runs in two places:

- **On every pull request**, against the Docker Compose stack (the production image and a real MongoDB). This is the `real-stack` job in `.github/workflows/e2e.yml`.
- **On demand**, against a deployed environment, through the manual `Live Smoke` workflow or locally.

## Safety controls

- The suite skips unless `LIVE_SMOKE_ENABLED=true` is set explicitly.
- Tests that sign in also skip unless their `E2E_*` credentials are configured.
- The ticket test creates one uniquely named `PW-LIVE-<timestamp>` record and deletes only that record in a `finally` block.
- Every other test is read-only.
- Run it only against a resettable demo or non-production environment. Never enable live writes against production data.

## Environment

```dotenv
LIVE_BASE_URL=http://127.0.0.1:5000
E2E_ADMIN_EMAIL=
E2E_ADMIN_PASSWORD=
E2E_USER_EMAIL=
E2E_USER_PASSWORD=
LIVE_SMOKE_ENABLED=false
```

The Playwright suite calls `/api` relative to `LIVE_BASE_URL`. The demo accounts are public, so the Compose job uses them directly; deployed environments should use test-only credentials stored as secrets ([GITHUB_SECRETS_SETUP.md](GITHUB_SECRETS_SETUP.md)).

## Run locally against the full stack

```bash
docker compose up --build --wait
docker compose run --rm seed

LIVE_SMOKE_ENABLED=true LIVE_BASE_URL=http://127.0.0.1:5000 E2E_ADMIN_EMAIL=admin@demo.local E2E_ADMIN_PASSWORD='AdminPass123!' E2E_USER_EMAIL=user@demo.local E2E_USER_PASSWORD='UserPass123!' npm run test:smoke:live

docker compose down --volumes
```

Without Docker, `npm run dev:db` starts a throwaway MongoDB, and `npm run build` followed by `NODE_ENV=production AUTH_SECRET=local-smoke-secret-at-least-32-chars node server.js` serves the production build the same way the image does.

Without the enable flag, every test skips with a safety reason.

## Coverage

| File                       | What it checks                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `health.spec.ts`           | The liveness endpoint and its response shape                                                                               |
| `readiness.spec.ts`        | The readiness probe reports the database up; an unauthenticated ticket request is refused and echoes a supplied request id |
| `login.spec.ts`            | A real sign-in loads the dashboard **with data**, not only the page shell                                                  |
| `requester-scope.spec.ts`  | A requester sees only their own tickets and has no delete controls                                                         |
| `docs.spec.ts`             | The interactive API docs render under the Content-Security-Policy                                                          |
| `ticket-lifecycle.spec.ts` | Create a dedicated test ticket, see it in the queue, delete it                                                             |

Two of these tests exist because of a real miss: a dashboard that never loaded once passed both the login and the requester tests, because zero rows also satisfies "only my tickets". They now assert that the data loaded. See [DEF-010](DEFECT_LOG.md#def-010-the-dashboard-stayed-empty-after-signing-in-against-the-real-api).

## Validation status

All seven tests passed on 2026-09-23 against the production build served by Express (the same process the Docker image runs), a real MongoDB and Chromium. The Docker image itself and the Compose job are defined in the repository but are exercised by CI, which needs the branch to be pushed.

The manual `Live Smoke` workflow stays inert until its repository secrets exist. See [GITHUB_SECRETS_SETUP.md](GITHUB_SECRETS_SETUP.md).
