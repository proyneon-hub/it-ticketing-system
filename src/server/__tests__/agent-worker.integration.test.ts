// The whole path, with only the model faked: a ticket is created through the API, the outbox hands
// the event to the worker, the worker mints a token and runs the real agent loop, and the agent
// reads through real HTTP to a real running copy of the app. What matters most:
//   - a ticket version is run at most once, however often the event arrives;
//   - shadow mode changes nothing about the ticket;
//   - every failure leaves the ticket with people, and is retried without duplicating anything;
//   - the kill switch and the cost cap stop the agent without a deploy.
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import request from 'supertest';
import { MAX_ATTEMPTS } from '../domain/outbox';
import app from '../app';
import { ScriptedModelClient, calls, toolUse, type ScriptStep } from '../agent/scriptedClient';
import { connectToDatabase } from '../db';
import { loadArticles } from '../kbLoader';
import AgentRun from '../models/AgentRun';
import AgentSettings from '../models/AgentSettings';
import AgentStep from '../models/AgentStep';
import Comment from '../models/Comment';
import KbArticle from '../models/KbArticle';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import type { ModelRequest } from '../agent/types';
import { verifyAccessToken } from '../security/accessToken';
import { updateSettings } from '../services/agentSettingsService';
import { AGENT_LOCK_MS, processAgentEvents } from '../services/agentWorkerService';
import { importArticles } from '../services/kbService';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let server: Server;
let baseUrl: string;

const HOUR = 60 * 60 * 1000;
const later = (hours: number) => new Date(Date.now() + hours * HOUR);

const AGENT_ENV_KEYS = [
  'AGENT_ENABLED',
  'AGENT_MODEL',
  'AGENT_DEFAULT_MODE',
  'AGENT_DAILY_COST_CAP_USD',
  'ANTHROPIC_API_KEY',
  'AGENT_MAX_STEPS',
  'VERCEL',
];

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
  tokens = await signInAll(app);
  await importArticles(loadArticles('kb').articles);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 300000);

afterAll(async () => {
  for (const key of AGENT_ENV_KEYS) delete process.env[key];
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  for (const key of AGENT_ENV_KEYS) delete process.env[key];
  process.env.AGENT_ENABLED = 'true';
  await Promise.all([
    Ticket.deleteMany({}),
    OutboxEvent.deleteMany({}),
    AgentRun.deleteMany({}),
    AgentStep.deleteMany({}),
    AgentSettings.deleteMany({}),
    Comment.deleteMany({}),
  ]);
});

const createTicket = async (body: Record<string, unknown> = {}) =>
  (
    await request(app)
      .post('/api/tickets')
      .set(bearer(tokens, 'user'))
      .send({
        title: 'VPN keeps disconnecting',
        description: 'The VPN drops every few minutes when I am on a call.',
        ...body,
      })
      .expect(201)
  ).body.ticket as { _id: string; __v: number; category: string };

const triage = (id: string, overrides: Record<string, unknown> = {}) => ({
  ticket_id: id,
  category: 'Network',
  priority: 'high',
  assignee_group: 'Network Support',
  reasoning_summary: 'A VPN problem.',
  ...overrides,
});

const proposal = (id: string) => ({
  ticket_id: id,
  reply_markdown: 'Try the numbered steps in the VPN article and reconnect.',
  cited_kb_ids: ['KB-006'],
  confidence: 'high',
  reasoning_summary: 'The article covers exactly this.',
});

const search = () => toolUse('search_kb', { query: 'vpn keeps disconnecting' });
const read = () => toolUse('get_kb_article', { kb_id: 'KB-006' });

// The usual successful run for a ticket: look, read, triage, propose.
const success = (id: string): ScriptStep[] => [
  calls(search()),
  calls(read()),
  calls(toolUse('set_triage', triage(id)), toolUse('propose_resolution', proposal(id))),
];

// The ticket a run is about, read from its own first message. A script written this way works for
// whichever ticket it is given, which matters when the run is not known in advance (two workers
// at once). `seen` collects the tickets in the order their runs really started.
const ticketOf = (request: ModelRequest): string =>
  /Your ticket id is ([a-f\d]{24})/.exec(request.messages[0]?.content as string)?.[1] as string;

