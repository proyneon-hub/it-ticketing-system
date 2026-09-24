# Performance

Measured numbers only. Every figure here comes from the k6 runs whose raw output is committed in [`perf/results/`](../perf/results/), and can be reproduced with the steps below.

## What was measured

A [k6 script](../perf/load.js) drives the API the way a support team uses it: 10 virtual users for 30 seconds, each repeatedly picking one call at random.

| Call     | Share | Request                                                              |
| -------- | ----- | -------------------------------------------------------------------- |
| `list`   | 35%   | a random page of the queue                                           |
| `search` | 25%   | one of eight single-word searches (`printer`, `vpn`, `outlook`, ...) |
| `filter` | 20%   | open tickets that are high or urgent, sorted by priority             |
| `stats`  | 8%    | the dashboard counts                                                 |
| `create` | 7%    | a new ticket                                                         |
| `login`  | 5%    | sign in                                                              |

The database holds **10,000 generated tickets** ([`scripts/sampleData.ts`](../scripts/sampleData.ts), deterministic, so every run sees identical data) and is reseeded before each set of runs, because the `create` calls would otherwise grow it.

**Environment.** One machine runs everything (k6, the API and MongoDB), so there is no network in the numbers: AMD Ryzen 5 5600X (6 cores / 12 threads), 31.9 GB RAM, Windows 11, Node 24.15, k6 2.2.0, MongoDB 8.2.6 from `mongodb-memory-server`, the production build (`npm start`) with logging silenced.

Each set is one 10-second warm-up (discarded) then three measured runs. The table shows the **median of the three**. Across the runs throughput varied by under 4% and search latency by under 6%; tail latency of the other calls varied more (up to about 8%), so treat differences of that size as noise.

## Result: full-text search

The change under test replaces a case-insensitive regular expression over seven fields, which cannot use an index and scans every ticket, with MongoDB's text index (weighted, ranked by relevance). Before is commit `a7498a9`; after is the commit that introduced the change.

| Call (p50 / p95, ms) | Before (regex)   | After (text index) |
| -------------------- | ---------------- | ------------------ |
| **search**           | **68.5 / 112.6** | **9.2 / 14.4**     |
| list                 | 20.1 / 39.4      | 18.7 / 23.3        |
| filter               | 8.5 / 24.0       | 7.9 / 11.7         |
| stats                | 17.0 / 39.1      | 13.9 / 18.2        |
| create               | 9.8 / 27.7       | 9.4 / 14.1         |
| login                | 3.0 / 14.5       | 2.8 / 5.5          |
| **all requests**     | 19.5 / 85.1      | 11.5 / 21.4        |
| **throughput**       | 318 req/s        | 787 req/s          |

Search itself is about **7x faster at the median and 8x at the 95th percentile**.

**Read the other rows with care.** The calls that did not change (`list`, `filter`, `stats`) improved at the 95th percentile too. That is not those queries getting cheaper: the regex scans were saturating the shared database, and every other request queued behind them. Removing the scans freed the database for everything else. The overall throughput gain is mostly that effect, not a faster server. Medians of the unchanged calls barely moved (`list` 20.1 to 18.7 ms), which is the honest measure of how much they changed themselves.

The index-use claim is also checked directly, not just inferred from latency: two tests run `explain()` and assert a text-index plan for a word search and an index scan (never a collection scan) for a ticket-number prefix.

## Final run, after authentication, transactions and metrics

The search comparison above was taken before the rest of the roadmap landed. The same script was run again on the finished code (real sign-in, ticket writes inside a transaction, the metrics middleware, comment redaction), on the same machine and the same 10,000 tickets, reseeded before each set: one 10-second warm-up, then three 30-second runs, median of the three. Raw output: `perf/results/final-run*.json` and `final-nologin-run*.json`.

