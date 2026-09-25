// What the agent leaves for the people who run it: metrics that describe it, and an id that links a
// ticket to the run and to every call the run made. Against the real app and database, with only the
// model faked. What matters most:
//   - the gauges are read from the database when Prometheus scrapes, so they are right whichever
//     process answers, and they follow what actually happened;
//   - the kill switch, the spend and the backlog can be seen without opening the admin page;
//   - one request id ties the request that made the ticket to the agent's run and its calls.
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { ScriptedModelClient, calls, toolUse, type ScriptStep } from '../agent/scriptedClient';
import { connectToDatabase } from '../db';
import { loadArticles } from '../kbLoader';
import AgentRun from '../models/AgentRun';
import AgentSettings from '../models/AgentSettings';
import AgentStep from '../models/AgentStep';
import KbArticle from '../models/KbArticle';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { updateSettings } from '../services/agentSettingsService';
import { processAgentEvents } from '../services/agentWorkerService';
import { importArticles } from '../services/kbService';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let server: Server;
let baseUrl: string;

const METRICS_TOKEN = 'a-long-metrics-token-of-at-least-32-characters';
const AGENT_ENV_KEYS = ['AGENT_ENABLED', 'METRICS_TOKEN', 'WEBHOOK_URL'];

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
  process.env.METRICS_TOKEN = METRICS_TOKEN;
  await Promise.all([
    Ticket.deleteMany({}),
    OutboxEvent.deleteMany({}),
    AgentRun.deleteMany({}),
    AgentStep.deleteMany({}),
    AgentSettings.deleteMany({}),
  ]);
  await updateSettings({ defaultMode: 'assist' }, 'admin@demo.local');
});

const scrape = async () =>
  (
    await request(app)
      .get('/api/metrics')
      .set('Authorization', `Bearer ${METRICS_TOKEN}`)
      .expect(200)
  ).text;

// The value of one sample, by metric name and the labels it must carry; undefined if there is none.
function sample(
  text: string,
  name: string,
  labels: Record<string, string> = {}
): number | undefined {
  const row = text.split('\n').find((line) => {
    if (line.startsWith('#')) return false;
    const [head] = line.split(' ');
    if (!head?.startsWith(name)) return false;
    if (head !== name && !head.startsWith(`${name}{`)) return false;
    return Object.entries(labels).every(([key, value]) => head.includes(`${key}="${value}"`));
  });
  return row ? Number(row.slice(row.lastIndexOf(' ') + 1)) : undefined;
}

const createTicket = async (
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) =>
  (
    await request(app)
      .post('/api/tickets')
      .set({ ...bearer(tokens, 'user'), ...headers })
      .send({
        title: 'VPN keeps disconnecting',
        description: 'The VPN drops every few minutes when I am on a call.',
        ...body,
      })
      .expect(201)
  ).body.ticket as { _id: string };

const proposing = (id: string): ScriptStep[] => [
  calls(toolUse('search_kb', { query: 'vpn keeps disconnecting' })),
  calls(toolUse('get_kb_article', { kb_id: 'KB-006' })),
  calls(
    toolUse('set_triage', {
      ticket_id: id,
      category: 'Network',
      priority: 'high',
      assignee_group: 'Network Support',
      reasoning_summary: 'A VPN problem.',
    }),
    toolUse('propose_resolution', {
      ticket_id: id,
      reply_markdown: 'Try the numbered steps in the VPN article and reconnect.',
      cited_kb_ids: ['KB-006'],
      confidence: 'high',
      reasoning_summary: 'The article covers exactly this.',
    })
  ),
];

const work = (script: ScriptStep[], extra: Record<string, unknown> = {}) =>
  processAgentEvents({ modelClient: () => new ScriptedModelClient(script), baseUrl, ...extra });

