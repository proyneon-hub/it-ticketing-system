# ADR 012: A reply may only cite what the agent read, and the server enforces it

Status: accepted

## Context

The failure that matters most for a support agent is not a wrong category; it is confidently wrong advice: numbered steps that are not in any article, or an article that does not say what the reply claims. A prompt asking the model to "only use the knowledge base" lowers how often that happens and cannot bound it. What can be bounded is what a reply is allowed to say it relies on.

## Decision

- **A proposed reply has to cite, and can only cite articles the agent read in full in this run.** `propose_resolution` (and `post_resolution`, when it exists) needs at least one knowledge-base id, and every id must belong to an article that the agent fetched with `get_kb_article` in the same run. A search result is not enough: it shows a snippet, and a snippet is not the article. The check is made by the tool registry after the input is validated and before anything is saved, so it cannot be argued with; a failed check is a result the model is told about, and it can read the article and try again or escalate.
- **Other refusals live in the same place.** A Security ticket is never resolved by the agent, whatever it believes: it must escalate to the Security Team. A reply with low confidence is refused, and the agent must escalate. A reply needs a triage set first. The ticket id in every call must be the run's own. Citations are also checked for shape (`KB-` and three digits) and de-duplicated.
- **Where the read is remembered.** In memory, for the run, in state the model cannot touch. It does not survive the run, so nothing can be "read" in one run and cited in another.
- **The record keeps what the reviewer needs.** The proposal stores the cited ids and the reasoning summary; the approval view shows the cited articles by title so a person can open them, and a citation to an article that has since been removed shows its id rather than a title.
- **What this does not prove.** It proves the agent read the article it cites. It does not prove the reply's steps come from that article. That is measured, not enforced: the evaluation counts a proposal as valid only if everything it cites is an article that covers the problem, and an optional grader (a model, so imperfect, and checked by hand on a sample) asks whether each step can be found in the cited text. Retrieval itself is a text index, which has no notion of how rare a word is; the right article was first for 15 of 17 sample queries and second for the rest, so a citation to the wrong article is the failure to watch, not a missing one.

## Consequences

- An invented article id, an article the agent only saw in a search result, and a reply with no source cannot be saved as a proposal, however the ticket or the model is worded.
- The model may need an extra turn to read an article before citing it. That costs a model call, and it is the cost of the guarantee.
- The rule is only as good as the knowledge base: an article can be wrong or stale, and `last_reviewed` is in the front matter for that reason. The articles in the repository are drafts to be aligned with real policy before anyone relies on them.
- Moving to vector search later changes retrieval, not this rule: the check is on what was read, whatever found it.

## Alternatives considered

- **Trust the prompt.** Simple and unbounded.
- **Let the model cite from search snippets.** Cheaper (no read) and it cites things it has not seen the steps of.
- **Verify the reply text against the article on the server** (for example, by requiring each step to appear in it). Attractive and brittle: paraphrase is the point of a reply, and a strict check either rejects good replies or is loose enough to prove little. Grading is left to the evaluation, where it can be measured and improved without blocking a technician.
