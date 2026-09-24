# Application Support Runbook

How to run, check and troubleshoot the service. The design reasons behind the health checks and request ids are in [ADR 003](adr/003-operability-and-request-tracing.md).

## Quick health check

| Check                        | Command                                                                                                  | Healthy result                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Liveness (process is up)     | `curl /api/health`                                                                                       | `{"ok":true,"service":"it-ticketing-system"}`                           |
| Readiness (database answers) | `curl /api/ready`                                                                                        | `200` with `"database":"up"`, plus `version`, `commit`, `uptimeSeconds` |
| Scripted, with a report      | `python -m support_ops.health_check` (see [Support-Ops-Automation](../Support-Ops-Automation/README.md)) | `Status: PASS` for both checks                                          |

Liveness says nothing about the database. If `/api/health` is fine but `/api/ready` returns `503`, the app is running and cannot reach MongoDB.

## Tracing a user-reported error

Every error the UI shows carries a reference, and every API error body and response header carries the same id.

1. Ask the user for the **Reference** shown under the error (for example `Reference: 0b6f2d0e-6a55-4a2b-9e4f-1f0c3f3f5d11`), or read `requestId` from the failed response in browser DevTools.
2. Find that id in the server logs. Each request is one JSON line:

   ```bash
   # Docker Compose
   docker compose logs app | grep 0b6f2d0e-6a55-4a2b-9e4f-1f0c3f3f5d11
   ```

   ```json
   {
     "level": 50,
     "service": "it-ticketing-system",
     "req": { "id": "0b6f2d0e-...", "method": "GET", "url": "/api/tickets" },
     "res": { "statusCode": 503 },
     "responseTime": 5003,
     "msg": "request completed"
   }
   ```

   On Vercel, search the function logs for the same id.

3. Unexpected failures (`level` 50) also log the error and its stack under the same id. Client errors (`level` 40, such as a 400 or 401) are summarised by the request line alone.
4. Reproduce with the same route and payload, fix, and add a regression test.

To trace your own request, send an `x-request-id` header (for example `x-request-id: support-case-42`) and search for it.

Bearer tokens and headers are never written to the logs.

## Start locally

Docker (nothing else to install):

```bash
docker compose up --build --wait     # app on http://localhost:5000, MongoDB behind it
docker compose run --rm seed         # optional: load demo tickets
```

Without Docker:

1. Use Node.js 24 (supported range 22 through 26; `.nvmrc` is included).
2. `npm ci`
3. Copy `.env.example` to `.env`, then either set `MONGODB_URI` to your own MongoDB or run `npm run dev:db` in a second terminal for a throwaway in-memory one.
4. Optionally `npm run seed` for predictable demo tickets.
5. `npm run dev` and open `http://localhost:5173`. The interactive API docs are at `http://localhost:5000/api/docs`.

## Production deployment checklist

- `MONGODB_URI` and `AUTH_SECRET` are set in the hosting provider and not committed.
- `npm test`, `npm run lint` and `npm run build` pass (CI runs them, plus coverage thresholds and an audit).
- After deploying, check `/api/ready`, then sign in with each demo role and confirm the dashboard loads.
- For a deployed environment that is safe to write to, run the smoke suite ([LIVE_SMOKE_TESTING.md](LIVE_SMOKE_TESTING.md)).

## Environment variables

