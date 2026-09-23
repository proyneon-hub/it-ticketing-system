# ADR 003: Operability: connection reuse, liveness vs readiness, and request tracing

Status: accepted

## Context

The same Express app runs in three places: locally, in a Docker container, and as Vercel serverless functions. Serverless invocations are short-lived, share nothing except what stays warm, and can arrive in bursts. When something breaks, a support engineer needs to move from "a user saw this error" to "this is what the server did" quickly.

## Decision

**Database connections.** `connectToDatabase` caches the connection and shares one in-flight connection attempt between concurrent requests, so a burst of requests on a cold instance opens one connection, not one each. Connection attempts have a 5 second timeout so a database or DNS problem fails fast with a clear message instead of hanging until the platform kills the function. Failed attempts reset the cache so the next request retries.

**Liveness and readiness are different questions.**

- `GET /api/health` answers "is the process up?" and never touches the database, so an orchestrator does not restart a healthy app because of a database blip.
- `GET /api/ready` answers "can it serve users?" by pinging the database, and reports the version, the commit and the uptime. The Docker `HEALTHCHECK`, Docker Compose's `--wait` and the Python support monitor use it.

**Request tracing.** Every request gets an id: a caller-supplied `x-request-id` if it is well-formed, otherwise a generated UUID. The id is returned in the response header, written on every structured log line (pino), included in every error body as `requestId`, and shown in the UI's error alert as a reference. Headers, which carry bearer tokens, are never logged.

**Consistent errors.** Everything thrown, including auth failures, leaves through one error handler that maps known failures (validation 400, duplicate 409, database 503) and hides the details of unexpected ones behind a generic 500.

**Protection that must not lock out reviewers.** Login is rate limited on **failed** attempts only, so people switching between demo accounts are never blocked while password guessing is still throttled. The limiter's store is per-instance memory: exact on a single container, best effort across serverless instances. `AUTH_SECRET` is mandatory when the server starts in production (`server.js`), while serverless entry points log a warning instead of failing, because failing at boot would take the whole demo offline.

## Consequences

- A user-reported reference maps directly to log lines, which is the core of the support workflow in [RUNBOOK.md](../RUNBOOK.md).
- Readiness makes the container unhealthy when the database is down. That is what Compose and load balancers need, but note that Docker alone does not restart an unhealthy container.
- The rate limit is weaker on serverless than on a single container. A shared store such as Redis would be the next step if that mattered.
- Cold starts stay fast because the API documentation (about 12 MB of Swagger UI assets) loads on first visit to `/api/docs`, not at startup.