| Call (p50 / p95, ms) | After search change (Phase 2) | Final, with sign-in | Final, sign-in removed |
| -------------------- | ----------------------------- | ------------------- | ---------------------- |
| login                | 2.8 / 5.5                     | **85.1 / 129.1**    | (none)                 |
| list                 | 18.7 / 23.3                   | 28.0 / 85.8         | 22.1 / 27.4            |
| filter               | 7.9 / 11.7                    | 10.8 / 53.0         | 8.3 / 12.6             |
| search               | 9.2 / 14.4                    | 13.4 / 57.4         | 9.7 / 16.1             |
| stats                | 13.9 / 18.2                   | 18.7 / 81.6         | 15.6 / 20.8            |
| create               | 9.4 / 14.1                    | 26.1 / 93.6         | 16.3 / 23.3            |
| **all requests**     | 11.5 / 21.4                   | 21.6 / 87.7         | 14.8 / 25.4            |
| **throughput**       | 787 req/s                     | 295 req/s           | 647 req/s              |

(Throughput ranges across the three runs: 286 to 305, 602 to 676; the Phase 2 runs varied 765 to 793. Nothing failed in any run.)

**What this shows.**

- **Sign-in is now the dominant cost.** Passwords are hashed with argon2id (19 MiB of memory, 2 passes), which is deliberately expensive: 85 ms at the median instead of under 3 ms. With 5% of the traffic signing in, throughput fell from 787 to 295 req/s, and the 95th percentile of _every_ call rose to between 50 and 95 ms. Taking sign-in out of the mix (third column) brings throughput back to 647 req/s and the read calls to within 5 to 18% of Phase 2 at the median (create is covered below).
- **The tail suggests sign-in blocks other requests.** A slow sign-in that only cost its own latency would not lift the 95th percentile of unrelated calls, so the hash is probably running on the event loop. That was not diagnosed here (no profile was taken), but it means a burst of sign-ins delays everyone. The 5% sign-in share in this test is far above real traffic, where a person signs in once per session; it is a stress on the slowest call, not a typical day.
- **Creating a ticket got slower** (9.4 to 16.3 ms at the median without sign-in) because it is now a transaction (a session, the write and a commit) so that a ticket and its notification event commit together. When no webhook is configured no event is written, so this is the cost of the mechanism alone.
- **The read calls moved by 5 to 18% at the median** (`list` 18.7 to 22.1, `stats` 13.9 to 15.6, `search` 9.2 to 9.7, `filter` 7.9 to 8.3). Earlier runs of the same script varied by up to about 8%, so the smallest of these is within noise; `list` is not, and its cause was not isolated. The metrics middleware runs on every request and may account for some of it, but its share was not measured separately.

**Not done.** No fix for the sign-in cost is included; moving the hash off the event loop (a worker thread or a native binding) is the obvious next step and would be verified with this same script. These are single-machine numbers with no network, so treat the ratios as more meaningful than the absolute values.

## The trade-off that came with it

Text search matches **whole words and their other forms**, not fragments. `connecting` now finds "Cannot connect to Wi-Fi", but typing `prin` no longer finds "Printer". The regex search matched any fragment. Ranking (title above description) and stemming are what a support desk wants from a search box, at the cost of as-you-type partial-word matching. If that were needed, the next step would be an n-gram index or a search service, not going back to a scan. [API.md](API.md#listing-tickets) documents the behaviour.

## What is not measured here

- **CSV export.** It now streams from a cursor with no row cap, and a test exports 10,050 tickets to prove the cap is gone. Its speed and memory were not benchmarked, so no number is claimed.
- **A network or a hosted database.** Everything ran on one machine against a local MongoDB.
- **Sustained or higher load.** Ten users for 30 seconds shows the effect of the change; it is not a capacity test.

## Reproduce it

```bash
npm run build
npm run dev:db                                   # throwaway MongoDB (port 27017)
export MONGODB_URI=mongodb://127.0.0.1:27017/it_ticketing
node dist-server/scripts/seed.js --count 10000   # the same 10,000 tickets
NODE_ENV=production AUTH_SECRET=any-value-of-32-or-more-characters LOG_LEVEL=silent npm start
RESULT_LABEL=my-run npm run perf                 # writes perf/results/my-run.json
```

To compare with the old search, check out `a7498a9` and repeat. After switching to a database that already has the previous text index, run `node dist-server/scripts/sync-indexes.js` (or `npm run db:sync-indexes`) once: MongoDB will not change a text index in place.
