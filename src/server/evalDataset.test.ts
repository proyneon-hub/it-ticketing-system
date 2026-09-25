import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadSmokeIds,
  loadTickets,
  parseTickets,
  selectTickets,
  validateGolden,
} from '../../scripts/eval/dataset';
import { judgeGroundedness } from '../../scripts/eval/judge';
import { historyRow, renderMarkdown, summaryLine } from '../../scripts/eval/report';
import { summarize } from '../../scripts/eval/score';
import type { EvalReport, GoldenTicket } from '../../scripts/eval/types';
import { ScriptedModelClient, modelResponse, textBlock } from './agent/scriptedClient';
import { loadArticles } from './kbLoader';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'T001',
  title: 'VPN keeps disconnecting',
  description: 'It drops.',
  expected_category: 'Network',
  expected_priority: 'medium',
  expected_group: 'Network Support',
  expected_action: 'propose',
  relevant_kb_ids: ['KB-006'],
  tags: ['clear'],
  ...overrides,
});

const escalation = (overrides: Record<string, unknown> = {}) =>
  row({
    expected_action: 'escalate',
    expected_reason: 'out_of_kb_scope',
    relevant_kb_ids: [],
    ...overrides,
  });

describe('validateGolden', () => {
  test('accepts a well-formed ticket to resolve, and one to escalate', () => {
    expect(validateGolden(row(), 1).id).toBe('T001');
    expect(validateGolden(escalation(), 1).expected_reason).toBe('out_of_kb_scope');
  });

  test.each([
    ['an id that is not T and three digits', { id: 'X1' }, /id must look like T001/],
    ['an empty title', { title: '' }, /title must be/],
    ['a title longer than a ticket allows', { title: 'x'.repeat(121) }, /title must be/],
    ['an empty description', { description: '' }, /description must be/],
    [
      'a description longer than a ticket allows',
      { description: 'x'.repeat(2001) },
      /description must be/,
    ],
    ['a category that does not exist', { expected_category: 'Endpoint' }, /not a category/],
    ['a priority that does not exist', { expected_priority: 'critical' }, /not a priority/],
    ['a group that does not exist', { expected_group: 'Everyone' }, /not an assignee group/],
    ['an action that is neither', { expected_action: 'ignore' }, /propose or escalate/],
    ['an article id that is not one', { relevant_kb_ids: ['KB-6'] }, /ids like KB-006/],
    ['tags that are not words', { tags: ['ok', 5] }, /tags must be/],
    ['a ticket to resolve with no article', { relevant_kb_ids: [] }, /must name the article/],
    [
      'a ticket to resolve with an escalation reason',
      { expected_reason: 'other' },
      /no escalation reason/,
    ],
    ['history that is not a list', { history: 'earlier' }, /history must be/],
    [
      'history with a status that does not exist',
      { history: [{ title: 't', status: 'done', category: 'Network' }] },
      /history must be/,
    ],
  ])('rejects %s', (_what, overrides, message) => {
    expect(() => validateGolden(row(overrides), 7)).toThrow(message);
  });

  test.each([
    [
      'a ticket to escalate that also names an article',
      { relevant_kb_ids: ['KB-006'] },
      /no article that resolves it/,
    ],
    [
      'a ticket to escalate with no reason',
      { expected_reason: undefined },
      /needs expected_reason/,
    ],
    [
      'a ticket to escalate with a reason that does not exist',
      { expected_reason: 'because' },
      /needs expected_reason/,
    ],
  ])('rejects %s', (_what, overrides, message) => {
    expect(() => validateGolden(escalation(overrides), 7)).toThrow(message);
  });

  test('a security ticket must be escalated, in the Security category, to the Security Team', () => {
    const security = (overrides: Record<string, unknown>) =>
      escalation({
        tags: ['security'],
        expected_category: 'Security',
        expected_group: 'Security Team',
        expected_reason: 'security_incident',
        ...overrides,
      });
    expect(() => validateGolden(security({}), 1)).not.toThrow();
    expect(() =>
      validateGolden(
        security({
          expected_action: 'propose',
          relevant_kb_ids: ['KB-029'],
          expected_reason: undefined,
        }),
        1
      )
    ).toThrow(/must be escalated/);
    expect(() => validateGolden(security({ expected_group: 'Help Desk' }), 1)).toThrow(
      /Security Team/
    );
    expect(() => validateGolden(security({ expected_category: 'Access' }), 1)).toThrow(
      /Security category/
    );
  });

  test('names the line and the ticket in every error, so a typo is easy to find', () => {
    expect(() => validateGolden(row({ expected_category: 'Nope' }), 12)).toThrow(
      /line 12 \(T001\)/
    );
    expect(() => validateGolden(null, 3)).toThrow(/line 3: not an object/);
    expect(() => validateGolden([], 3)).toThrow(/not an object/);
  });
});

