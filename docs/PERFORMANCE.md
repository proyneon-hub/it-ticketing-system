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
| **throughput**       | 318 req/s        | 781 req/s          |

Search itself is about **7x faster at the median and 8x at the 95th percentile**.

**Read the other rows with care.** The calls that did not change (`list`, `filter`, `stats`) improved at the 95th percentile too. That is not those queries getting cheaper: the regex scans were saturating the shared database, and every other request queued behind them. Removing the scans freed the database for everything else. The overall throughput gain is mostly that effect, not a faster server. Medians of the unchanged calls barely moved (`list` 20.1 to 18.7 ms), which is the honest measure of how much they changed themselves.

The index-use claim is also checked directly, not just inferred from latency: two tests run `explain()` and assert a text-index plan for a word search and an index scan (never a collection scan) for a ticket-number prefix.

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
