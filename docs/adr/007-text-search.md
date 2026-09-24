# ADR 007: Full-text search with a text index, accepting whole-word matching

Status: accepted

## Context

Search was a case-insensitive regular expression over seven fields. A regular expression with a leading wildcard cannot use an index, so every search scanned every ticket. On 10,000 tickets the median search took 68 ms and, more importantly, the scans saturated the shared database so that unrelated requests queued behind them.

## Decision

- **A weighted MongoDB text index** (`ticket_text`) over ticket number, title, description, requester name and email, assignee and category. A match in the title or number outranks one in the description, and results are ordered by relevance when the caller does not pick a sort.
- **A ticket number is not a text search.** Input that looks like `TKT-` followed by digits is matched with an anchored, case-sensitive prefix on the unique `ticketNumber` index, so typing `tkt-00` finds tickets as you type.
- **The input is treated as plain words.** Text-search syntax (a leading minus, quoted phrases) is stripped, so a search box cannot be used to write queries.
- **Proved with `explain()`, not only with timing.** Two integration tests assert a text-index plan for a word search and an index scan (never a collection scan) for a number prefix.

## Evidence

Measured with k6 on 10,000 generated tickets, median of three runs ([PERFORMANCE.md](../PERFORMANCE.md)): search fell from 68.5 to 9.2 ms at the median and from 112.6 to 14.4 ms at the 95th percentile. The calls that did not change also improved at the tail (`list` p95 39 to 23 ms), because the scans no longer starved them. That second effect is not those queries getting cheaper, and the document says so.

## Consequences

- **Search matches whole words and their other forms, not fragments.** `connecting` finds "Cannot connect to Wi-Fi"; `prin` no longer finds "Printer". This is the price of the index.
- MongoDB allows one text index per collection, so it covers every searchable field, and changing its definition on an existing database needs `npm run db:sync-indexes` (MongoDB will not alter a text index in place). Running it against Atlas is a one-time step after deploying.
- If partial-word matching were needed, the next step is an n-gram index or a search service, not a return to scanning.

## Alternatives considered

- **Keep the regex.** Simple and fragment-friendly, but a scan per search.
- **Atlas Search.** Better relevance and partial matching, but Atlas-only, so it would break the Compose and in-memory-database setups this project runs on.
- **A separate search service.** More capable, and more to operate than the problem justifies.
