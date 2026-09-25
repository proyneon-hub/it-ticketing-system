# ADR 011: The agent is rolled out in modes: shadow, then assist, then auto

Status: accepted (auto mode is designed here and arrives in its own change; this record is updated when it does)

## Context

A language model that writes to customers' tickets is not something to switch on in one step. The system needs a way to watch the agent before it can change anything, a way to let it change the cheap and reversible things while a person still owns what the requester reads, and, later, a way to let it act alone where that has been earned. Each step has to be reversible without a deploy, and each has to fail towards "a person handles it", which is where every ticket is without the agent.

## Decision

There are four modes. The mode decides which tiers of tool may act (`domain/agentPolicy.ts`, a pure function that fails closed: a mode it does not recognise refuses everything).

| Mode       | Read | Set triage, hand over | Draft a reply      | Post a reply                                                               |
| ---------- | ---- | --------------------- | ------------------ | -------------------------------------------------------------------------- |
| **off**    | no   | no                    | no                 | no                                                                         |
| **shadow** | yes  | recorded only         | recorded only      | refused                                                                    |
| **assist** | yes  | yes                   | saved for a person | refused                                                                    |
| **auto**   | yes  | yes                   | saved for a person | only for allowlisted categories, only with high confidence (not built yet) |

- **Shadow** runs the whole agent and writes nothing. What it would have done is recorded on the run (`intendedActions`), so it can be read and scored before anyone depends on it.
- **Assist** makes the low-risk writes for real. The agent sets the ticket's category, priority and group (and the group only if nobody has assigned it), or hands the ticket to a group with a summary as an internal note. Both go through the same API, permissions and version checks as a person's, with the agent's own one-ticket token ([ADR 009](009-agent-as-api-client.md)). The reply it drafts is **not** sent: it is saved on the run, and the ticket says a proposal is waiting.
- **A person decides on the reply.** Approving posts it as a public comment, written by "Service Desk Agent", marked `source: agent` and carrying who approved it, and moves the ticket to `pending-user`, all in one transaction. Approving with edits posts the edited text and records the proposal as `edited`. Rejecting posts nothing. Only one decision can win: it is an update that matches only while the proposal is `pending` and the ticket is still in the status it was read in, so two people, or an approval racing a rejection, get one success and one `409 NO_PENDING_PROPOSAL`. A finished ticket keeps its status when a reply is posted to it.
- **A person always outranks the agent's write.** The agent's triage is guarded by the ticket version it read. If a person edits the ticket in between it reads again and retries once; a second conflict makes it step back (the run ends `aborted: ticket_changed`) rather than fight. If a person later changes what the agent set, the ticket records that the triage is now a person's (`triageSource: human`).
- **Modes are per category, and there is a kill switch.** Each category can have its own mode in place of the default, so the agent can be on for Email and off for Security. The kill switch is read fresh, with no cache, before each step and again before the tools of a step run, and it can be flipped from the admin page without a deploy. Every settings change is audited.
- **Hard limits, whatever the mode.** A step limit and a token budget per run, a daily cost cap by UTC day checked before every model call, and a per-requester hourly limit (default 5 runs), past which the ticket is left to a person. Every one of these ends in "a person has the ticket", not in an error.
- **Where each mode runs.** The intended production setting is assist with the daily cap. Auto is for a local or Docker deployment only. Until auto exists a setting of `auto` runs as assist, so turning it up early cannot make the agent do more than assist does.

## Consequences

- The agent's value shows up before it is trusted: shadow runs can be compared with what people did, and assist puts a ready reply in front of a technician, who spends seconds instead of minutes.
- Triage is applied at once, not on approval. It is cheap to undo, it appears in the ticket's history as the agent's, and a proposal that is rejected still leaves the ticket better sorted. The cost is that a wrong triage is live until someone corrects it; the eval measures it.
- A proposal waits until someone acts. Nothing expires it yet, so an ignored one stays `pending`; the admin runs list shows the backlog.
- Approving is a two-step for the requester's experience only in the sense that the ticket now waits on them (`pending-user`); a reply from the requester puts it back in work ([ADR 009](009-agent-as-api-client.md)).
- The kill switch stops the agent, not the people who are approving: a proposal already drafted can still be decided while the switch is on.

## Alternatives considered

- **Apply the triage only when a reply is approved.** Keeps every write behind a person, and loses the value on tickets the agent escalates or the person rejects, which is where sorting matters most.
- **Let the agent post at once for everything it is confident about.** The fastest, and it needs a track record this system does not have yet. That is what shadow and assist are for, and what the eval gates.
- **A separate `proposals` collection.** Cleaner in isolation; the run already holds the proposal, the cost and the steps that produced it, and one record per attempt is easier to reason about than two that must be kept in step.
