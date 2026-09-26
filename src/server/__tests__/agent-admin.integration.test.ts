// The agent's settings and its record of runs, over HTTP. What matters most:
//   - only an admin can change the settings, every change is audited, and nothing unknown is accepted;
//   - the kill switch set here stops the agent on its very next step, with no deploy;
//   - the runs an admin reads carry what happened and what it cost, and never a ticket's text.
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
import AuditEvent from '../models/AuditEvent';
import KbArticle from '../models/KbArticle';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { issueServiceToken } from '../security/accessToken';
import { processAgentEvents } from '../services/agentWorkerService';
import { importArticles } from '../services/kbService';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let server: Server;
let baseUrl: string;

const AGENT_ENV_KEYS = ['AGENT_ENABLED', 'AGENT_DEFAULT_MODE', 'ANTHROPIC_API_KEY', 'AGENT_MODEL'];

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
    AuditEvent.init(),
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
  await Promise.all([
    Ticket.deleteMany({}),
    OutboxEvent.deleteMany({}),
    AgentRun.deleteMany({}),
    AgentStep.deleteMany({}),
    AgentSettings.deleteMany({}),
    AuditEvent.deleteMany({ type: 'agent_settings_changed' }),
  ]);
});

const put = (body: unknown, who: 'admin' | 'tech' | 'user' = 'admin') =>
  request(app)
    .put('/api/agent/settings')
    .set(bearer(tokens, who))
    .send(body as object);