const forWhicheverTicket = (seen: string[] = []): ScriptStep[] => [
  (request) => {
    seen.push(ticketOf(request));
    return calls(search());
  },
  calls(read()),
  (request) =>
    calls(
      toolUse('set_triage', triage(ticketOf(request))),
      toolUse('propose_resolution', proposal(ticketOf(request)))
    ),
];

// A model that answers each run from the next script in the queue.
function models(...scripts: ScriptStep[][]) {
  const queue = [...scripts];
  const clients: ScriptedModelClient[] = [];
  return {
    clients,
    factory: () => {
      const script = queue.shift();
      if (!script) throw new Error('The model was asked for a run nobody scripted.');
      const client = new ScriptedModelClient(script);
      clients.push(client);
      return client;
    },
  };
}

const neverCalled = () => {
  throw new Error('The model must not be asked.');
};

const work = (factory: () => ScriptedModelClient, extra: Record<string, unknown> = {}) =>
  processAgentEvents({ modelClient: factory, baseUrl, ...extra });

const eventOf = (ticketId: string) =>
  OutboxEvent.findOne({ consumer: 'agent', 'payload.ticket.id': ticketId });

const snapshot = async (id: string) => {
  const ticket = await Ticket.findById(id).lean();
  return {
    version: ticket?.__v,
    status: ticket?.status,
    priority: ticket?.priority,
    category: ticket?.category,
    assignee: ticket?.assignee,
    activity: ticket?.activity.length,
    updatedAt: ticket?.updatedAt,
    comments: await Comment.countDocuments({ ticketId: id }),
  };
};

