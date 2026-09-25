# ADR 010: The agent is a second consumer of the outbox, run by a worker, with a prompt to start it

Status: accepted

## Context

A new ticket should be looked at by the agent soon after it is raised, without slowing or failing the request that raised it, and without losing the ticket if the agent's model is down. The application runs three ways: a Node process, a Docker container (with a worker), and Vercel serverless functions, where nothing runs between requests and the free plan's cron runs once a day. [ADR 006](006-transactional-outbox.md) already solved "do something after a change commits, at least once, from any of those" for webhooks.

## Decision

- **The outbox has a consumer.** Each `OutboxEvent` names who it is for: `webhook` or `agent`. A change writes one event per interested consumer in the same transaction as the change, so an agent event exists if and only if the ticket committed. Events written before the field existed have no consumer and count as `webhook`, so nothing already stored is orphaned or delivered twice. Each consumer claims only its own events, atomically, so several workers never take the same one.
- **Off means nothing is recorded.** With `AGENT_ENABLED` not exactly `true`, creating a ticket writes no agent event, and the system behaves as before the agent existed. Turning the agent on later does not run it on old tickets.
- **A worker runs the agent.** `processAgentEvents` claims a due event, checks the settings (kill switch, mode for the ticket's category, daily cost), begins a run, mints the run's token and runs the loop. It is called by `POST /api/jobs/agent-runs` (from the same scheduled workflow as the other jobs) and by the Compose worker, on the same schedule as delivery. Events are taken one at a time, at most five to a call, and no new one is started after 100 seconds, so a function stays inside its time limit; a call that stopped early says `more: true`.
- **A run is idempotent.** A run is keyed `<ticketId>:v<version>`, and beginning it is one atomic operation. A second worker that claims the same event finds the run finished and closes the event, or finds it in progress and looks again in two minutes. A run that failed, or that started more than five minutes ago and never finished, is taken over by the next attempt, and finishing a run is guarded by the attempt number so a slow worker that lost its claim cannot overwrite the newer result.
- **Failure means "with people".** A run that ends in an error is recorded, the event is retried with the outbox's backoff, and after the sixth attempt it is dead. The ticket was never held by the agent, so a person picks it up as they always would. Nothing waits on the agent.
- **A prompt start, so it does not wait for a timer.** After a ticket is created, when the agent is enabled, `CRON_SECRET` is set and the code is running on Vercel, the route hands `@vercel/functions` `waitUntil` a request to the job endpoint, which keeps the function alive after the response has gone. The job then runs in its own invocation, so a slow model cannot slow creating a ticket. It is an optimisation only: the scheduled job is the guarantee, and a kick that does not run, runs twice or fails does nothing the job would not. Elsewhere nothing is kicked and the worker's timer does it.
- **Timeouts follow the clock, not the model.** Locks on an event last six minutes, longer than the five-minute stale-run limit, so an event is not claimed again while its run could still finish.

## Consequences

- The agent starts within seconds on Vercel when the kick works, and within the schedule (30 minutes in the workflow, 30 seconds in Compose) when it does not. On Vercel, the job endpoint has to be reachable and `CRON_SECRET` set for the fallback; without them only the kick runs.
- Delivery is at least once, so a run may be attempted more than once for a ticket. The run key and the guarded finish make the recorded result single; a second attempt that finds a finished run does no model work.
- Editing a ticket changes its version, so a later event for the same ticket is a new run (`v` differs). Only new tickets record an event today.
- A ticket, its outbox events and the agent's run live in one database, and the run's token calls back into the same deployment. There is no queue, no second service and nothing to run beyond what the application already needs.
- The daily cost cap is checked before a run starts and again before each model call (the day's spending plus the run so far), so a run can overshoot the cap by at most one model call. The spending is summed from the runs' own records, so a run that is still going is not counted until it finishes.

## Alternatives considered

- **Call the agent inside the create-ticket request.** A slow or failing model would slow or fail ticket creation.
- **A queue service** (Vercel Queues, SQS). The right choice at larger scale. Here the outbox already gives at-least-once delivery, retries and a dead state with an admin view, on infrastructure that exists.
- **Change streams.** Need a long-running consumer, which serverless does not provide.
- **Only a timer, no kick.** Simpler, and a new ticket would wait up to the schedule before the agent looked at it, which is the demo's worst moment.
