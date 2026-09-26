import type { GoldenTicket } from './types';

// How well the knowledge-base search finds the right article, on its own, with no model involved
// (docs/adr/013). The golden tickets that a knowledge-base article resolves say which article that
// is; the question here is only whether a text search puts it near the top for what a person wrote.
//
// This is a measurement of the search index, not of the agent: the agent writes its own queries, and
// what it does with the results is measured by the evaluation proper (citation validity).

export type Query = 'title' | 'title and description';

export interface RetrievalRow {
  id: string;
  query: string;
  expected: string[];
  // The ids the search returned, best first.
  found: string[];
  // Where the first right article came, counting from 1; 0 if none of them were in the results.
  rank: number;
}

export interface RetrievalSummary {
  query: Query;
  n: number;
  atOne: number;
  atThree: number;
  atFive: number;
  // Mean reciprocal rank: 1 when the right article is always first, 0.5 when always second.
  mrr: number;
}

const queryFor = (ticket: GoldenTicket, kind: Query): string =>
  kind === 'title' ? ticket.title : `${ticket.title} ${ticket.description}`;

// The tickets a knowledge-base article resolves: the only ones with a right answer to look for.
export const answerable = (tickets: GoldenTicket[]): GoldenTicket[] =>
  tickets.filter((ticket) => ticket.expected_action === 'propose');

export async function measureRetrieval(
  tickets: GoldenTicket[],
  kind: Query,
  search: (query: string, limit: number) => Promise<string[]>,
  limit = 5
): Promise<{ summary: RetrievalSummary; rows: RetrievalRow[] }> {
  const rows: RetrievalRow[] = [];
  for (const ticket of answerable(tickets)) {
    const query = queryFor(ticket, kind);
    const found = await search(query, limit);
    const first = found.findIndex((id) => ticket.relevant_kb_ids.includes(id));
    rows.push({
      id: ticket.id,
      query,
      expected: ticket.relevant_kb_ids,
      found,
      rank: first === -1 ? 0 : first + 1,
    });
  }
  return { summary: summarizeRetrieval(kind, rows), rows };
}

export function summarizeRetrieval(kind: Query, rows: RetrievalRow[]): RetrievalSummary {
  const within = (k: number) => rows.filter((row) => row.rank > 0 && row.rank <= k).length;
  const n = rows.length;
  return {
    query: kind,
    n,
    atOne: within(1),
    atThree: within(3),
    atFive: within(5),
    mrr: n === 0 ? 0 : rows.reduce((sum, row) => sum + (row.rank > 0 ? 1 / row.rank : 0), 0) / n,
  };
}

const pct = (hits: number, n: number): string =>
  n === 0 ? 'n/a' : `${((hits / n) * 100).toFixed(1)}% (${hits}/${n})`;

// A table for docs/adr/013 and the console, with the misses listed so they can be looked at.
export function renderRetrieval(
  results: { summary: RetrievalSummary; rows: RetrievalRow[] }[],
  meta: { date: string; total: number }
): string {
  const lines = [
    `# Knowledge-base search: does the right article come up?`,
    '',
    `Measured on ${meta.date} against the ${results[0]?.summary.n ?? 0} golden tickets that an article resolves (of ${meta.total}). No model was used: this is the text index alone.`,
    '',
    '| Query | First result right | Right one in the top 3 | Right one in the top 5 | Mean reciprocal rank |',
    '| ----- | ------------------ | ---------------------- | ---------------------- | -------------------- |',
  ];
  for (const { summary } of results) {
    lines.push(
      `| ${summary.query} | ${pct(summary.atOne, summary.n)} | ${pct(summary.atThree, summary.n)} | ${pct(summary.atFive, summary.n)} | ${summary.mrr.toFixed(3)} |`
    );
  }
  for (const { summary, rows } of results) {
    const missed = rows.filter((row) => row.rank !== 1);
    lines.push('', `## Not first, by ${summary.query} (${missed.length})`, '');
    if (missed.length === 0) lines.push('None.');
    for (const row of missed) {
      lines.push(
        `- ${row.id}: wanted ${row.expected.join(' or ')}, ${row.rank === 0 ? 'not in the top results' : `it was number ${row.rank}`} (${row.found.join(', ') || 'no results'})`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