describe('a new ticket', () => {
  test('gets one run, recorded in shadow mode, and the ticket is left exactly as it was', async () => {
    const ticket = await createTicket();
    const before = await snapshot(ticket._id);
    const eventsBefore = await OutboxEvent.countDocuments();
    const { factory, clients } = models(success(ticket._id));

    const result = await work(factory);

    expect(result).toEqual({ configured: true, ran: 1, skipped: 0, failed: 0, more: false });

    const runs = await AgentRun.find().lean();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      ticketVersion: ticket.__v,
      idempotencyKey: `${ticket._id}:v${ticket.__v}`,
      mode: 'shadow',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'proposed',
      attempts: 1,
      steps: 3,
      triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
      proposal: { citedKbIds: ['KB-006'], confidence: 'high' },
    });
    expect(runs[0]?.intendedActions.map((a) => a.tool)).toEqual([
      'set_triage',
      'propose_resolution',
    ]);
    // (3 calls x 1000 input, 100 output) at $2 and $10 per million.
    expect(runs[0]?.costUsd).toBeCloseTo(0.009, 10);
    expect(runs[0]?.finishedAt).toBeInstanceOf(Date);

    // The event was consumed, and the agent wrote nothing: shadow mode changes nothing.
    expect((await eventOf(ticket._id))?.status).toBe('delivered');
    expect(await snapshot(ticket._id)).toEqual(before);
    expect(await OutboxEvent.countDocuments()).toBe(eventsBefore);

    // Every model call and tool call was recorded, in order.
    const steps = await AgentStep.find().sort({ index: 1 }).lean();
    expect(steps.map((s) => (s.kind === 'model' ? 'model' : s.toolName))).toEqual([
      'model',
      'search_kb',
      'model',
      'get_kb_article',
      'model',
      'set_triage',
      'propose_resolution',
    ]);
    expect(steps.every((s) => s.attempt === 1)).toBe(true);

    // The agent really read the article, over real HTTP with its own token.
    const article = clients[0]?.requests[2]?.messages.at(-1)?.content as { content: string }[];
    expect(article[0]?.content).toContain('Fully disconnect the VPN');
  });

  test('is read with a token that names this ticket and this run, and nothing else', async () => {
    const ticket = await createTicket();
    const seen: string[] = [];
    const spy: typeof fetch = async (input, init) => {
      seen.push((init?.headers as Record<string, string>).authorization ?? '');
      return fetch(input, init);
    };

    await work(models(success(ticket._id)).factory, { fetchImpl: spy });

    expect(seen.length).toBeGreaterThanOrEqual(4);
    const run = await AgentRun.findOne().lean();
    for (const header of seen) {
      const claims = await verifyAccessToken(header.replace('Bearer ', ''));
      expect(claims).toMatchObject({
        role: 'agent',
        ticketId: ticket._id,
        runId: String(run?._id),
      });
    }
    // One token for the whole run.
    expect(new Set(seen).size).toBe(1);
  });

  test('is not run again when its event arrives twice', async () => {
    const ticket = await createTicket();
    await work(models(success(ticket._id)).factory);
    const original = await eventOf(ticket._id).lean();

    // The same event delivered again (at-least-once delivery, or a re-queue).
    await OutboxEvent.create({
      type: 'ticket.created',
      consumer: 'agent',
      payload: original?.payload,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });

    const result = await work(neverCalled as never);

    expect(result).toMatchObject({ ran: 0, skipped: 1 });
    expect(await AgentRun.countDocuments()).toBe(1);
    expect(await OutboxEvent.countDocuments({ consumer: 'agent', status: 'delivered' })).toBe(2);
  });

  test('is run once even when two workers are running at the same moment', async () => {
    const first = await createTicket({ title: 'VPN drops one' });
    const second = await createTicket({ title: 'VPN drops two' });
    const seen: string[] = [];
    let modelsCreated = 0;
    // Every run gets a model that works for its own ticket, whichever worker claims it.
    const perRun = () => {
      modelsCreated += 1;
      return new ScriptedModelClient(forWhicheverTicket(seen));
    };

    const [a, b] = await Promise.all([work(perRun), work(perRun)]);

    // Each ticket was run exactly once between them, however the two divided the work.
    expect(a.ran + b.ran).toBe(2);
    expect(a.failed + b.failed).toBe(0);
    expect([...seen].sort()).toEqual([first._id, second._id].sort());
    expect(modelsCreated).toBe(2);
    expect(await AgentRun.countDocuments()).toBe(2);
    expect(await AgentRun.countDocuments({ attempts: 1, outcome: 'proposed' })).toBe(2);
    expect(await OutboxEvent.countDocuments({ consumer: 'agent', status: 'delivered' })).toBe(2);
  });

  test('is handled oldest first', async () => {
    const first = await createTicket({ title: 'VPN first' });
    const second = await createTicket({ title: 'VPN second' });
    const seen: string[] = [];

    await work(models(forWhicheverTicket(seen), forWhicheverTicket(seen)).factory);

    // The order the runs really happened in, not an order read back from timestamps.
    expect(seen).toEqual([first._id, second._id]);
  });

  test('each run is stamped with when it started, not when the job did', async () => {
    await createTicket({ title: 'VPN early' });
    await createTicket({ title: 'VPN late' });
    const slow: ScriptStep[] = [
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return calls(search());
      },
      calls(read()),
      (request) =>
        calls(
          toolUse('set_triage', triage(ticketOf(request))),
          toolUse('propose_resolution', proposal(ticketOf(request)))
        ),
    ];

    await work(models(slow, forWhicheverTicket()).factory);

    const [earlier, later] = await AgentRun.find().sort({ _id: 1 }).lean();
    expect(later?.startedAt.getTime()).toBeGreaterThan((earlier?.startedAt.getTime() ?? 0) + 40);
    expect(earlier?.finishedAt?.getTime()).toBeLessThanOrEqual(later?.startedAt.getTime() ?? 0);
  });

  test('that was deleted before the agent got to it needs no run, and the event is done with', async () => {
    const ticket = await createTicket();
    await Ticket.deleteOne({ _id: ticket._id });

    const result = await work(neverCalled as never);

    expect(result).toMatchObject({ ran: 0, skipped: 1, failed: 0 });
    expect(await AgentRun.countDocuments()).toBe(0);
    expect((await eventOf(ticket._id))?.status).toBe('delivered');
  });

  test('only an agent-enabled deployment records an event for it at all', async () => {
    delete process.env.AGENT_ENABLED;
    const ticket = await createTicket();
    expect(await eventOf(ticket._id)).toBeNull();
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });
});

