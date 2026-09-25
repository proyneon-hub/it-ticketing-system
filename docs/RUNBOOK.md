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
- The knowledge base needs its articles in the database: run `npm run db:sync-indexes` once (it creates the article search index) and then `npm run kb:seed` against the same `MONGODB_URI`. Run `kb:seed` again whenever a file in `kb/` changes; an unchanged article is left alone. Nothing in the application needs the knowledge base until the agent is turned on (`AGENT_ENABLED`).

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
| `AGENT_ENABLED`                       | No                | `true` turns the service desk agent on: each new ticket also records an event for it. Anything else, or unset, and nothing is recorded for it                                                                                               |
| `ANTHROPIC_API_KEY`                   | No                | The key the agent uses to call the model. Without it the agent job reports `no_api_key` and does nothing. Never commit it                                                                                                                   |
| `AGENT_MODEL`                         | No                | The model for a run: `claude-sonnet-5` (default) or `claude-haiku-4-5`. Any other value is refused (`bad_model`), because a run's cost is worked out from a price table                                                                     |
| `AGENT_DEFAULT_MODE`                  | No                | Where the agent starts before its settings are changed: `off`, `shadow` (default), `assist` or `auto`. Until the write tools exist, `assist` and `auto` behave as `shadow`                                                                  |
| `AGENT_DAILY_COST_CAP_USD`            | No                | The most the agent may spend in a UTC day, in US dollars, default 1. `0` means it never runs. It is checked before every model call                                                                                                         |
| `AGENT_MAX_STEPS`                     | No                | The most model calls one run may make before handing the ticket to a person, default 8                                                                                                                                                      |
| `AGENT_RUN_TOKEN_BUDGET`              | No                | The most tokens one run may use, default 60000                                                                                                                                                                                              |
| `AGENT_API_BASE_URL`                  | No                | Where the agent reaches this API. Defaults to this deployment on Vercel, otherwise `http://127.0.0.1:PORT`                                                                                                                                  |
| `AGENT_STEP_RETENTION_DAYS`           | No                | How long a run's step-by-step record is kept, default 30. Changing it later needs `npm run db:sync-indexes`                                                                                                                                 |
| `WORKER_INTERVAL_MS`                  | No                | How often the worker (`npm run worker`, or the Compose `worker` service) runs both jobs, default 30000                                                                                                                                      |
| `OUTBOX_RETENTION_DAYS`               | No                | How long delivered events are kept, default 14. Changing it later needs `npm run db:sync-indexes`                                                                                                                                           |
| `METRICS_TOKEN`                       | No                | Turns on `GET /api/metrics` (Prometheus) and is the bearer token it requires; 32+ characters. Unset, the endpoint does not exist                                                                                                            |
| `PORT`                                | Local and Docker  | Express port (default 5000)                                                                                                                                                                                                                 |
| `CORS_ORIGINS`                        | No                | Comma-separated origins allowed to call the API from a browser. Unset means same-origin only                                                                                                                                                |
| `LOG_LEVEL`                           | No                | pino level, default `info`                                                                                                                                                                                                                  |
| `KB_RATE_LIMIT_MAX`                   | No                | Knowledge-base lookups allowed per caller per window, default 120. Counted per user, or per agent run, not per address                                                                                                                      |
| `KB_IP_RATE_LIMIT_MAX`                | No                | Knowledge-base requests allowed per address per window, before sign-in is checked, default 600. Only stops floods                                                                                                                           |
| `KB_RATE_LIMIT_WINDOW_MS`             | No                | Knowledge-base rate-limit window, default 1 minute                                                                                                                                                                                          |
| `LOGIN_RATE_LIMIT_MAX`                | No                | Failed sign-ins allowed per window, default 10                                                                                                                                                                                              |
| `LOGIN_RATE_LIMIT_WINDOW_MS`          | No                | Rate-limit window, default 15 minutes                                                                                                                                                                                                       |
| `TRUST_PROXY`                         | No                | Number of reverse-proxy hops to trust for the client address. Set automatically on Vercel; leave unset when the app is exposed directly                                                                                                     |
| `API_DOCS`                            | No                | Set to `off` to hide `/api/docs` and `/api/openapi.json`                                                                                                                                                                                    |
| `GIT_COMMIT`                          | No                | Reported by `/api/ready`; the Docker build sets it                                                                                                                                                                                          |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | No                | Database connection timeout, default 5000                                                                                                                                                                                                   |