describe('parseTickets', () => {
  test('reads one ticket to a line, skipping blank lines and Windows line endings', () => {
    const text = `${JSON.stringify(row())}\r\n\r\n${JSON.stringify(row({ id: 'T002' }))}\n`;
    expect(parseTickets(text).map((t) => t.id)).toEqual(['T001', 'T002']);
  });

  test('refuses a line that is not JSON, naming it', () => {
    expect(() => parseTickets(`${JSON.stringify(row())}\n{not json`)).toThrow(
      /line 2: not valid JSON/
    );
  });

  test('names the line a bad ticket is on, counting from one', () => {
    const text = `${JSON.stringify(row())}

${JSON.stringify(row({ id: 'T002', expected_category: 'Nope' }))}`;
    expect(() => parseTickets(text)).toThrow(/line 3 \(T002\)/);
    expect(() => parseTickets(JSON.stringify(row({ expected_category: 'Nope' })))).toThrow(
      /line 1 \(T001\)/
    );
  });

  test('refuses an id used twice', () => {
    expect(() => parseTickets(`${JSON.stringify(row())}\n${JSON.stringify(row())}`)).toThrow(
      /T001 appears twice/
    );
  });

  test('an empty file is an empty set, not an error', () => {
    expect(parseTickets('')).toEqual([]);
    expect(parseTickets('\n\n')).toEqual([]);
  });
});

describe('selectTickets', () => {
  const all = ['T001', 'T002', 'T003', 'T004'].map((id, i) =>
    validateGolden(row({ id, tags: i % 2 === 0 ? ['a'] : ['b'] }), i + 1)
  );
  const ids = (list: GoldenTicket[]) => list.map((t) => t.id);

  test('the full set in dataset order, or the smoke set, or named ids', () => {
    expect(ids(selectTickets(all, { subset: 'full' }))).toEqual(['T001', 'T002', 'T003', 'T004']);
    expect(ids(selectTickets(all, { subset: 'smoke' }, ['T004', 'T002']))).toEqual([
      'T002',
      'T004',
    ]);
    expect(ids(selectTickets(all, { subset: 'full', ids: ['T003', 'T001'] }))).toEqual([
      'T001',
      'T003',
    ]);
  });

  test('named ids narrow the smoke set rather than replace it', () => {
    expect(
      ids(selectTickets(all, { subset: 'smoke', ids: ['T002', 'T003'] }, ['T001', 'T002']))
    ).toEqual(['T002']);
  });

  test('filters by tag and limits how many', () => {
    expect(ids(selectTickets(all, { subset: 'full', tags: ['b'] }))).toEqual(['T002', 'T004']);
    expect(ids(selectTickets(all, { subset: 'full', limit: 2 }))).toEqual(['T001', 'T002']);
    expect(ids(selectTickets(all, { subset: 'full', tags: ['a', 'b'], limit: 3 }))).toEqual([
      'T001',
      'T002',
      'T003',
    ]);
  });

  test('a ticket that is not in the set is an error, so a typo cannot quietly run nothing', () => {
    expect(() => selectTickets(all, { subset: 'full', ids: ['T999'] })).toThrow(/no ticket T999/);
    expect(() => selectTickets(all, { subset: 'smoke' }, ['T001', 'T999'])).toThrow(
      /no ticket T999/
    );
  });

  test('a tag nobody has selects nothing, which is not an error', () => {
    expect(selectTickets(all, { subset: 'full', tags: ['zzz'] })).toEqual([]);
  });
});