describe('when a run fails', () => {
  test('the ticket is untouched, the run is marked as an error, and the event is put back to try later', async () => {
    const ticket = await createTicket();
    const before = await snapshot(ticket._id);

    const result = await work(
      () =>
        new ScriptedModelClient([
          () => {
            throw new Error('529 the API is overloaded');
          },
        ])
    );

    expect(result).toMatchObject({ ran: 0, failed: 1 });
    expect(await snapshot(ticket._id)).toEqual(before);

    const run = await AgentRun.findOne().lean();
    expect(run).toMatchObject({ outcome: 'error', attempts: 1 });
    expect(run?.outcomeReason).toContain('529 the API is overloaded');

    const event = await eventOf(ticket._id).lean();
    expect(event).toMatchObject({ status: 'pending', attempts: 1 });
    expect(event?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(event?.lastError).toContain('overloaded');
  });

  test('a retry takes over the same run, keeps the earlier steps, and finishes it', async () => {
    const ticket = await createTicket();
    // The first try gets as far as one lookup, then the model fails.
    await work(
      models([
        calls(search()),
        () => {
          throw new Error('connection reset');
        },
      ]).factory
    );

    // It is not due yet, so the next call does nothing.
    expect(await work(neverCalled as never)).toMatchObject({ ran: 0, failed: 0, skipped: 0 });

    const result = await work(models(success(ticket._id)).factory, { now: later(2) });

    expect(result).toMatchObject({ ran: 1, failed: 0 });
    const runs = await AgentRun.find().lean();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ outcome: 'proposed', attempts: 2 });
    expect(runs[0]?.outcomeReason).toBeUndefined();
    expect((await eventOf(ticket._id))?.status).toBe('delivered');

    // The first try's steps are still in the record, marked as attempt 1.
    const steps = await AgentStep.find().lean();
    expect(steps.filter((s) => s.attempt === 1).length).toBeGreaterThan(0);
    expect(steps.filter((s) => s.attempt === 2).length).toBeGreaterThan(0);
  });

  test('is given up on after the last attempt, and the event waits for an admin', async () => {
    const ticket = await createTicket();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const result = await work(
        () =>
          new ScriptedModelClient([
            () => {
              throw new Error(`failure ${attempt}`);
            },
          ]),
        { now: later(attempt * 2) }
      );
      expect(result.failed).toBe(1);
    }

    const event = await eventOf(ticket._id).lean();
    expect(event).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS });
    expect(event?.lastError).toContain(`failure ${MAX_ATTEMPTS}`);
    expect((await AgentRun.findOne().lean())?.outcome).toBe('error');

    // Nothing more happens by itself.
    expect(await work(neverCalled as never, { now: later(100) })).toMatchObject({
      ran: 0,
      failed: 0,
    });
  });

  test('a run whose worker died is taken over once the event lock has passed', async () => {
    const ticket = await createTicket();
    // A worker claimed the event and began the run, then died without finishing.
    const claimed = await OutboxEvent.findOneAndUpdate(
      { consumer: 'agent' },
      {
        $set: { status: 'sending', lockedUntil: new Date(Date.now() + AGENT_LOCK_MS) },
        $inc: { attempts: 1 },
      }
    );
    expect(claimed).toBeTruthy();
    await AgentRun.create({
      ticketId: ticket._id,
      ticketVersion: ticket.__v,
      idempotencyKey: `${ticket._id}:v${ticket.__v}`,
      mode: 'shadow',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'running',
      attempts: 1,
      startedAt: new Date(),
    });

    // Before the lock has passed the event cannot be claimed at all.
    expect(await work(neverCalled as never)).toMatchObject({ ran: 0 });

    // After it, the run is old enough to take over.
    const result = await work(models(success(ticket._id)).factory, {
      now: new Date(Date.now() + AGENT_LOCK_MS + 1000),
    });
    expect(result).toMatchObject({ ran: 1 });
    expect(await AgentRun.findOne().lean()).toMatchObject({ outcome: 'proposed', attempts: 2 });
  });
});