| Variable                              | Required          | Purpose                                                                                                                                                                                                                                     |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                         | Yes               | MongoDB connection string                                                                                                                                                                                                                   |
| `AUTH_SECRET`                         | Yes in production | Signs bearer tokens; 32+ characters. In production `server.ts` refuses to start without it, and serverless functions answer 503 on sign-in and authenticated routes. `/api/ready` reports `authConfigured`                                  |
| `COOKIE_SECURE`                       | No                | Whether the refresh cookie is `Secure` (https only). Default: on in production. Set `false` for plain-http local runs; Compose does                                                                                                         |
| `REFRESH_TOKEN_TTL_DAYS`              | No                | How long a session lasts without use, default 7                                                                                                                                                                                             |
| `AUDIT_RETENTION_DAYS`                | No                | Delete audit events older than this. Unset keeps them forever. Changing it later needs `npm run db:sync-indexes`                                                                                                                            |
| `DEMO_USERS`                          | No                | `off` stops the three demo accounts being created on first sign-in                                                                                                                                                                          |
| `CRON_SECRET`                         | For the jobs      | Bearer token for `POST /api/jobs/*` (SLA escalation, webhook delivery); 32+ characters. Unset, the jobs answer 503 `JOBS_NOT_CONFIGURED`. Set the same value as the `CRON_SECRET` repository secret so the scheduled workflow can call them |
| `WEBHOOK_URL`                         | No                | Where ticket events go (Discord, Slack or any JSON endpoint). Treat it as a credential. Unset, nothing is recorded or sent                                                                                                                  |
| `WEBHOOK_FORMAT`                      | No                | `discord`, `slack` or `json`; chosen from the address when unset                                                                                                                                                                            |
| `WORKER_INTERVAL_MS`                  | No                | How often the worker (`npm run worker`, or the Compose `worker` service) runs both jobs, default 30000                                                                                                                                      |
| `OUTBOX_RETENTION_DAYS`               | No                | How long delivered events are kept, default 14. Changing it later needs `npm run db:sync-indexes`                                                                                                                                           |
| `PORT`                                | Local and Docker  | Express port (default 5000)                                                                                                                                                                                                                 |
| `CORS_ORIGINS`                        | No                | Comma-separated origins allowed to call the API from a browser. Unset means same-origin only                                                                                                                                                |
| `LOG_LEVEL`                           | No                | pino level, default `info`                                                                                                                                                                                                                  |
| `LOGIN_RATE_LIMIT_MAX`                | No                | Failed sign-ins allowed per window, default 10                                                                                                                                                                                              |
| `LOGIN_RATE_LIMIT_WINDOW_MS`          | No                | Rate-limit window, default 15 minutes                                                                                                                                                                                                       |
| `TRUST_PROXY`                         | No                | Number of reverse-proxy hops to trust for the client address. Set automatically on Vercel; leave unset when the app is exposed directly                                                                                                     |
| `API_DOCS`                            | No                | Set to `off` to hide `/api/docs` and `/api/openapi.json`                                                                                                                                                                                    |
| `GIT_COMMIT`                          | No                | Reported by `/api/ready`; the Docker build sets it                                                                                                                                                                                          |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | No                | Database connection timeout, default 5000                                                                                                                                                                                                   |

## Scheduled jobs and notifications