describe('what is read from the database when Prometheus scrapes', () => {
  test('starts at zero for what always has a value: the kill switch, the proposals and the backlog', async () => {
    const text = await scrape();
    expect(sample(text, 'agent_kill_switch')).toBe(0);
    for (const status of ['pending', 'approved', 'edited', 'rejected']) {
      expect(sample(text, 'agent_proposals', { status })).toBe(0);
    }
    for (const status of ['pending', 'sending', 'delivered', 'dead']) {
      expect(sample(text, 'agent_events', { status })).toBe(0);
    }
    expect(sample(text, 'agent_runs')).toBeUndefined();
  });

  test('follows a run: the event waits, then the run, the proposal and the spend appear', async () => {
    const ticket = await createTicket();
    expect(sample(await scrape(), 'agent_events', { status: 'pending' })).toBe(1);

    await work(proposing(ticket._id));

    const text = await scrape();
    expect(sample(text, 'agent_events', { status: 'pending' })).toBe(0);
    expect(sample(text, 'agent_events', { status: 'delivered' })).toBe(1);
    expect(
      sample(text, 'agent_runs', { mode: 'assist', outcome: 'proposed', model: 'claude-sonnet-5' })
    ).toBe(1);
    expect(sample(text, 'agent_proposals', { status: 'pending' })).toBe(1);
    expect(sample(text, 'agent_cost_usd_today', { model: 'claude-sonnet-5' })).toBeGreaterThan(0);
  });

  test('counts a decision on the proposal', async () => {
    const ticket = await createTicket();
    await work(proposing(ticket._id));
    await request(app)
      .post(`/api/tickets/${ticket._id}/proposal/approve`)
      .set(bearer(tokens, 'tech'))
      .send({})
      .expect(200);

    const text = await scrape();
    expect(sample(text, 'agent_proposals', { status: 'pending' })).toBe(0);
    expect(sample(text, 'agent_proposals', { status: 'approved' })).toBe(1);
  });

  test('shows the kill switch as it is set, at once', async () => {
    await updateSettings({ killSwitch: true }, 'admin@demo.local');
    expect(sample(await scrape(), 'agent_kill_switch')).toBe(1);
    await updateSettings({ killSwitch: false }, 'admin@demo.local');
    expect(sample(await scrape(), 'agent_kill_switch')).toBe(0);
  });

  test('counts runs that were stopped, by why, in the last day only', async () => {
    await updateSettings({ killSwitch: true }, 'admin@demo.local');
    await createTicket();
    await processAgentEvents({
      modelClient: () => {
        throw new Error('The model must not be asked.');
      },
      baseUrl,
    });
    // An old run is not counted.
    await AgentRun.create({
      ticketId: new mongoose.Types.ObjectId(),
      ticketVersion: 0,
      idempotencyKey: 'old:v0',
      mode: 'assist',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'proposed',
      costUsd: 0.5,
      startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });

    const text = await scrape();
    expect(sample(text, 'agent_runs', { outcome: 'aborted', mode: 'shadow' })).toBe(1);
    expect(sample(text, 'agent_runs', { outcome: 'proposed' })).toBeUndefined();
    // The three-day-old run's half dollar is not today's spend.
    expect(sample(text, 'agent_cost_usd_today', { model: 'claude-sonnet-5' })).toBe(0);
  });

  test('a dead event shows in the backlog', async () => {
    const ticket = await createTicket();
    await OutboxEvent.updateOne(
      { consumer: 'agent', 'payload.ticket.id': ticket._id },
      { status: 'dead' }
    );
    expect(sample(await scrape(), 'agent_events', { status: 'dead' })).toBe(1);
  });

  test('the webhook’s own gauge does not count the agent’s events', async () => {
    await createTicket();
    const text = await scrape();
    expect(sample(text, 'outbox_events', { status: 'pending' }) ?? 0).toBe(0);
    expect(sample(text, 'agent_events', { status: 'pending' })).toBe(1);
  });
});

describe('what this process saw', () => {
  test('counts tool calls by tool and whether they failed, tokens by kind, and the run’s duration', async () => {
    const before = await scrape();
    const ticket = await createTicket();
    const script: ScriptStep[] = [
      calls(toolUse('search_kb', { query: 'vpn' })),
      calls(toolUse('delete_everything', {})),
      ...proposing(ticket._id).slice(1),
    ];
    await work(script);

    const after = await scrape();
    const delta = (name: string, labels: Record<string, string>) =>
      (sample(after, name, labels) ?? 0) - (sample(before, name, labels) ?? 0);
    expect(delta('agent_tool_calls_total', { tool: 'search_kb', is_error: 'false' })).toBe(1);
    expect(delta('agent_tool_calls_total', { tool: 'delete_everything', is_error: 'true' })).toBe(
      1
    );
    expect(delta('agent_tool_calls_total', { tool: 'propose_resolution', is_error: 'false' })).toBe(
      1
    );
    expect(
      delta('agent_tokens_total', { model: 'claude-sonnet-5', direction: 'input' })
    ).toBeGreaterThan(0);
    expect(
      delta('agent_tokens_total', { model: 'claude-sonnet-5', direction: 'output' })
    ).toBeGreaterThan(0);
    expect(delta('agent_run_duration_seconds_count', { outcome: 'proposed', mode: 'assist' })).toBe(
      1
    );
  });
});

describe('one request id, from the ticket to the run and every call it made', () => {
  test('the id sent when the ticket was created is on the event, the run and the agent’s requests', async () => {
    const ticket = await createTicket({}, { 'x-request-id': 'trace-abc.123' });
    expect(await OutboxEvent.findOne({ consumer: 'agent' })).toMatchObject({
      requestId: 'trace-abc.123',
    });

    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get('x-request-id') ?? '(none)');
      return fetch(input, init);
    };
    await work(proposing(ticket._id), { fetchImpl });

    expect(await AgentRun.findOne()).toMatchObject({ requestId: 'trace-abc.123' });
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen)).toEqual(new Set(['trace-abc.123']));
  });

  test('a ticket made without one still gets an id, so the chain is never broken', async () => {
    const ticket = await createTicket();
    const event = await OutboxEvent.findOne({ consumer: 'agent' });
    expect(event?.requestId).toMatch(/^[\w.-]{1,64}$/);

    await work(proposing(ticket._id));
    expect((await AgentRun.findOne())?.requestId).toBe(event?.requestId);
  });

  test('a malformed id from the caller is replaced, not stored', async () => {
    await createTicket({}, { 'x-request-id': 'bad id with spaces & <script>' });
    const event = await OutboxEvent.findOne({ consumer: 'agent' });
    expect(event?.requestId).toMatch(/^[\w.-]{1,64}$/);
    expect(event?.requestId).not.toContain('script');
  });

  test('the id is not part of what the webhook is sent', async () => {
    process.env.WEBHOOK_URL = 'https://hooks.example.invalid/x';
    await createTicket({}, { 'x-request-id': 'trace-web-1' });
    const event = await OutboxEvent.findOne({ consumer: 'webhook' });
    expect(event?.requestId).toBe('trace-web-1');
    expect(JSON.stringify(event?.payload)).not.toContain('trace-web-1');
  });
});