## The service desk agent

The agent reads each new ticket, searches the knowledge base, sets the category, priority and group, and either drafts a reply for a person to approve or hands the ticket to a person. What it may do depends on the mode: in **shadow** it only records what it would do; in **assist** it triages and hands over for real, and its drafted reply waits for a technician to approve, edit or reject it; **auto** is not built yet and runs as assist. Decisions: [ADR 009](adr/009-agent-as-api-client.md), [ADR 010](adr/010-agent-worker-and-outbox-consumer.md), [ADR 011](adr/011-agent-rollout-shadow-assist-auto.md), [ADR 012](adr/012-server-side-citation-enforcement.md).

**Turning it on.** Set `AGENT_ENABLED=true` and `ANTHROPIC_API_KEY`, run `npm run db:sync-indexes` and `npm run kb:seed` once against the same database, and make sure `CRON_SECRET` is set (the scheduled workflow, or the Compose `worker`, is what runs it; on Vercel a new ticket also starts it at once). Only tickets created after it is on are looked at.

**Turning it off.** Unset `AGENT_ENABLED` (or set it to anything but `true`): no new ticket records an event, and the job answers `{ "configured": false, "reason": "disabled" }`. Events already recorded wait in the outbox and run if it is turned on again. `AGENT_DEFAULT_MODE=off` is different: the job still runs, and closes each event with a run recorded as `mode_off`, so those tickets are not looked at later. The kill switch and the mode are on the admin page (**Agent**, `/admin/agent`) and in `PUT /api/agent/settings`, and take effect on the agent's next step with no deploy.

**Moving from shadow to assist.** Read the runs first (admin page, or `agentruns`): are the categories, priorities and drafted replies what a technician would have chosen? Then set the default mode to `assist` (or set it for one category first, and leave Security on `shadow` or `off`). From then on a new ticket is triaged for real, and a ticket with a drafted reply shows a panel to staff. To go back, set the mode to `shadow` or flip the kill switch: proposals already drafted can still be decided, and nothing the agent already wrote is undone.

**Deciding on proposals.** A technician opens the ticket, reads the reply and the articles it cites, and approves it (as written, or edited) or rejects it. Approving posts the reply to the requester as "Service Desk Agent · approved by <name>" and moves the ticket to `pending-user`; the requester's answer puts it back in work. A proposal nobody acts on stays `pending`: filter the runs by outcome `proposed` to see the backlog.

**Limits that send a ticket to a person.** The daily cost cap, the per-requester hourly limit (default 5 runs an hour, set on the admin page) and a person editing the ticket while the agent works each end the run without the agent touching the ticket further. The run's reason says which: `daily_cost_cap`, `requester_rate_limited`, `ticket_changed`.

**What a run leaves behind.** One `agentruns` document per ticket version: the outcome (`proposed`, `escalated`, `budget`, `kill_switch`, `daily_cost_cap`, `error` and so on), the triage it chose, the reply it would post and the articles it cited, the tokens and cost, and `intendedActions`, the writes it would have made. `agentsteps` holds each model turn and tool call for `AGENT_STEP_RETENTION_DAYS` days. Nothing about a ticket, its comments or its activity changes.

**Reading the job's answer** (`POST /api/jobs/agent-runs`): `{ configured, ran, skipped, failed, more }`. `configured: false` comes with a `reason` (`disabled`, `no_api_key` or `bad_model`). `more: true` means it stopped at its limit (five events, or 100 seconds) and the next call continues. A run that fails is retried after 30 seconds, then 1, 2, 4 and 8 minutes, and is then `dead` in the outbox, where an admin can retry it. The ticket is untouched throughout.

**Watching it.** With `METRICS_TOKEN` set, `GET /api/metrics` exports the agent's numbers, and the Grafana dashboard (`docker-compose.observability.yml`) has an _Agent_ row for them. The ones about the whole system are read from the database when Prometheus scrapes, so they are right on serverless too: `agent_kill_switch` (1 while it is stopped), `agent_cost_usd_today{model}`, `agent_runs{mode,outcome,model}` (the last 24 hours), `agent_proposals{status}` (approved and edited against rejected is how often the draft was good enough), and `agent_events{status}` (the backlog: a growing `pending` means the worker is not running, any `dead` needs an admin). The ones about what one process did are only meaningful in a container deployment: `agent_tool_calls_total{tool,is_error}`, `agent_tokens_total{model,direction}` (a healthy prompt cache keeps `cache_read` high) and `agent_run_duration_seconds`. Worth an alert, if you run one: the kill switch on when nobody switched it, `agent_events{status="dead"} > 0`, drafted replies pending for hours, spend near the cap, and `error` outcomes among the runs.