describe('GET /agent/settings', () => {
  test('shows staff what the agent may do, what it has spent, and whether it is on', async () => {
    const response = await request(app).get('/api/agent/settings').set(bearer(tokens, 'tech'));
    expect(response.status).toBe(200);
    expect(response.body.settings).toEqual({
      killSwitch: false,
      defaultMode: 'shadow',
      modeByCategory: {},
      autoAllowlist: [],
      dailyCostCapUsd: 1,
      perRequesterHourlyLimit: 5,
      enabled: false,
      model: 'claude-sonnet-5',
      spentTodayUsd: 0,
      autoAvailable: true,
      circuit: { open: false, consecutiveFailures: 0 },
    });
  });

  test('says it is on only when it is enabled and has a key to use', async () => {
    process.env.AGENT_ENABLED = 'true';
    const get = async () =>
      (await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'))).body.settings
        .enabled;
    expect(await get()).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(await get()).toBe(true);
    process.env.AGENT_MODEL = 'claude-haiku-4-5';
    expect(
      (await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'))).body.settings
        .model
    ).toBe('claude-haiku-4-5');
  });

  test('adds up what the day’s runs cost', async () => {
    await AgentRun.create({
      ticketId: new mongoose.Types.ObjectId(),
      ticketVersion: 0,
      idempotencyKey: 'a:v0',
      mode: 'assist',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'proposed',
      costUsd: 0.0123,
      startedAt: new Date(),
    });
    const response = await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'));
    expect(response.body.settings.spentTodayUsd).toBeCloseTo(0.0123, 6);
  });

  test.each([
    ['a requester', 'user', 403],
    ['nobody', undefined, 401],
  ])('is refused to %s', async (_who, account, status) => {
    const req = request(app).get('/api/agent/settings');
    if (account) req.set(bearer(tokens, account as 'user'));
    expect((await req).status).toBe(status);
  });

  test('is refused to the agent itself', async () => {
    const token = await issueServiceToken({
      ticketId: String(new mongoose.Types.ObjectId()),
      runId: String(new mongoose.Types.ObjectId()),
    });
    const response = await request(app)
      .get('/api/agent/settings')
      .set({ Authorization: `Bearer ${token}` });
    expect(response.status).toBe(403);
  });
});

describe('PUT /agent/settings', () => {
  test('changes only what is sent, and returns the settings as they now are', async () => {
    await put({ defaultMode: 'assist', dailyCostCapUsd: 2.5 }).expect(200);
    const response = await put({ perRequesterHourlyLimit: 3, killSwitch: true });
    expect(response.status).toBe(200);
    expect(response.body.settings).toMatchObject({
      defaultMode: 'assist',
      dailyCostCapUsd: 2.5,
      perRequesterHourlyLimit: 3,
      killSwitch: true,
    });
  });

  test('takes per-category modes and the allowlist', async () => {
    const response = await put({
      modeByCategory: { Email: 'assist', Security: 'off' },
      autoAllowlist: ['Email'],
    });
    expect(response.body.settings).toMatchObject({
      modeByCategory: { Email: 'assist', Security: 'off' },
      autoAllowlist: ['Email'],
    });
  });

  test('records who changed what, in the audit log, and nothing that is a secret', async () => {
    await put({ killSwitch: true, defaultMode: 'off' }).expect(200);
    const events = await AuditEvent.find({ type: 'agent_settings_changed' }).lean();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'success',
      actor: { email: 'admin@demo.local', role: 'admin' },
      target: { type: 'agent_settings' },
    });
    expect(events[0]?.detail).toBe('killSwitch=true, defaultMode="off"');
  });

  test.each([
    ['a technician', 'tech'],
    ['a requester', 'user'],
  ])('is refused to %s, and nothing changes', async (_who, account) => {
    const response = await put({ killSwitch: true }, account as 'tech');
    expect(response.status).toBe(403);
    expect(await AgentSettings.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments({ type: 'agent_settings_changed' })).toBe(0);
  });

  test.each([
    ['nothing at all', {}],
    ['a setting that does not exist', { model: 'claude-haiku-4-5' }],
    ['a mode that is not one', { defaultMode: 'yolo' }],
    ['a mode for a category that is not one', { modeByCategory: { Nonsense: 'assist' } }],
    ['a category mode that is not one', { modeByCategory: { Email: 'yolo' } }],
    ['an allowlist naming a category that is not one', { autoAllowlist: ['Nonsense'] }],
    ['a negative cap', { dailyCostCapUsd: -1 }],
    ['a cap that is not a number', { dailyCostCapUsd: 'lots' }],
    ['a limit that is not whole', { perRequesterHourlyLimit: 1.5 }],
    ['a negative limit', { perRequesterHourlyLimit: -1 }],
    ['a switch that is not true or false', { killSwitch: 'yes' }],
  ])('refuses %s', async (_what, body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect(await AgentSettings.countDocuments()).toBe(0);
    expect(await AuditEvent.countDocuments({ type: 'agent_settings_changed' })).toBe(0);
  });

  test('the kill switch set here stops the agent on its next run, with no deploy', async () => {
    process.env.AGENT_ENABLED = 'true';
    await put({ defaultMode: 'assist' }).expect(200);
    await put({ killSwitch: true }).expect(200);
    await request(app)
      .post('/api/tickets')
      .set(bearer(tokens, 'user'))
      .send({ title: 'VPN keeps disconnecting', description: 'It drops.' })
      .expect(201);

    await processAgentEvents({
      modelClient: () => {
        throw new Error('The model must not be asked.');
      },
      baseUrl,
    });
    expect(await AgentRun.findOne()).toMatchObject({
      outcome: 'aborted',
      outcomeReason: 'kill_switch',
    });

    // Switched back on, the next ticket is run.
    await put({ killSwitch: false }).expect(200);
    const created = (
      await request(app)
        .post('/api/tickets')
        .set(bearer(tokens, 'user'))
        .send({ title: 'Wi-Fi keeps dropping', description: 'It drops.' })
        .expect(201)
    ).body.ticket as { _id: string };
    const script: ScriptStep[] = [
      calls(
        toolUse('set_triage', {
          ticket_id: created._id,
          category: 'Network',
          priority: 'medium',
          assignee_group: 'Network Support',
          reasoning_summary: 'Wi-Fi.',
        }),
        toolUse('escalate', {
          ticket_id: created._id,
          assignee_group: 'Network Support',
          reason: 'out_of_kb_scope',
          summary: { reported: 'r', checked: 'c', ruled_out: 'n', why_escalating: 'w' },
        })
      ),
    ];
    const result = await processAgentEvents({
      modelClient: () => new ScriptedModelClient(script),
      baseUrl,
    });
    expect(result.ran).toBe(1);
  });
});

