# ADR 009: The service desk agent is a client of the API, with a token for one ticket

Status: accepted

## Context

The service desk agent reads a new ticket, searches the knowledge base, sets its category, priority and group, and either proposes a reply or hands the ticket to a person. It is driven by a language model, and a language model reading text that a requester typed can be talked into things. Whatever the agent is allowed to do has to be limited by the system around it, not by its instructions.

The existing application already has the rules that matter (who may read or change a ticket, the workflow, the audit trail). The agent should not get a second, private route to the data that has to be kept in step with them.

## Decision

- **The agent calls the same HTTP API as everyone else.** `src/server/agent/` may not import the database, models, repositories, services, routes, middleware or security code. `architecture.test.ts` reads the real import statements (including bare and dynamic ones) and fails if it does. Its tools are thin wrappers over `GET` calls today and over the ordinary write endpoints later, so every rule and every audit entry that applies to a person applies to the agent.
- **A token for one run and one ticket.** The worker mints a token that lasts ten minutes and carries the ticket id (`tid`) and run id (`rid`). The identity is a fixed service account, not a row in `users`, so it cannot be assigned a role through `PATCH /users/:id`, cannot sign in with a password and cannot be found by listing users. A token that claims the agent role without a ticket is refused.
- **The scope is enforced in the services.** `assertAgentScope` runs inside the ticket, comment and knowledge-base services, so a route added later cannot forget it. The agent can act only on its own ticket (`403` on any other), can move a ticket to `pending-user` and to no other status, and cannot create or delete tickets, read stats or exports, or touch users, audit or outbox. `assertHuman` marks the few operations a person must do.
- **The role `agent` is deliberately not in `roles`.** The list of roles is what an admin can grant. Keeping the agent out of it means no code path that reads "the roles a user can have" can ever produce an agent, and the type system treats the agent as a separate kind of caller.
- **The agent's untrusted input is escaped data.** The ticket's title, description and comments go to the model as one JSON object inside `<ticket_data>` with angle brackets escaped, and the prompt says that nothing inside it is an instruction. This lowers the chance of an injected instruction working; it is not what the safety rests on. What the safety rests on is that the token cannot do more than the API allows for one ticket, and that the tools refuse (and the evaluation counts) any attempt to reach for another ticket, a tool that does not exist, or posting.
- **Effects are policy, not prompt.** Each tool has a tier (read, triage, propose, act) and a mode (off, shadow, assist, auto) allows some tiers. The decision (`disposition`: run, dry-run or refuse) is a pure function that fails closed: a mode it does not recognise refuses. In shadow mode, and in this first phase for every mode, a write is not sent; it is recorded on the run as an intended action so it can be looked at and scored.
- **Limits that stop a bad run early.** A step limit (default 8), a token budget per run (default 60,000), a daily cost cap by UTC day (default $1) and a kill switch that is read fresh, with no cache, before each step and again after the model answers and before its tools run. A limit reached is an outcome (`budget`, `kill_switch`), and the ticket stays with people, as it always did.
- **Every run and step is recorded.** `AgentRun` holds the outcome, the triage and proposal, the tokens and cost, and the intended actions; `AgentStep` holds each model turn and tool call (with a short summary of its output) and expires after `AGENT_STEP_RETENTION_DAYS`.

## Consequences

- The agent cannot do anything a technician could not do through the API for that one ticket, and it is subject to the same validation, workflow and audit as a person. A gap in the agent's own code is bounded by the token.
- Each tool call is an HTTP request back into the same deployment. On Vercel that is a second function invocation per call, which costs some latency and is accepted for the isolation.
- The `pending-user` status exists because an agent that needs an answer from the requester should be able to say so without resolving or escalating. While a ticket is `pending-user` the SLA job leaves it alone (no breach mark, no priority raise, no "at risk" mark), because a ticket waiting on its requester is not the team's to breach. The deadline itself does not move, so the time it waited still counts once it is worked again, and a public reply from the requester puts it back to `in-progress` in the same transaction as the comment.
- Adding a write tool means adding the API rule first, then the tool, then a tier and a mode for it; the architecture test and the scope checks do not need to change.
- The token is bearer: anyone who obtains one can act on that ticket for ten minutes. It is never logged, never sent to the model, and is minted per run.

## Alternatives considered

- **Let the agent call the services directly.** Shorter and cheaper, and the agent would then depend on the code it is meant to be fenced off from; a mistake in the agent could reach any ticket. The isolation was worth the extra request.
- **A user account with the technician role.** Simple, and far too much authority: a technician can act on every ticket, and an admin could accidentally leave the account with a password.
- **Rely on the prompt to keep the agent on its ticket.** A prompt lowers the rate of a bad call; it does not bound it.
