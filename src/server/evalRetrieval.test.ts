import {
  answerable,
  measureRetrieval,
  renderRetrieval,
  summarizeRetrieval,
} from '../../scripts/eval/retrieval';
import type { GoldenTicket } from '../../scripts/eval/types';

const golden = (overrides: Partial<GoldenTicket>): GoldenTicket => ({
  id: 'T001',
  title: 'VPN keeps disconnecting',
  description: 'It drops every few minutes.',
  expected_category: 'Network',
  expected_priority: 'medium',
  expected_group: 'Network Support',
  expected_action: 'propose',
  relevant_kb_ids: ['KB-006'],
  tags: [],
  ...overrides,
});

describe('answerable', () => {
  test('is the tickets an article resolves, and no others', () => {
    const tickets = [
      golden({ id: 'A' }),
      golden({
        id: 'B',
        expected_action: 'escalate',
        relevant_kb_ids: [],
        expected_reason: 'other',
      }),
    ];
    expect(answerable(tickets).map((t) => t.id)).toEqual(['A']);
  });
});

describe('measureRetrieval', () => {
  const tickets = [
    golden({ id: 'A', title: 'first', relevant_kb_ids: ['KB-001'] }),
    golden({ id: 'B', title: 'second', relevant_kb_ids: ['KB-002'] }),
    golden({ id: 'C', title: 'third', relevant_kb_ids: ['KB-003', 'KB-004'] }),
    golden({ id: 'D', title: 'fourth', relevant_kb_ids: ['KB-005'] }),
    golden({ id: 'E', title: 'nothing', relevant_kb_ids: ['KB-006'] }),
    golden({ id: 'X', title: 'escalated', expected_action: 'escalate', relevant_kb_ids: [] }),
  ];
  // The search answers from a table, so each ticket's rank is known in advance.
  const answers: Record<string, string[]> = {
    first: ['KB-001', 'KB-009'],
    second: ['KB-009', 'KB-002'],
    third: ['KB-009', 'KB-008', 'KB-004'],
    fourth: ['KB-009', 'KB-008', 'KB-007', 'KB-010', 'KB-005'],
    nothing: [],
  };
  const search = async (query: string) => answers[query] ?? [];

  test('finds where the first right article came, counting from one, and 0 when it did not', async () => {
    const { rows } = await measureRetrieval(tickets, 'title', search);
    expect(rows.map((row) => [row.id, row.rank])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
      ['D', 5],
      ['E', 0],
    ]);
    expect(rows[2]).toMatchObject({ expected: ['KB-003', 'KB-004'], found: answers['third'] });
  });

  test('counts the hits within one, three and five, and the mean reciprocal rank', async () => {
    const { summary } = await measureRetrieval(tickets, 'title', search);
    expect(summary).toMatchObject({ n: 5, atOne: 1, atThree: 3, atFive: 4 });
    expect(summary.mrr).toBeCloseTo((1 + 1 / 2 + 1 / 3 + 1 / 5 + 0) / 5, 10);
  });

  test('asks with the title alone, or the title and the description, and passes the limit on', async () => {
    const asked: [string, number][] = [];
    const record = async (query: string, limit: number) => {
      asked.push([query, limit]);
      return [];
    };
    await measureRetrieval([golden({ title: 'T', description: 'D' })], 'title', record);
    await measureRetrieval(
      [golden({ title: 'T', description: 'D' })],
      'title and description',
      record,
      3
    );
    expect(asked).toEqual([
      ['T', 5],
      ['T D', 3],
    ]);
  });

  test('says nothing rather than dividing by zero when there is nothing to measure', () => {
    expect(summarizeRetrieval('title', [])).toEqual({
      query: 'title',
      n: 0,
      atOne: 0,
      atThree: 0,
      atFive: 0,
      mrr: 0,
    });
  });

  test('a right article that came after the results were cut off does not count', async () => {
    const { rows } = await measureRetrieval(
      [golden({ title: 'late', relevant_kb_ids: ['KB-009'] })],
      'title',
      async () => ['KB-001', 'KB-002']
    );
    expect(rows[0]?.rank).toBe(0);
  });
});

describe('renderRetrieval', () => {
  test('gives a table, and lists what was not first so it can be looked at', async () => {
    const tickets = [
      golden({ id: 'A', title: 'first', relevant_kb_ids: ['KB-001'] }),
      golden({ id: 'B', title: 'second', relevant_kb_ids: ['KB-002'] }),
      golden({ id: 'C', title: 'none', relevant_kb_ids: ['KB-003'] }),
    ];
    const search = async (query: string) =>
      ({ first: ['KB-001'], second: ['KB-009', 'KB-002'], none: [] })[query] ?? [];
    const text = renderRetrieval([await measureRetrieval(tickets, 'title', search)], {
      date: '2026-09-25',
      total: 10,
    });

    expect(text).toContain(
      'Measured on 2026-09-25 against the 3 golden tickets that an article resolves (of 10)'
    );
    expect(text).toContain('| title | 33.3% (1/3) | 66.7% (2/3) | 66.7% (2/3) | 0.500 |');
    expect(text).toContain('- B: wanted KB-002, it was number 2 (KB-009, KB-002)');
    expect(text).toContain('- C: wanted KB-003, not in the top results (no results)');
    expect(text).not.toContain('- A:');
  });

  test('says none when everything was first', async () => {
    const result = await measureRetrieval([golden({ title: 'a' })], 'title', async () => [
      'KB-006',
    ]);
    expect(renderRetrieval([result], { date: 'd', total: 1 })).toContain('None.');
  });
});
