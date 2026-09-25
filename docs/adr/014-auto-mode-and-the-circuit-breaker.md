# ADR 014: Auto mode answers alone only where the server allows it, and a circuit breaker stops a failing agent

Status: accepted

## Context

[ADR 011](011-agent-rollout-shadow-assist-auto.md) rolls the agent out in modes and leaves the last one, auto, for when there is a reason to trust it. Auto is the first time the agent speaks to a requester with nobody reading the words first, so it needs stricter rules than the modes before it: the rules must hold even if the agent is wrong, manipulated or out of date about the settings. Separately, the agent depends on a model and an API it does not control. When they fail, every ticket would otherwise spend its retries against a service that is down, and the agent should get out of the way and let people have the tickets, which is where every ticket was before it existed.

## Decision

### Answering alone

- **One place decides, and it is the server.** The agent answers a ticket through `POST /agent/resolutions`. The endpoint does not trust the agent's mode or its reading of the settings. Each time, it reads the settings fresh and refuses (`403`, with the reason) unless: the kill switch is off; this deployment allows auto mode; the mode for the ticket's category **as it is now, after the agent's own triage**, is `auto`; that category is on the list of categories the agent may answer alone; the category is not Security; and the confidence is `high`. It also refuses if a cited article does not exist (`400`), if the ticket is already finished (`409`), or if the agent has already answered it (`409 DUPLICATE`), so a retried run cannot say the same thing twice. The reply, the move to `pending-user`, the history entries and the events commit in one transaction, guarded by the ticket's version.
- **The agent's own checks come first and are the same rules,** so it is told early and can draft the reply for a person instead. They are a courtesy; the server's are the guarantee, and a test calls the endpoint directly with an agent token to show it.
- **It says what it is.** The comment is marked `source: agent` and carries no `approvedBy`. The interface labels it _AI-generated · not reviewed_, and staff see the ticket's proposal as `posted`, with nothing to approve. The proposal is kept on the run, as ever, so it can be read and scored afterwards.
- **Categories are checked twice on purpose.** A ticket's category when it arrives is whatever the requester typed (usually the default), and the agent then triages it. So the run's mode comes from the category the ticket arrived with, and the right to answer alone is checked against the category it has been given. In practice, auto is enabled by setting the default mode to `auto` and listing the categories that may be answered alone; a category set to `off`, `shadow` or `assist` in its own right stays that way at the point of posting.
- **Where it may run.** Auto mode is for a local or Docker deployment, where someone is watching. On Vercel it is unavailable unless `AGENT_ALLOW_AUTO=true` says otherwise: a setting of `auto` there runs as assist, the admin page says so, and the endpoint refuses. This is what keeps the public demo from speaking for a service desk unattended.

### The circuit breaker

- **When the model is failing, stop asking.** After five failed runs in a row (`AGENT_BREAKER_FAILURES`), the agent does not start new runs for ten minutes after the latest failure (`AGENT_BREAKER_COOLDOWN_MS`). Each ticket that arrives meanwhile is recorded as a run that was stopped (`circuit_open`) and left with people, unchanged. After the cooldown the next run is a probe: if it works the breaker closes, and if it fails it opens again for another cooldown.
- **It keeps no state of its own.** It is worked out from the record of runs, which every instance reads from the same database, so a serverless deployment made of many small processes agrees on it without anything to keep in step, and there is no flag to get stuck. Only runs that really tried something count: stopped runs (the kill switch, the cost cap, a limit, this breaker) say nothing about whether the model works, so they neither open the breaker nor close it.
- **It can be seen.** The admin page shows an alert with the failure count and when it will try again, the settings API reports it, and `agent_circuit_open` is a metric with a panel on the dashboard.

## Consequences

- The blast radius of a mistaken or manipulated agent is bounded by settings a person controls, checked by code the agent does not run. The worst it can do in auto mode is answer a ticket in an allowed category with high confidence, once, with a reply built from articles that exist; every such reply is on record and labelled.
- The knowledge base and the prompt are what make that reply good. Nothing here checks that the steps follow from the cited articles ([ADR 012](012-server-side-citation-enforcement.md)); that is what the evaluation is for, and auto should stay off for a category until its citation validity has been measured.
- A ticket held by the breaker is not retried later: it went to people, as it would have without the agent. Nothing is lost, and nothing is answered late by a recovered agent, which could be worse than not answering.
- The breaker counts failures of any cause. A bug in the agent's own code that fails every run also opens it, which is the right outcome and a reason to look at the failing runs.
- Five in a row is a starting point, not a measurement. It should be revisited against real failure patterns.
- **Model routing is not built.** The plan considered a small model for triage and a larger one for the reply. There is one model per deployment (`AGENT_MODEL`), and no evidence yet that routing would pay for its complexity; it should only be added if a live evaluation shows a difference worth the second call.

## Alternatives considered

- **Trust the agent's tools to enforce the policy.** They do, and it is not enough: they run in the same process as the model's output.
- **Post first, review afterwards.** Cheaper to build and no different in what the requester sees; the point of the modes is that a person sees it first until there is a reason not to.
- **A breaker flag in the settings document.** Simple, and it would need something to close it, and could stay open by mistake for ever. Working it out from the runs cannot.
- **Retry the tickets the breaker held once it closes.** Considered, and left out for the reason above: a late automatic answer is a new kind of risk for a marginal gain.