describe('stopping the agent', () => {
  test('the kill switch stops it at once, records that it did, and the model is never asked', async () => {
    const ticket = await createTicket();
    const before = await snapshot(ticket._id);
    await updateSettings({ killSwitch: true }, 'admin@demo.local');

    const result = await work(neverCalled as never);

    expect(result).toMatchObject({ ran: 0, skipped: 1, failed: 0 });
    expect(await AgentRun.findOne().lean()).toMatchObject({
      outcome: 'aborted',
      outcomeReason: 'kill_switch',
      steps: 0,
      costUsd: 0,
    });
    expect((await eventOf(ticket._id))?.status).toBe('delivered');
    expect(await snapshot(ticket._id)).toEqual(before);
  });

  test('turning it off again lets the next ticket through', async () => {
    await updateSettings({ killSwitch: true }, 'admin@demo.local');
    await createTicket({ title: 'VPN while off' });
    await work(neverCalled as never);

    await updateSettings({ killSwitch: false }, 'admin@demo.local');
    const next = await createTicket({ title: 'VPN once on' });
    const result = await work(models(success(next._id)).factory);
    expect(result.ran).toBe(1);
  });

  test('a category can be switched off on its own', async () => {
    await updateSettings({ modeByCategory: { Network: 'off' } }, 'admin@demo.local');
    const network = await createTicket({ category: 'Network' });
    const email = await createTicket({ category: 'Email', title: 'VPN and email' });

    const result = await work(models(success(email._id)).factory);

    expect(result).toMatchObject({ ran: 1, skipped: 1 });
    const runs = await AgentRun.find().lean();
    expect(runs.find((r) => String(r.ticketId) === network._id)).toMatchObject({
      outcome: 'aborted',
      outcomeReason: 'mode_off',
    });
    expect(runs.find((r) => String(r.ticketId) === email._id)?.outcome).toBe('proposed');
  });

  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'a requester cannot steer the mode by typing "%s" as the category: it gets the default',
    async (category) => {
      await updateSettings(
        { defaultMode: 'shadow', modeByCategory: { Network: 'off' } },
        'admin@demo.local'
      );
      const ticket = await createTicket({ category });
      const result = await work(models(success(ticket._id)).factory);

      expect(result).toMatchObject({ ran: 1, failed: 0 });
      expect(await AgentRun.findOne().lean()).toMatchObject({
        mode: 'shadow',
        outcome: 'proposed',
      });
    }
  );

  test('assist and auto are honoured as shadow until the agent can write, so nothing is changed', async () => {
    await updateSettings({ defaultMode: 'auto', autoAllowlist: ['Email'] }, 'admin@demo.local');
    const ticket = await createTicket({ category: 'Email' });
    const before = await snapshot(ticket._id);

    // Even a model that tries to post gets nowhere: posting is not enabled in a shadow run.
    const attempt: ScriptStep[] = [
      calls(read()),
      calls(
        toolUse('set_triage', triage(ticket._id, { category: 'Email' })),
        toolUse('post_resolution', proposal(ticket._id))
      ),
      calls(
        toolUse('escalate', {
          ticket_id: ticket._id,
          assignee_group: 'Help Desk',
          reason: 'other',
          summary: { reported: 'r', checked: 'c', ruled_out: 'n', why_escalating: 'w' },
        })
      ),
    ];
    const result = await work(models(attempt).factory);

    expect(result.ran).toBe(1);
    const run = await AgentRun.findOne().lean();
    expect(run).toMatchObject({ mode: 'shadow', outcome: 'escalated' });
    expect(run?.intendedActions.map((a) => a.tool)).not.toContain('post_resolution');
    expect(await snapshot(ticket._id)).toEqual(before);
  });

  test('stops at the daily cost cap, without asking the model, and says why', async () => {
    await updateSettings({ dailyCostCapUsd: 0.01 }, 'admin@demo.local');
    const ticket = await createTicket();
    await AgentRun.create({
      ticketId: new mongoose.Types.ObjectId(),
      ticketVersion: 0,
      idempotencyKey: 'earlier:v0',
      mode: 'shadow',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'proposed',
      costUsd: 0.01,
      startedAt: new Date(),
    });

    const result = await work(neverCalled as never);

    expect(result).toMatchObject({ ran: 0, skipped: 1 });
    const run = await AgentRun.findOne({ ticketId: ticket._id }).lean();
    expect(run).toMatchObject({ outcome: 'aborted', outcomeReason: 'daily_cost_cap' });
  });

  test('a day’s cap counts only today: yesterday’s spending does not stop today’s runs', async () => {
    await updateSettings({ dailyCostCapUsd: 1 }, 'admin@demo.local');
    const ticket = await createTicket();
    const yesterday = new Date(Date.now() - 36 * HOUR);
    await AgentRun.create({
      ticketId: new mongoose.Types.ObjectId(),
      ticketVersion: 0,
      idempotencyKey: 'yesterday:v0',
      mode: 'shadow',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'proposed',
      costUsd: 500,
      startedAt: yesterday,
    });

    const result = await work(models(success(ticket._id)).factory);
    expect(result.ran).toBe(1);
  });

  test('a cap of zero means it never runs', async () => {
    await updateSettings({ dailyCostCapUsd: 0 }, 'admin@demo.local');
    await createTicket();
    expect(await work(neverCalled as never)).toMatchObject({ ran: 0, skipped: 1 });
  });
});

