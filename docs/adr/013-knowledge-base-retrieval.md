# ADR 013: Knowledge-base search starts as a text index, and vectors need evidence

Status: accepted

## Context

The agent answers from the knowledge base, so how often it finds the right article decides how often it can help. The fashionable answer is embeddings and vector search. It is also more to build, run and pay for (a model call for every article and every query, an index of a new kind, and results that are harder to explain when they are wrong). [ADR 007](007-text-search.md) already put a MongoDB text index behind ticket search, so the same tool could be pointed at articles at almost no cost. The question is whether it is good enough, and that is something to measure and not to assume.

## Decision

- **Articles are found with a MongoDB text index** (weighted on title and body), through the same `GET /kb` a technician's browser uses.
- **Retrieval is measured on its own, with no model.** `npm run eval:retrieval` takes the golden tickets that an article resolves, searches with what a person wrote (the title, and the title and description), and reports how often the right article came first, in the top three and in the top five, and the mean reciprocal rank, listing every miss. It needs no key and costs nothing, so it runs on every change to the evaluation (`agent-eval.yml`). `kb-retrieval.integration.test.ts` keeps floors a little below the measured values, so an edit to an article or to the index that makes search clearly worse fails a build.
- **Vectors are not built until the numbers say they are needed.** What would count as the evidence is written down here, so the decision is made on results and not on fashion (below).

## What was measured

62 golden tickets have an article that resolves them. The text index over the 31 articles, searched with the raw ticket text (2026-09-25):

| Query                 | Right one first | In the top 3  | In the top 5  | Mean reciprocal rank |
| --------------------- | --------------- | ------------- | ------------- | -------------------- |
| title                 | 88.7% (55/62)   | 91.9% (57/62) | 91.9% (57/62) | 0.901                |
| title and description | 85.5% (53/62)   | 93.5% (58/62) | 95.2% (59/62) | 0.894                |

The misses (the full list is in [`eval/results/retrieval.md`](../../eval/results/retrieval.md)) fall into three kinds, and they are not all the same problem:

- **The words are not the article's words.** A ticket about "the intranet" needs "internal website"; "my trial has ended" needs "licence expired"; "move my authenticator" needs "change your MFA device". A synonym list would fix these, and vectors would too.
- **The ticket is not in English.** A ticket in French finds nothing at all, because the index stems English. Vectors would help; so would saying so and escalating.
- **Ranking, not recall.** The right article is in the results but not first (the index has no notion of how rare a word is, so a common word such as "laptop" counts as much as "imaging"). Vectors are not the only remedy: better titles and a few added aliases move it too.

## What would change the decision

Move to vectors (or a hybrid of both) if, on a live run with a real model (`docs/EVAL_HISTORY.md`):

1. tickets that an article resolves are being **escalated as "out of scope"**, or proposed with the wrong article, more often than the text-search misses above explain, so the agent's own reformulated queries are missing too; **and**
2. the cheap fixes have been tried and measured with the same command: **aliases in each article's front matter** (a line per article), then a small synonym list; **and**
3. the remaining misses are ones the words cannot fix (paraphrase, other languages) and are a **meaningful share** of real tickets, not of the 108 written for the set.

Recording recall before and after each step is the point: a retrieval change is kept only if the numbers move.

## Consequences

- Search is cheap, explainable (the words that matched), and needs no second service or per-article model call. It is also plainly imperfect on vocabulary, on other languages and on ranking, and this record says by how much.
- The numbers above are a **floor** for the agent, not its recall. The agent writes its own queries in the words a person would use, and can try again, so it may do better. Its end-to-end effect shows up as citation validity in the evaluation, which is what to look at first.
- 62 tickets is a small sample: one ticket is 1.6 points. The set was written by one person who also wrote the articles, so it probably flatters the search.
- The floors in the integration test will need raising (or, if articles are rewritten, lowering with a reason) as the knowledge base changes.

## Alternatives considered

- **Vector search from the start.** Better on paraphrase and other languages; costs a model call per article and per query, a vector index (Atlas vector search, not available in the in-memory database the tests use), and answers that are harder to debug. Worth it only if the measurement above says it is.
- **Hybrid (text and vectors, merged).** The likely end state if vectors are needed; the same evidence applies, and it adds a merge rule to tune.
- **Let the model browse the whole knowledge base.** With 31 articles it would work, and it would stop working, and get expensive, at a few hundred.