**Tracing one ticket.** The request id sent back when the ticket was created is kept on the agent's event and on its run (`requestId`), and it is sent on every call the agent makes back into the API. `grep <id>` in the logs shows the request that made the ticket and everything the agent then did to it.

**Cost.** Each run is priced from the tokens the API reported. The daily cap counts the runs started since 00:00 UTC (a run's cost is recorded when it ends). `npm run eval` measures cost per ticket against the golden set on a throwaway local database; see [EVAL_HISTORY.md](EVAL_HISTORY.md).

## Scheduled jobs and notifications

Two jobs run every 30 minutes, from the `Scheduled jobs` GitHub workflow (Vercel's free plan only runs a cron once a day) or, in a container deployment, from the Compose `worker` service (`docker compose --profile worker up worker`):

- **SLA escalation** (`POST /api/jobs/sla-escalation`): an unresolved ticket past its deadline is marked once and its priority raised one step (an urgent one is only marked; the deadline never moves); one within 24 hours of its deadline is marked "at risk". The result is `{ breached, atRisk, more }`; `more: true` means it hit its limit and the next run continues. It is safe to call at any time and as often as you like.
- **Notification delivery** (`POST /api/jobs/outbox-delivery`): sends due events to `WEBHOOK_URL`. Events are written in the same transaction as the ticket change, so a webhook outage never blocks or loses a change. A failed send is retried after about 30 s, 1, 2, 4 and 8 minutes; after the sixth attempt the event is `dead`.

To turn the scheduled workflow on, add the `BASE_URL` and `CRON_SECRET` repository secrets (Settings, Secrets and variables, Actions) and set the same `CRON_SECRET` in the deployment. Until both exist the workflow skips itself.

**Dead events** (a webhook that was down for hours, or a wrong URL): as an admin, `GET /api/outbox?status=dead` lists them with the last error (the webhook address is never included), and `POST /api/outbox/:id/retry` puts one back in the queue. Fix the cause first, or it will fail again.

If a call answers `503 JOBS_NOT_CONFIGURED`, `CRON_SECRET` is missing or shorter than 32 characters. If it answers `401`, the caller's token is not the secret.

## Metrics and dashboards

`GET /api/metrics` serves Prometheus metrics: request rate and latency by route template (`/api/tickets/:id`, never a raw URL, so the number of series stays bounded), status codes, tickets created, SLA steps, webhook delivery results, the outbox backlog by status, and the Node.js process metrics. It does not exist unless `METRICS_TOKEN` is set (32+ characters), and then needs `Authorization: Bearer <token>`. It is served even when the database is down.

To look at them locally: `docker compose -f docker-compose.yml -f docker-compose.observability.yml up --build --detach --wait`, then open Grafana at http://localhost:3000 (admin / admin, local use only) and the **IT Ticketing System** dashboard. Prometheus is at http://localhost:9090.

**Per instance.** The numbers describe one process. In a container deployment that is the whole app; on Vercel each warm function is its own short-lived process, so the metrics are not meaningful there and the endpoint should stay off.

What to watch: the **Server errors** panel (5xx share), **Latency percentiles** (p95 above about 500 ms is worth a look), **Dead outbox events** (above zero needs an admin, see the section above) and **Event loop lag** (a busy process, for example under a burst of sign-ins, which hash passwords on the main thread; see [PERFORMANCE.md](PERFORMANCE.md)).

## Incident issues

The hourly `Support Ops Scheduled Health Check` workflow checks health, database readiness, sign-in and the ticket API on the live site. When one fails it opens an issue labelled `incident`, titled with the failing checks and severity (health or readiness down is Critical, sign-in or ticket API is High), containing the communication template and the failing checks from the [incident guide](../Support-Ops-Automation/docs/INCIDENT_RESPONSE.md). While the failure continues each run adds a comment to that same issue. The first run in which everything passes comments "Recovered" and closes it. Add the root cause to the issue before or after it closes, for the post-incident review. It needs the `BASE_URL` secret (and the account secrets) to run.

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