describe('when the agent cannot run', () => {
  test('it says so and claims nothing when it is switched off', async () => {
    const ticket = await createTicket();
    delete process.env.AGENT_ENABLED;

    const result = await work(neverCalled as never);

    expect(result).toEqual({
      configured: false,
      reason: 'disabled',
      ran: 0,
      skipped: 0,
      failed: 0,
      more: false,
    });
    expect((await eventOf(ticket._id))?.status).toBe('pending');
  });

  test('it says so and leaves the event for later when there is no API key', async () => {
    const ticket = await createTicket();
    const result = await processAgentEvents({ env: { AGENT_ENABLED: 'true' }, baseUrl });

    expect(result).toMatchObject({ configured: false, reason: 'no_api_key' });
    expect((await eventOf(ticket._id))?.status).toBe('pending');
    expect(await AgentRun.countDocuments()).toBe(0);
  });

  test('it refuses a model it has no price for, rather than record runs as free', async () => {
    const ticket = await createTicket();
    const result = await processAgentEvents({
      env: { AGENT_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-test', AGENT_MODEL: 'gpt-5' },
      baseUrl,
    });

    expect(result).toMatchObject({ configured: false, reason: 'bad_model' });
    expect((await eventOf(ticket._id))?.status).toBe('pending');
  });

  test('a model that is priced can be chosen', async () => {
    const ticket = await createTicket();
    await processAgentEvents({
      env: { AGENT_ENABLED: 'true', AGENT_MODEL: 'claude-haiku-4-5' },
      modelClient: models(success(ticket._id)).factory,
      baseUrl,
    });
    const run = await AgentRun.findOne().lean();
    expect(run?.model).toBe('claude-haiku-4-5');
    // The same three calls at the small model's prices: (3000 x $1 + 300 x $5) per million.
    expect(run?.costUsd).toBeCloseTo(0.0045, 10);
  });

  test('stops at its limit and says there is more', async () => {
    // Created one after another, so there is a clear oldest. (Which runs is not what is tested, so
    // the scripts work for any ticket.)
    for (const n of [1, 2, 3]) await createTicket({ title: `VPN ticket ${n}` });

    const first = await work(models(forWhicheverTicket(), forWhicheverTicket()).factory, {
      limit: 2,
    });

    expect(first).toMatchObject({ ran: 2, more: true });
    expect(await OutboxEvent.countDocuments({ consumer: 'agent', status: 'pending' })).toBe(1);

    const second = await work(models(forWhicheverTicket()).factory, { limit: 2 });
    expect(second).toMatchObject({ ran: 1, more: false });
    expect(await AgentRun.countDocuments()).toBe(3);
  });

  test('stops at its time budget', async () => {
    await createTicket({ title: 'VPN a' });
    await createTicket({ title: 'VPN b' });
    const result = await work(neverCalled as never, { budgetMs: 0 });
    expect(result).toMatchObject({ ran: 0, more: true });
  });
});

describe('the job endpoint', () => {
  test('needs the job secret', async () => {
    process.env.CRON_SECRET = 'a-long-enough-secret-for-the-agent-job-test';
    try {
      await request(app).post('/api/jobs/agent-runs').expect(401);
      await request(app)
        .post('/api/jobs/agent-runs')
        .set('Authorization', 'Bearer wrong')
        .expect(401);
    } finally {
      delete process.env.CRON_SECRET;
    }
    await request(app).post('/api/jobs/agent-runs').expect(503);
  });

  test('answers with what it did, and with the reason when it cannot run', async () => {
    process.env.CRON_SECRET = 'a-long-enough-secret-for-the-agent-job-test';
    try {
      const auth = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
      // Enabled but with no key: the real client is not used, and the job says why.
      const noKey = await request(app).post('/api/jobs/agent-runs').set(auth).expect(200);
      expect(noKey.body).toMatchObject({ configured: false, reason: 'no_api_key' });

      delete process.env.AGENT_ENABLED;
      const off = await request(app).post('/api/jobs/agent-runs').set(auth).expect(200);
      expect(off.body).toMatchObject({ configured: false, reason: 'disabled' });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