describe('the runs', () => {
  const makeRun = (overrides: Record<string, unknown> = {}) =>
    AgentRun.create({
      ticketId: new mongoose.Types.ObjectId(),
      ticketVersion: 0,
      idempotencyKey: `k${new mongoose.Types.ObjectId()}:v0`,
      mode: 'assist',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'proposed',
      ticketNumber: 'TKT-0001',
      costUsd: 0.01,
      startedAt: new Date(),
      finishedAt: new Date(),
      proposal: {
        replyMarkdown: 'Reconnect the VPN.',
        citedKbIds: ['KB-006'],
        confidence: 'high',
        reasoningSummary: 'It fits.',
      },
      ...overrides,
    });

  test('are listed newest first, with what they cost and how they ended', async () => {
    await makeRun({ startedAt: new Date(Date.now() - 60_000), ticketNumber: 'TKT-0001' });
    await makeRun({ ticketNumber: 'TKT-0002', outcome: 'escalated', proposal: undefined });

    const response = await request(app).get('/api/agent/runs').set(bearer(tokens, 'admin'));
    expect(response.status).toBe(200);
    expect(response.body.runs.map((r: { ticketNumber: string }) => r.ticketNumber)).toEqual([
      'TKT-0002',
      'TKT-0001',
    ]);
    expect(response.body.runs[0]).toMatchObject({
      outcome: 'escalated',
      mode: 'assist',
      model: 'claude-sonnet-5',
      costUsd: 0.01,
      hasProposal: false,
    });
    expect(response.body.runs[1].hasProposal).toBe(true);
    expect(response.body.pagination).toEqual({ page: 1, limit: 25, total: 2, totalPages: 1 });
  });

  test('can be filtered by outcome and paged', async () => {
    for (let i = 0; i < 3; i += 1) await makeRun({ outcome: 'proposed' });
    await makeRun({ outcome: 'error', outcomeReason: 'boom' });

    const errors = await request(app)
      .get('/api/agent/runs?outcome=error')
      .set(bearer(tokens, 'admin'));
    expect(errors.body.runs).toHaveLength(1);
    expect(errors.body.runs[0].outcomeReason).toBe('boom');

    const page = await request(app)
      .get('/api/agent/runs?limit=2&page=2')
      .set(bearer(tokens, 'admin'));
    expect(page.body.runs).toHaveLength(2);
    expect(page.body.pagination).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });

    expect(
      (await request(app).get('/api/agent/runs?outcome=nope').set(bearer(tokens, 'admin'))).status
    ).toBe(400);
  });

  test('one run shows its proposal and its steps in order, and no ticket text', async () => {
    const run = await makeRun();
    await AgentStep.create([
      { runId: run._id, attempt: 1, index: 1, kind: 'tool', toolName: 'search_kb', latencyMs: 4 },
      {
        runId: run._id,
        attempt: 1,
        index: 0,
        kind: 'model',
        stopReason: 'tool_use',
        latencyMs: 900,
      },
    ]);
    const response = await request(app)
      .get(`/api/agent/runs/${run._id}`)
      .set(bearer(tokens, 'admin'));
    expect(response.status).toBe(200);
    expect(response.body.run.proposal.replyMarkdown).toBe('Reconnect the VPN.');
    expect(response.body.steps.map((s: { index: number }) => s.index)).toEqual([0, 1]);
    expect(JSON.stringify(response.body)).not.toMatch(/description/);
  });

  test.each([
    ['a technician', 'tech'],
    ['a requester', 'user'],
  ])('are not for %s', async (_who, account) => {
    const run = await makeRun();
    expect(
      (
        await request(app)
          .get('/api/agent/runs')
          .set(bearer(tokens, account as 'tech'))
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/agent/runs/${run._id}`)
          .set(bearer(tokens, account as 'tech'))
      ).status
    ).toBe(403);
  });

  test('a run that does not exist, or an id that is not one, is refused', async () => {
    expect(
      (
        await request(app)
          .get(`/api/agent/runs/${new mongoose.Types.ObjectId()}`)
          .set(bearer(tokens, 'admin'))
      ).status
    ).toBe(404);
    expect(
      (await request(app).get('/api/agent/runs/nope').set(bearer(tokens, 'admin'))).status
    ).toBe(400);
  });
});
