// The evaluation harness against the real pipeline: golden tickets created through the API, run by
// the real worker and loop, scored from the records they leave. Only the model is faked. This is what
// shows that the harness works, that every golden ticket can be answered through the real tools, and
// that the scoring separates a good agent from a bad one.
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { loadTickets } from '../../../scripts/eval/dataset';
import {
  alwaysEscalate,
  alwaysProposeVpn,
  oracleFor,
  oracleScript,
} from '../../../scripts/eval/oracle';
import { renderMarkdown } from '../../../scripts/eval/report';
import { runEvaluation } from '../../../scripts/eval/run';
import { summarize } from '../../../scripts/eval/score';
import type { EvalReport } from '../../../scripts/eval/types';
import { ScriptedModelClient, calls, modelResponse, toolUse } from '../agent/scriptedClient';
import app from '../app';
import { connectToDatabase } from '../db';
import { loadArticles } from '../kbLoader';
import AgentRun from '../models/AgentRun';
import AgentSettings from '../models/AgentSettings';
import AgentStep from '../models/AgentStep';
import Comment from '../models/Comment';
import KbArticle from '../models/KbArticle';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { importArticles } from '../services/kbService';
import { startTestDatabase, type TestDatabase } from './helpers';

let mongod: TestDatabase;
let server: Server;
let baseUrl: string;
let staffToken: string;

const golden = loadTickets('eval/tickets.jsonl');
const BIG = 300_000;

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Promise.all([
    Ticket.init(),
    OutboxEvent.init(),
    KbArticle.init(),
    AgentRun.init(),
    AgentStep.init(),
    AgentSettings.init(),
  ]);
  await importArticles(loadArticles('kb').articles);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'tech@demo.local', password: 'TechPass123!' }),
  });
  staffToken = ((await login.json()) as { token: string }).token;
}, BIG);

afterAll(async () => {
  delete process.env.AGENT_ENABLED;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Ticket.deleteMany({}),
    Comment.deleteMany({}),
    OutboxEvent.deleteMany({}),
    AgentRun.deleteMany({}),
    AgentStep.deleteMany({}),
  ]);
});

const evaluate = (
  tickets = golden,
  modelFor: Parameters<typeof runEvaluation>[0]['modelFor'] = ({ golden: g }) => oracleFor(g),
  extra: Partial<Parameters<typeof runEvaluation>[0]> = {}
) =>
  runEvaluation({
    tickets,
    baseUrl,
    staffToken,
    model: 'claude-sonnet-5',
    modelFor,
    ...extra,
  });

describe('the oracle, which answers from the answer key', () => {
  test(
    'scores every one of the 50 golden tickets perfectly, so each can be answered through the real tools',
    async () => {
      const { results, truncated } = await evaluate();
      const s = summarize(results);

      expect(truncated).toBeUndefined();
      expect(results).toHaveLength(50);
      // Nothing failed, and nothing was missed.
      expect(s.errors).toBe(0);
      const wrong = results.filter(
        (r) =>
          !r.score.actionOk || !r.score.categoryOk || !r.score.priorityExact || !r.score.groupOk
      );
      expect(wrong.map((r) => r.golden.id)).toEqual([]);

      expect(s.action.rate).toBe(1);
      expect(s.category.rate).toBe(1);
      expect(s.priorityExact.rate).toBe(1);
      expect(s.priorityWithinOne.rate).toBe(1);
      expect(s.group.rate).toBe(1);
      expect(s.escalation.precision.rate).toBe(1);
      expect(s.escalation.recall.rate).toBe(1);
      expect(s.security).toMatchObject({ n: 7, missed: 0, misrouted: 0 });
      expect(s.citationValidity).toMatchObject({ n: 29, hits: 29 });
      expect(s.injection).toMatchObject({ n: 2, violations: 0 });
      // Each escalation gave its expected reason.
      const reasons = results.filter((r) => r.score.reasonOk !== null);
      expect(reasons).toHaveLength(21);
      expect(reasons.every((r) => r.score.reasonOk === true)).toBe(true);
    },
    BIG
  );

  test(
    'leaves nothing behind: no tickets, comments or events remain between or after cases',
    async () => {
      await evaluate(golden.slice(0, 3));
      expect(await Ticket.countDocuments()).toBe(0);
      expect(await Comment.countDocuments()).toBe(0);
      expect(await OutboxEvent.countDocuments()).toBe(0);
      expect(await AgentRun.countDocuments()).toBe(0);
      // The knowledge base is not the harness's to remove.
      expect(await KbArticle.countDocuments()).toBeGreaterThan(20);
    },
    BIG
  );

  test(
    'reports the run’s own cost and latency, worked out from the tokens the model reported',
    async () => {
      const { results } = await evaluate([golden[0]!]);
      const run = results[0]!.run;
      // T001: search, read, then triage and propose = 3 model calls of 1000 in, 100 out, at $2 and $10.
      expect(run.steps).toBe(3);
      expect(run.costUsd).toBeCloseTo(0.009, 10);
      expect(run.inputTokens).toBe(3000);
      expect(run.model).toBe('claude-sonnet-5');
    },
    BIG
  );

  test(
    'writes a report that says, at the top, that it is not a measurement of a model',
    async () => {
      const { results } = await evaluate(golden.slice(0, 2));
      const report: EvalReport = {
        meta: {
          date: '2026-09-25',
          source: 'offline-oracle',
          measured: false,
          model: 'claude-sonnet-5',
          promptVersion: 'triage.v1',
          dataset: { file: 'eval/tickets.jsonl', total: 50, run: 2, subset: 'full' },
        },
        summary: summarize(results),
        cases: [],
      };
      const markdown = renderMarkdown(report);
      expect(markdown).toContain('This is not a measurement of a model');
      expect(markdown).toContain('offline oracle');
    },
    BIG
  );
});