describe('the shipped golden set', () => {
  const tickets = loadTickets('eval/tickets.jsonl');
  const articles = new Map(loadArticles('kb').articles.map((a) => [a.articleId, a]));

  test('has 108 tickets, of both kinds', () => {
    expect(tickets).toHaveLength(108);
    expect(tickets.filter((t) => t.expected_action === 'propose')).toHaveLength(62);
    expect(tickets.filter((t) => t.expected_action === 'escalate')).toHaveLength(46);
  });

  test('every article it names exists in the knowledge base', () => {
    const missing = tickets.flatMap((t) =>
      t.relevant_kb_ids.filter((id) => !articles.has(id)).map((id) => `${t.id} -> ${id}`)
    );
    expect(missing).toEqual([]);
  });

  test('a ticket to resolve is in the category of the article that resolves it', () => {
    const mismatched = tickets
      .filter((t) => t.expected_action === 'propose')
      .filter((t) =>
        t.relevant_kb_ids.some((id) => articles.get(id)?.category !== t.expected_category)
      )
      .map((t) => t.id);
    expect(mismatched).toEqual([]);
  });

  test('has the hard cases the specification asks for', () => {
    const tagged = (tag: string) => tickets.filter((t) => t.tags.includes(tag));
    expect(tagged('security')).toHaveLength(16);
    expect(tagged('phishing-as-reset')).toHaveLength(1);
    expect(tagged('injection')).toHaveLength(6);
    for (const tag of [
      'multi-issue',
      'vague',
      'angry-user',
      'non-english',
      'duplicate',
      'kb-gap',
      'access-change',
      'hardware-damage',
    ]) {
      expect(tagged(tag).length, tag).toBeGreaterThanOrEqual(1);
    }
  });

  test('the duplicate has an earlier history to find', () => {
    const duplicate = tickets.find((t) => t.tags.includes('duplicate'));
    expect(duplicate?.history?.length).toBeGreaterThanOrEqual(2);
  });

  test('every category the agent can choose is the answer to at least one ticket', () => {
    const used = new Set(tickets.map((t) => t.expected_category));
    expect([...used].sort()).toEqual([
      'Access',
      'Email',
      'General Support',
      'Hardware',
      'Network',
      'Onboarding',
      'Security',
      'Software',
    ]);
  });

  test('no ticket’s text is a knowledge-base article’s title copied whole, which would make it too easy', () => {
    const titles = new Set([...articles.values()].map((a) => a.title.toLowerCase()));
    const copied = tickets
      .filter((t) => titles.has(t.title.toLowerCase()) && !t.tags.includes('duplicate'))
      .map((t) => t.id);
    // T001 is deliberately the plainest case, worded as the article is: it is the one allowed.
    expect(copied).toEqual(['T001']);
  });

  describe('the smoke set', () => {
    const smoke = loadSmokeIds('eval/smoke.json');
    const chosen = selectTickets(tickets, { subset: 'smoke' }, smoke);

    test('is about fifteen tickets, all real', () => {
      expect(smoke).toHaveLength(15);
      expect(chosen).toHaveLength(15);
    });

    test('is balanced on what matters: every security kind, both injections, and each hard case', () => {
      const has = (tag: string) => chosen.filter((t) => t.tags.includes(tag)).length;
      expect(has('security')).toBeGreaterThanOrEqual(4);
      expect(has('injection')).toBe(2);
      for (const tag of [
        'phishing-as-reset',
        'multi-issue',
        'vague',
        'angry-user',
        'kb-gap',
        'access-change',
      ]) {
        expect(has(tag), tag).toBeGreaterThanOrEqual(1);
      }
      expect(chosen.filter((t) => t.expected_action === 'propose').length).toBeGreaterThanOrEqual(
        4
      );
    });
  });

  test('a smoke file that is not a list of ids is refused', () => {
    expect(() => loadSmokeIds('eval/tickets.jsonl')).toThrow();
  });

  test.each([
    ['no ids at all', '{}'],
    ['ids that is one string', '{"ids":"T001"}'],
    ['ids that hold a number', '{"ids":["T001",2]}'],
  ])('a smoke file with %s says what it should be', (_what, body) => {
    const file = path.join(os.tmpdir(), `smoke-${process.pid}-${Math.random()}.json`);
    fs.writeFileSync(file, body);
    try {
      expect(() => loadSmokeIds(file)).toThrow(/must be \{ "ids"/);
    } finally {
      fs.rmSync(file);
    }
  });
});

describe('judgeGroundedness', () => {
  const input = {
    reply: 'Restart the router and reconnect the VPN.',
    articles: [{ id: 'KB-006', body: '1. Restart the router.\n2. Reconnect the VPN.' }],
  };
  const judge = async (text: string) => {
    const client = new ScriptedModelClient([modelResponse([textBlock(text)])]);
    return { result: await judgeGroundedness(client, 'claude-sonnet-5', input), client };
  };

  test('reads a grounded verdict', async () => {
    expect((await judge('{"grounded": true, "ungrounded_steps": []}')).result).toEqual({
      grounded: true,
      ungroundedSteps: [],
    });
  });

  test('reads an ungrounded verdict with the steps it found', async () => {
    const { result } = await judge(
      '{"grounded": false, "ungrounded_steps": ["Reinstall the client"]}'
    );
    expect(result).toEqual({ grounded: false, ungroundedSteps: ['Reinstall the client'] });
  });

  test('finds the JSON inside a sentence or a code fence', async () => {
    expect(
      (await judge('Here is my answer:\n```json\n{"grounded": true, "ungrounded_steps": []}\n```'))
        .result.grounded
    ).toBe(true);
  });

  test('cannot call a reply grounded while listing an ungrounded step', async () => {
    expect((await judge('{"grounded": true, "ungrounded_steps": ["Do X"]}')).result).toEqual({
      grounded: false,
      ungroundedSteps: ['Do X'],
    });
  });

  test.each([
    ['not JSON at all', 'I think it is fine.'],
    ['JSON without a verdict', '{"steps": []}'],
    ['a verdict that is not a boolean', '{"grounded": "yes"}'],
    ['broken JSON', '{"grounded": tru'],
    ['nothing', ''],
  ])('%s is not judged, rather than guessed at', async (_what, text) => {
    expect((await judge(text)).result).toEqual({ grounded: null, ungroundedSteps: [] });
  });

  test('ignores a list of steps that is not a list of text', async () => {
    expect(
      (await judge('{"grounded": false, "ungrounded_steps": [1, null, "Do X"]}')).result
        .ungroundedSteps
    ).toEqual(['Do X']);
  });

  test('sends the rubric, the reply and the full text of each cited article, and no tools', async () => {
    const { client } = await judge('{"grounded": true, "ungrounded_steps": []}');
    const request = client.requests[0]!;
    expect(request.system).toContain('grounded in the knowledge-base articles');
    expect(request.tools).toEqual([]);
    const message = request.messages[0]!.content as string;
    expect(message).toContain('Restart the router and reconnect the VPN.');
    expect(message).toContain('## KB-006');
    expect(message).toContain('2. Reconnect the VPN.');
  });
});

describe('the report', () => {
  const report = (overrides: Partial<EvalReport['meta']> = {}): EvalReport => ({
    meta: {
      date: '2026-09-25',
      source: 'live',
      measured: true,
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      dataset: { file: 'eval/tickets.jsonl', total: 50, run: 15, subset: 'smoke' },
      ...overrides,
    },
    summary: summarize([]),
    cases: [],
  });

  test('a measured run has no warning, and a run of the oracle says it is not a measurement', () => {
    expect(renderMarkdown(report())).not.toContain('not a measurement');
    expect(renderMarkdown(report({ source: 'offline-oracle', measured: false }))).toContain(
      'This is not a measurement of a model'
    );
  });

  test('says when a run was cut short, and why', () => {
    expect(renderMarkdown(report({ truncated: 'Stopped after 3 of 50 tickets.' }))).toContain(
      '**Cut short:** Stopped after 3 of 50 tickets.'
    );
  });

  test('names the model, prompt version and date, and says n/a for what was not measured', () => {
    const text = renderMarkdown(report());
    expect(text).toContain('# Evaluation: claude-sonnet-5, prompt triage.v1, 2026-09-25');
    expect(text).toContain('| Category accuracy | n/a |');
    expect(text).toContain('Tickets: 15 of 50 (smoke)');
  });

  test('makes the security count the one that stands out', () => {
    expect(renderMarkdown(report())).toMatch(
      /\*\*Security tickets missed\*\* \(must be 0\) \| \*\*0\*\* of 0/
    );
  });

  test('gives a row for the history and a line for the console', () => {
    expect(historyRow(report(), { note: 'first live run' })).toBe(
      '| 2026-09-25 | triage.v1 | claude-sonnet-5 | 15 | n/a | 0 of 0 | n/a | n/a | n/a | first live run |'
    );
    expect(summaryLine(summarize([]))).toContain('security missed 0/0');
  });
});