Two jobs run every 30 minutes, from the `Scheduled jobs` GitHub workflow (Vercel's free plan only runs a cron once a day) or, in a container deployment, from the Compose `worker` service (`docker compose --profile worker up worker`):

- **SLA escalation** (`POST /api/jobs/sla-escalation`): an unresolved ticket past its deadline is marked once and its priority raised one step (an urgent one is only marked; the deadline never moves); one within 24 hours of its deadline is marked "at risk". The result is `{ breached, atRisk, more }`; `more: true` means it hit its limit and the next run continues. It is safe to call at any time and as often as you like.
- **Notification delivery** (`POST /api/jobs/outbox-delivery`): sends due events to `WEBHOOK_URL`. Events are written in the same transaction as the ticket change, so a webhook outage never blocks or loses a change. A failed send is retried after about 30 s, 1, 2, 4 and 8 minutes; after the sixth attempt the event is `dead`.

To turn the scheduled workflow on, add the `BASE_URL` and `CRON_SECRET` repository secrets (Settings, Secrets and variables, Actions) and set the same `CRON_SECRET` in the deployment. Until both exist the workflow skips itself.

**Dead events** (a webhook that was down for hours, or a wrong URL): as an admin, `GET /api/outbox?status=dead` lists them with the last error (the webhook address is never included), and `POST /api/outbox/:id/retry` puts one back in the queue. Fix the cause first, or it will fail again.

If a call answers `503 JOBS_NOT_CONFIGURED`, `CRON_SECRET` is missing or shorter than 32 characters. If it answers `401`, the caller's token is not the secret.

## MongoDB connection troubleshooting

- `/api/ready` returns `503`, or ticket routes return `Database unavailable` / `Database is not configured`.
- Check the connection string: user, password and database name.
- Atlas: confirm Network Access allows the deployment.
- Confirm the database user can read and write.
- Restart the app after changing environment variables.
- The API fails a connection attempt after 5 seconds by design, and retries on the next request.

## Failed sign-in troubleshooting

- Use one of the demo accounts from the [README](../README.md).
- `429 Too many failed sign-in attempts`: the limit is 10 failures per 15 minutes per client address. Wait, or restart a single-container deployment to reset it. Successful sign-ins are not counted.
- "Your session expired": the access token lasts 15 minutes and is renewed silently, so this means the session itself ended: it was signed out, an admin changed the user's role (which ends their sessions), the refresh token expired (7 days), a used refresh token was replayed, or `AUTH_SECRET` changed. Sign in again.
- `Cross-origin request refused` on refresh or sign-out from your own site: the server compares the browser's `Origin` with the address it sees. Behind a reverse proxy that terminates https, set `TRUST_PROXY` (Vercel sets it for you) so the server knows the request was https.
- Signed out on every page load: the refresh cookie is not coming back. Over plain `http` (Docker, localhost) set `COOKIE_SECURE=false`; a `Secure` cookie is only sent over https.
- Behind a proxy, every user appearing to share one address means `TRUST_PROXY` is not set for that proxy.

## API 500 troubleshooting

- Take the reference from the UI (or the `requestId` in the response) and find the log line as described above; unexpected errors log the stack under the same id.
- Confirm the request body is valid JSON and MongoDB is reachable.
- Reproduce locally with the same route and payload, then add a regression test.

## Docker troubleshooting

- `docker compose up --wait` times out: run `docker compose ps` and `docker compose logs app`. The app is unhealthy while it cannot reach MongoDB.
- The container is marked `unhealthy` but keeps running: Docker does not restart unhealthy containers by itself. Restart it, or run it under an orchestrator that does.
- `Transaction numbers are only allowed on a replica set member or mongos`: MongoDB must be a replica set (Atlas is). Locally use `npm run dev:db` or `docker compose up`, which start one; a bare `mongod` needs `--replSet`.
- `AUTH_SECRET must be set` or `must be at least 32 characters` when `NODE_ENV=production`: set a longer `AUTH_SECRET` (Compose supplies a demo default).
- Port already in use: change the published port in `docker-compose.yml`, or `npm run free:api-port` on Windows for the local API.

## Vercel deployment troubleshooting

- Confirm the project has `MONGODB_URI` and a 32+ character `AUTH_SECRET` (`/api/ready` shows `authConfigured: true`), then redeploy after any change. Without the secret, sign-in returns 503 "Server authentication is not configured."
- Check the function logs for `/api` routes, and search them by request id.
- Confirm `api/[...path].js` is deployed and the frontend build output exists in `dist`.
- `/api/ready` is the quickest check that the deployed functions can reach the database.

## CI failure troubleshooting

| Failing step      | What to do                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm ci`          | Compare `package.json` and `package-lock.json`                                                             |
| Format            | `npm run format`                                                                                           |
| Lint              | `npm run lint:fix`, then review what remains                                                               |
| Tests or coverage | Run `npm run test:coverage` locally. A coverage failure names the threshold that dropped                   |
| Build             | Check the Vite output and recent frontend changes                                                          |
| Audit             | Review whether the advisory affects a production dependency; Dependabot proposes updates weekly            |
| Real-stack smoke  | Download the `playwright-report-real-stack` artifact and read the container logs printed by the failed job |

## Rollback

1. Identify the last known good commit or deployment.
2. Revert the faulty commit, or redeploy the known good build (or run the previous image tag from GHCR).
3. Confirm `/api/ready` returns `200`.
4. Sign in as admin and check the dashboard.
5. Document the incident and the follow-up fix.

## Escalate when

- Production data is unavailable.
- Authentication behaves inconsistently across users.
- A role can reach another role's restricted workflow.
- A deployment still fails after the environment variables and build logs have been checked.

Include the request ids, the time, the affected role and what changed recently. See the incident templates in [Support-Ops-Automation](../Support-Ops-Automation/docs/INCIDENT_RESPONSE.md).