describe('what each case sees', () => {
  test(
    'a requester’s earlier tickets are available to the agent, and no other case’s are',
    async () => {
      const angry = golden.find((g) => g.id === 'T047')!;
      expect(angry.history).toHaveLength(2);

      const seen: { open: { title: string }[]; recently_finished: { title: string }[] }[] = [];
      const model = () =>
        new ScriptedModelClient([
          calls(toolUse('get_requester_context', {})),
          (request) => {
            const last = request.messages.at(-1)?.content as { content: string }[];
            seen.push(JSON.parse(last[0]!.content));
            const id = /Your ticket id is ([a-f\d]{24})/.exec(
              request.messages[0]!.content as string
            )![1]!;
            return modelResponse([
              toolUse('set_triage', {
                ticket_id: id,
                category: 'Network',
                priority: 'high',
                assignee_group: 'Network Support',
                reasoning_summary: 'Repeat problem.',
              }),
              toolUse('escalate', {
                ticket_id: id,
                assignee_group: 'Network Support',
                reason: 'distressed_requester',
                summary: { reported: 'r', checked: 'c', ruled_out: 'n', why_escalating: 'w' },
              }),
            ]);
          },
        ]);

      // Run it after another case, to show that one's ticket is not visible to this one.
      await evaluate([golden[0]!, angry], () => model());

      // (The first case's model also asks, so look at the second.)
      const context = seen.at(-1)!;
      expect(context.open).toEqual([]);
      expect(context.recently_finished.map((t) => t.title).sort()).toEqual([
        'VPN dropped again during a call',
        'VPN keeps disconnecting',
      ]);
    },
    BIG
  );

  test(
    'the earlier tickets did not themselves get run by the agent',
    async () => {
      const { results } = await evaluate([golden.find((g) => g.id === 'T047')!]);
      // One case, one run: the two earlier tickets were created with the agent off.
      expect(results).toHaveLength(1);
      expect(results[0]!.run.steps).toBeGreaterThan(0);
    },
    BIG
  );
});

describe('two bad agents, to show that the scoring can tell good from bad', () => {
  test(
    'one that hands everything to Help Desk: security is routed wrongly, and most answers are wrong',
    async () => {
      const { results } = await evaluate(golden, () => new ScriptedModelClient(alwaysEscalate()));
      const s = summarize(results);

      // It escalated all 50, so 21 were right (escalations) and 29 were wrong (should have been resolved).
      expect(s.errors).toBe(0);
      expect(s.action).toMatchObject({ n: 50, hits: 21 });
      expect(s.escalation.recall.rate).toBe(1);
      expect(s.escalation.precision).toMatchObject({ n: 50, hits: 21 });
      // It never missed a security ticket, but sent every one of the 7 to the wrong group.
      expect(s.security).toMatchObject({ n: 7, missed: 0, misrouted: 7 });
      // "General Support / medium" is right only where the answer key says exactly that.
      expect(s.category.rate).toBeLessThan(0.1);
      expect(s.citationValidity.n).toBe(0);
    },
    BIG
  );

  test(
    'one that proposes the VPN article for everything: it misses every security ticket',
    async () => {
      const { results } = await evaluate(golden, () => new ScriptedModelClient(alwaysProposeVpn()));
      const s = summarize(results);

      // The check that must be zero is not: all 7 security tickets were "resolved" with the VPN article.
      expect(s.security).toMatchObject({ n: 7, missed: 7 });
      expect(s.security.recall.rate).toBe(0);
      expect(s.escalation.recall.rate).toBe(0);
      // Only the VPN tickets were cited validly (T001, T048), of 50 proposals.
      expect(s.citationValidity).toMatchObject({ n: 50, hits: 2 });
    },
    BIG
  );
});

describe('the run', () => {
  test(
    'stops, and says why, when its spending limit is reached',
    async () => {
      // Each oracle run costs about $0.009 to $0.012, so $0.02 allows two or three tickets.
      const { results, truncated } = await evaluate(golden, undefined, { maxCostUsd: 0.02 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThan(golden.length);
      expect(truncated).toMatch(/Stopped after \d+ of 50 tickets/);
      expect(truncated).toContain('$0.02');
    },
    BIG
  );

  test(
    'reports progress one line for each ticket',
    async () => {
      const lines: string[] = [];
      await evaluate(golden.slice(0, 3), undefined, { onProgress: (line) => lines.push(line) });
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatch(/^T001 ok\s+propose\s+Network\/medium/);
    },
    BIG
  );

  test(
    'grades proposed replies when asked, and skips escalations',
    async () => {
      const graded: string[] = [];
      const { results } = await evaluate(golden.slice(0, 30), undefined, {
        judge: async (run) => {
          graded.push(run.id);
          return {
            grounded: run.id !== 'T003',
            ungroundedSteps: run.id === 'T003' ? ['a step'] : [],
          };
        },
      });
      const s = summarize(results);
      expect(graded).toHaveLength(results.filter((r) => r.score.action === 'propose').length);
      expect(s.groundedness.n).toBe(graded.length);
      expect(s.groundedness.hits).toBe(graded.length - 1);
    },
    BIG
  );

  test(
    'a failing model is scored as an error and does not stop the run',
    async () => {
      const { results } = await evaluate(golden.slice(0, 3), ({ golden: g }) =>
        g.id === 'T002'
          ? new ScriptedModelClient([
              () => {
                throw new Error('529 overloaded');
              },
            ])
          : oracleFor(g)
      );
      expect(results.map((r) => r.score.errored)).toEqual([false, true, false]);
      expect(results[1]!.run.error).toContain('529 overloaded');
      expect(results[1]!.score.actionOk).toBe(false);
      expect(summarize(results).errors).toBe(1);
    },
    BIG
  );
});

describe('how the harness runs a case', () => {
  test(
    'gives every case its own requester',
    async () => {
      const seen: string[] = [];
      await evaluate(golden.slice(0, 2), undefined, {
        afterCase: async ({ ticketId }) => {
          seen.push((await Ticket.findById(ticketId).lean())!.requesterEmail);
        },
      });
      expect(seen).toEqual(['eval-t001@example.com', 'eval-t002@example.com']);
    },
    BIG
  );

  test(
    'calls afterCase once for each case, with the ticket and what the agent did',
    async () => {
      const seen: { id: string; ticketId: string; outcome: string }[] = [];
      await evaluate(golden.slice(0, 3), undefined, {
        afterCase: async ({ golden: g, ticketId, run }) => {
          seen.push({ id: g.id, ticketId, outcome: run.outcome });
        },
      });
      expect(seen.map((s) => s.id)).toEqual(['T001', 'T002', 'T003']);
      expect(new Set(seen.map((s) => s.ticketId)).size).toBe(3);
      expect(seen.every((s) => s.outcome !== 'none')).toBe(true);
    },
    BIG
  );

  test(
    'starts each case clean, even if something was left behind before the first',
    async () => {
      // A ticket raised earlier with the agent on leaves an event that would be picked up first.
      process.env.AGENT_ENABLED = 'true';
      await fetch(`${baseUrl}/api/tickets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${staffToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Left behind',
          description: 'From before.',
          requesterName: 'Someone',
          requesterEmail: 'left-behind@example.com',
        }),
      });
      expect(await OutboxEvent.countDocuments()).toBeGreaterThan(0);

      const { results } = await evaluate([golden[0]!]);
      expect(results[0]!.run.error).toBeUndefined();
      expect(results[0]!.score.actionOk).toBe(true);
      expect(await Ticket.countDocuments()).toBe(0);
    },
    BIG
  );

  test(
    'puts the agent switch back as it found it',
    async () => {
      process.env.AGENT_ENABLED = 'false';
      await evaluate([golden.find((g) => g.id === 'T047')!]);
      expect(process.env.AGENT_ENABLED).toBe('false');

      delete process.env.AGENT_ENABLED;
      await evaluate([golden[0]!]);
      expect(process.env.AGENT_ENABLED).toBeUndefined();
    },
    BIG
  );

  test(
    'is not held back by the real daily cost cap, only by its own limit',
    async () => {
      process.env.AGENT_DAILY_COST_CAP_USD = '0.0001';
      try {
        const { results } = await evaluate(golden.slice(0, 2));
        expect(results.map((r) => r.score.actionOk)).toEqual([true, true]);
        expect(results.every((r) => r.run.outcome !== 'none')).toBe(true);
      } finally {
        delete process.env.AGENT_DAILY_COST_CAP_USD;
      }
    },
    BIG
  );

  test(
    'walks an earlier ticket through each status it can have',
    async () => {
      const statuses = [
        'open',
        'assigned',
        'in-progress',
        'pending-user',
        'resolved',
        'closed',
      ] as const;
      const seen: string[][] = [];
      await evaluate(
        [
          {
            ...golden[0]!,
            history: statuses.map((status) => ({
              title: `Was ${status}`,
              status,
              category: 'Network',
            })),
          },
        ],
        undefined,
        {
          afterCase: async () => {
            const earlier = await Ticket.find({ title: /^Was / }).lean();
            seen.push(earlier.map((t) => `${t.title.replace('Was ', '')}=${t.status}`).sort());
          },
        }
      );
      expect(seen[0]).toEqual(statuses.map((s) => `${s}=${s}`).sort());
    },
    BIG
  );

  test(
    'reports each tool call the agent made, in order, and whether it failed',
    async () => {
      const { results } = await evaluate(
        [golden[0]!],
        ({ golden: g }) =>
          new ScriptedModelClient([calls(toolUse('delete_everything', {})), ...oracleScript(g)])
      );
      const toolCalls = results[0]!.run.toolCalls;
      expect(toolCalls[0]).toMatchObject({ tool: 'delete_everything', isError: true });
      expect(toolCalls[0]!.summary).toMatch(/^unknown_tool/);
      // Only tool calls, in the order made; the model's own turns are not among them.
      expect(toolCalls.map((c) => c.tool)).toEqual([
        'delete_everything',
        'search_kb',
        'get_kb_article',
        'set_triage',
        'propose_resolution',
      ]);
      expect(toolCalls.slice(1).every((c) => !c.isError)).toBe(true);
    },
    BIG
  );

  test(
    'says so when the worker recorded no run for a ticket',
    async () => {
      const spy = vi
        .spyOn(AgentRun, 'findOne')
        .mockReturnValueOnce({ lean: async () => null } as never);
      try {
        const { results } = await evaluate([golden[0]!]);
        expect(results[0]!.run.error).toMatch(/recorded no run/);
        expect(results[0]!.score.errored).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
    BIG
  );

  test(
    'stops before the first ticket if the limit is nothing',
    async () => {
      const { results, truncated } = await evaluate(golden, undefined, { maxCostUsd: 0 });
      expect(results).toEqual([]);
      expect(truncated).toMatch(/Stopped after 0 of 50/);
    },
    BIG
  );
});
