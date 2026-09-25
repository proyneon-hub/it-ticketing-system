// Auto mode and the circuit breaker, against the real app and database with only the model faked.
// What matters most:
//   - the agent answers a requester alone only where every rule allows it, and the SERVER enforces the
//     rules whatever the agent sends (a token that calls the endpoint directly gets nowhere it should not);
//   - an answer is given once, and is marked as nobody's review;
//   - where auto is not allowed a setting of auto runs as assist;
//   - a model that keeps failing is left alone for a while, and tickets go to people meanwhile.
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
import Comment from '../models/Comment';
import KbArticle from '../models/KbArticle';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { issueServiceToken } from '../security/accessToken';
import { postResolution } from '../services/agentResolutionService';
import { updateSettings } from '../services/agentSettingsService';
import { processAgentEvents } from '../services/agentWorkerService';
import { importArticles } from '../services/kbService';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let server: Server;
let baseUrl: string;

const ENV_KEYS = [
  'AGENT_ENABLED',
  'AGENT_DEFAULT_MODE',
  'VERCEL',
  'AGENT_ALLOW_AUTO',
  'AGENT_BREAKER_FAILURES',
  'AGENT_BREAKER_COOLDOWN_MS',
  'METRICS_TOKEN',
];
const REPLY = 'Try the numbered steps in the VPN article and reconnect.';

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
  for (const key of ENV_KEYS) delete process.env[key];
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.AGENT_ENABLED = 'true';
  await Promise.all([
    Ticket.deleteMany({}),
    OutboxEvent.deleteMany({}),
    AgentRun.deleteMany({}),
    AgentStep.deleteMany({}),
    AgentSettings.deleteMany({}),
    Comment.deleteMany({}),
  ]);
  // Auto for everything, and the agent may answer a Network ticket alone.
  await updateSettings(
    { defaultMode: 'auto', autoAllowlist: ['Network'], perRequesterHourlyLimit: 100 },
    'admin@demo.local'
  );
});

// --- Helpers ------------------------------------------------------------------------------

const createTicket = async (body: Record<string, unknown> = {}) =>
  (
    await request(app)
      .post('/api/tickets')
      .set(bearer(tokens, 'user'))
      .send({
        title: 'VPN keeps disconnecting',
        description: 'The VPN drops every few minutes when I am on a call.',
        category: 'Network',
        ...body,
      })
      .expect(201)
  ).body.ticket as { _id: string };

const triage = (id: string, overrides: Record<string, unknown> = {}) => ({
  ticket_id: id,
  category: 'Network',
  priority: 'high',
  assignee_group: 'Network Support',
  reasoning_summary: 'A VPN problem.',
  ...overrides,
});

const resolution = (id: string, overrides: Record<string, unknown> = {}) => ({
  ticket_id: id,
  reply_markdown: REPLY,
  cited_kb_ids: ['KB-006'],
  confidence: 'high',
  reasoning_summary: 'The article covers exactly this.',
  ...overrides,
});

const search = () => toolUse('search_kb', { query: 'vpn keeps disconnecting' });
const read = () => toolUse('get_kb_article', { kb_id: 'KB-006' });

// Look, read, triage, then answer alone; and, if the answer is refused, draft it instead.
const answering = (id: string, overrides: Record<string, unknown> = {}): ScriptStep[] => [
  calls(search()),
  calls(read()),
  calls(toolUse('set_triage', triage(id))),
  calls(toolUse('post_resolution', resolution(id, overrides))),
  calls(toolUse('propose_resolution', resolution(id, overrides))),
];

const work = (script: ScriptStep[], extra: Record<string, unknown> = {}) =>
  processAgentEvents({ modelClient: () => new ScriptedModelClient(script), baseUrl, ...extra });

const ticketOf = (id: string) => Ticket.findById(id).lean();
const commentsOf = (id: string) => Comment.find({ ticketId: id }).sort({ createdAt: 1 }).lean();

const tokenFor = async (ticketId: string) => ({
  Authorization: `Bearer ${await issueServiceToken({
    ticketId,
    runId: String(new mongoose.Types.ObjectId()),
  })}`,
});

const answerBody = (ticketId: string, overrides: Record<string, unknown> = {}) => ({
  ticketId,
  replyMarkdown: REPLY,
  citedKbIds: ['KB-006'],
  confidence: 'high',
  ...overrides,
});

const post = async (ticketId: string, overrides: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/agent/resolutions')
    .set(await tokenFor(ticketId))
    .send(answerBody(ticketId, overrides));

// --- Where the agent answers alone --------------------------------------------------------

describe('a new ticket in auto mode', () => {
  test('is answered by the agent alone, marked as nobody’s review, and the ticket waits for the requester', async () => {
    const created = await createTicket();
    const result = await work(answering(created._id));
    expect(result).toMatchObject({ ran: 1, failed: 0 });

    const run = await AgentRun.findOne().lean();
    expect(run).toMatchObject({ mode: 'auto', outcome: 'posted' });
    expect(run?.proposal).toMatchObject({ citedKbIds: ['KB-006'], confidence: 'high' });

    const ticket = await ticketOf(created._id);
    expect(ticket).toMatchObject({ status: 'pending-user', category: 'Network' });
    expect(ticket?.agent).toMatchObject({ triageSource: 'agent', proposalStatus: 'posted' });
    expect(ticket?.activity.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['agent_posted', 'status_changed'])
    );

    const [comment, ...rest] = await commentsOf(created._id);
    expect(rest).toEqual([]);
    expect(comment).toMatchObject({
      visibility: 'public',
      body: REPLY,
      source: 'agent',
      author: { name: 'Service Desk Agent', role: 'agent' },
    });
    expect(comment?.approvedBy).toBeUndefined();
  });

  test('the requester reads the reply, and answering puts the ticket back in work', async () => {
    const created = await createTicket();
    await work(answering(created._id));

    const thread = await request(app)
      .get(`/api/tickets/${created._id}/comments`)
      .set(bearer(tokens, 'user'));
    expect(thread.body.comments).toHaveLength(1);
    expect(thread.body.comments[0]).toMatchObject({ source: 'agent', body: REPLY });
    expect(thread.body.comments[0].approvedBy).toBeUndefined();

    const theirs = await request(app)
      .get(`/api/tickets/${created._id}`)
      .set(bearer(tokens, 'user'));
    expect(theirs.body.ticket.agent).toBeUndefined();

    await request(app)
      .post(`/api/tickets/${created._id}/comments`)
      .set(bearer(tokens, 'user'))
      .send({ body: 'That fixed it, thanks.' })
      .expect(201);
    expect((await ticketOf(created._id))?.status).toBe('in-progress');
  });

  test('staff can still read what it said, as "posted", and there is nothing to approve', async () => {
    const created = await createTicket();
    await work(answering(created._id));

    const view = await request(app)
      .get(`/api/tickets/${created._id}/proposal`)
      .set(bearer(tokens, 'tech'));
    expect(view.status).toBe(200);
    expect(view.body.proposal).toMatchObject({ status: 'posted' });
    expect(
      (
        await request(app)
          .post(`/api/tickets/${created._id}/proposal/approve`)
          .set(bearer(tokens, 'tech'))
          .send({})
      ).status
    ).toBe(409);
  });

  test('a category that is not on the list gets a drafted reply for a person instead', async () => {
    await updateSettings({ autoAllowlist: ['Email'] }, 'admin@demo.local');
    const created = await createTicket();
    await work(answering(created._id));

    expect(await AgentRun.findOne()).toMatchObject({ mode: 'auto', outcome: 'proposed' });
    expect(await commentsOf(created._id)).toEqual([]);
    expect((await ticketOf(created._id))?.agent?.proposalStatus).toBe('pending');
    const refused = await AgentStep.findOne({ toolName: 'post_resolution' }).lean();
    expect(refused).toMatchObject({ isError: true });
    expect(refused?.outputSummary).toMatch(/refused: Posting is not enabled for this category/);
  });

  test('medium confidence is drafted, not posted, and the server was never asked', async () => {
    const created = await createTicket();
    await work(answering(created._id, { confidence: 'medium' }));
    expect(await AgentRun.findOne()).toMatchObject({ outcome: 'proposed' });
    expect(await commentsOf(created._id)).toEqual([]);
    const step = await AgentStep.findOne({ toolName: 'post_resolution' }).lean();
    expect(step?.outputSummary).toMatch(/refused: Posting needs high confidence/);
  });

  test('a category whose own mode is assist is drafted, though it is on the list', async () => {
    await updateSettings({ modeByCategory: { Network: 'assist' } }, 'admin@demo.local');
    const created = await createTicket();
    await work(answering(created._id));
    // The ticket arrived as Network, so the whole run was assist: the tool refused it outright.
    expect(await AgentRun.findOne()).toMatchObject({ mode: 'assist', outcome: 'proposed' });
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('an answer to a ticket that arrived as another category is checked against the category the agent gave it', async () => {
    // It arrived as General Support (the default) and the agent moved it to Network, where auto is on.
    const created = await createTicket({ category: undefined });
    await work(answering(created._id));
    expect(await AgentRun.findOne()).toMatchObject({ outcome: 'posted' });

    // Where the category it gives is not on the list, the server refuses even though the run is auto.
    await updateSettings({ autoAllowlist: ['Access'] }, 'admin@demo.local');
    const second = await createTicket({ category: undefined, title: 'VPN drops again' });
    await work(answering(second._id));
    expect(await AgentRun.findOne({ ticketId: second._id })).toMatchObject({ outcome: 'proposed' });
  });
});

describe('where auto mode is not allowed', () => {
  test('on Vercel a setting of auto runs as assist, and the agent never posts', async () => {
    process.env.VERCEL = '1';
    const created = await createTicket();
    await work(answering(created._id));

    expect(await AgentRun.findOne()).toMatchObject({ mode: 'assist', outcome: 'proposed' });
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('the server refuses an answer there even from a token that asks directly', async () => {
    process.env.VERCEL = '1';
    const created = await createTicket();
    const response = await post(created._id);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/not available/);
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('the settings say whether auto is available, so the admin page can tell people', async () => {
    const read = async () =>
      (await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'))).body.settings
        .autoAvailable;
    expect(await read()).toBe(true);
    process.env.VERCEL = '1';
    expect(await read()).toBe(false);
    process.env.AGENT_ALLOW_AUTO = 'true';
    expect(await read()).toBe(true);
  });

  test('AGENT_ALLOW_AUTO=true allows it, and only exactly that', async () => {
    process.env.VERCEL = '1';
    process.env.AGENT_ALLOW_AUTO = 'yes';
    const first = await createTicket();
    expect((await post(first._id)).status).toBe(403);

    process.env.AGENT_ALLOW_AUTO = 'true';
    const second = await createTicket({ title: 'Second' });
    expect((await post(second._id)).status).toBe(201);
  });
});

// --- The server does not take the agent’s word for it -------------------------------------

describe('POST /agent/resolutions, called directly', () => {
  test('answers a ticket where every rule allows it', async () => {
    const created = await createTicket();
    const response = await post(created._id);
    expect(response.status).toBe(201);
    expect(response.body.ticket).toMatchObject({ status: 'pending-user' });
    expect(await commentsOf(created._id)).toHaveLength(1);
  });

  test('refuses while the kill switch is on, and changes nothing', async () => {
    await updateSettings({ killSwitch: true }, 'admin@demo.local');
    const created = await createTicket();
    const before = await ticketOf(created._id);
    const response = await post(created._id);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/stopped/);
    expect((await ticketOf(created._id))?.__v).toBe(before?.__v);
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test.each([
    ['medium confidence', { confidence: 'medium' }, /high confidence/],
    ['low confidence', { confidence: 'low' }, /high confidence/],
  ])('refuses %s', async (_what, overrides, message) => {
    const created = await createTicket();
    const response = await post(created._id, overrides);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(message);
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('refuses a Security ticket, even with Security on the list and in auto mode', async () => {
    await updateSettings({ autoAllowlist: ['Security'] }, 'admin@demo.local');
    const created = await createTicket({ category: 'Security' });
    const response = await post(created._id);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/never answers a Security ticket/);
  });

  test('refuses a category that is not on the list, or whose own mode is not auto', async () => {
    const other = await createTicket({ category: 'Email' });
    expect((await post(other._id)).status).toBe(403);

    await updateSettings(
      { autoAllowlist: ['Email'], modeByCategory: { Email: 'assist' } },
      'admin@demo.local'
    );
    expect((await post(other._id)).status).toBe(403);
    await updateSettings({ modeByCategory: { Email: 'shadow' } }, 'admin@demo.local');
    expect((await post(other._id)).status).toBe(403);
    await updateSettings({ modeByCategory: { Email: 'auto' } }, 'admin@demo.local');
    expect((await post(other._id)).status).toBe(201);
  });

  test('when the default is not auto, only a category set to auto and on the list may be answered', async () => {
    await updateSettings(
      { defaultMode: 'assist', modeByCategory: { Network: 'auto' } },
      'admin@demo.local'
    );
    const created = await createTicket();
    expect((await post(created._id)).status).toBe(201);
  });

  test('gives an answer once: the second is a conflict and nothing is posted again', async () => {
    const created = await createTicket();
    expect((await post(created._id)).status).toBe(201);
    const again = await post(created._id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE');
    expect(await commentsOf(created._id)).toHaveLength(1);
  });

  test('two answers at the same moment: one wins', async () => {
    const created = await createTicket();
    const [a, b] = await Promise.all([post(created._id), post(created._id)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await commentsOf(created._id)).toHaveLength(1);
  });

  test('refuses an answer to a finished ticket', async () => {
    const created = await createTicket();
    for (const status of ['in-progress', 'resolved']) {
      await request(app)
        .patch(`/api/tickets/${created._id}`)
        .set(bearer(tokens, 'tech'))
        .send({ status })
        .expect(200);
    }
    const response = await post(created._id);
    expect(response.status).toBe(409);
    expect((await ticketOf(created._id))?.status).toBe('resolved');
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('refuses to cite an article that does not exist, and posts nothing', async () => {
    const created = await createTicket();
    const response = await post(created._id, { citedKbIds: ['KB-006', 'KB-999'] });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/KB-999/);
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test.each([
    ['a reply that is too short', { replyMarkdown: 'Restart it.' }],
    ['a reply that is too long', { replyMarkdown: 'x'.repeat(2001) }],
    ['no citation', { citedKbIds: [] }],
    ['a citation that is not an id', { citedKbIds: ['vpn'] }],
    [
      'too many citations',
      { citedKbIds: ['KB-001', 'KB-002', 'KB-003', 'KB-004', 'KB-005', 'KB-006'] },
    ],
    ['a confidence that is not one', { confidence: 'certain' }],
  ])('refuses %s', async (_what, overrides) => {
    const created = await createTicket();
    expect((await post(created._id, overrides)).status).toBe(400);
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('is refused for any ticket but the one the token names', async () => {
    const own = await createTicket();
    const other = await createTicket({ title: 'Other' });
    const response = await request(app)
      .post('/api/agent/resolutions')
      .set(await tokenFor(own._id))
      .send(answerBody(other._id));
    expect(response.status).toBe(403);
    expect(await commentsOf(other._id)).toEqual([]);
  });

  test.each([
    ['a technician', 'tech'],
    ['an admin', 'admin'],
    ['a requester', 'user'],
  ])('is refused to %s: only the agent answers as the agent', async (_who, account) => {
    const created = await createTicket();
    const response = await request(app)
      .post('/api/agent/resolutions')
      .set(bearer(tokens, account as 'tech'))
      .send(answerBody(created._id));
    expect(response.status).toBe(403);
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('the service itself refuses anyone but the agent, whatever a route lets through', async () => {
    const created = await createTicket();
    for (const role of ['technician', 'admin', 'user'] as const) {
      await expect(
        postResolution(
          { sub: 'u', name: 'U', email: 'u@example.com', role, exp: 0 },
          {
            ticketId: created._id,
            replyMarkdown: REPLY,
            citedKbIds: ['KB-006'],
            confidence: 'high',
          }
        )
      ).rejects.toThrow(/Only the service desk agent/);
    }
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('tries again when it loses a race with an edit, and gives up after three', async () => {
    const created = await createTicket();
    const runId = String(new mongoose.Types.ObjectId());
    const agent = {
      sub: 'service-desk-agent',
      name: 'Service Desk Agent',
      email: 'agent@service.local',
      role: 'agent' as const,
      exp: 0,
      ticketId: created._id,
      runId,
    };
    const input = {
      ticketId: created._id,
      replyMarkdown: REPLY,
      citedKbIds: ['KB-006'],
      confidence: 'high' as const,
    };

    const once = vi.spyOn(Ticket, 'findOneAndUpdate').mockResolvedValueOnce(null);
    try {
      const ticket = await postResolution(agent, input);
      expect(ticket.status).toBe('pending-user');
      expect(once).toHaveBeenCalledTimes(2);
    } finally {
      once.mockRestore();
    }

    const other = await createTicket({ title: 'Second' });
    const losing = vi.spyOn(Ticket, 'findOneAndUpdate').mockResolvedValue(null);
    try {
      await expect(
        postResolution({ ...agent, ticketId: other._id }, { ...input, ticketId: other._id })
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
      expect(losing).toHaveBeenCalledTimes(3);
    } finally {
      losing.mockRestore();
    }
    expect(await commentsOf(other._id)).toEqual([]);
  });

  test('names each cited article once in the history, however often it was repeated', async () => {
    const created = await createTicket();
    await post(created._id, { citedKbIds: ['KB-006', 'KB-006', 'KB-006'] }).then((r) =>
      expect(r.status).toBe(201)
    );
    const entry = (await ticketOf(created._id))?.activity.find((a) => a.action === 'agent_posted');
    expect(entry?.detail).toBe('Answered without review (KB-006)');
  });

  test('is refused without a token', async () => {
    const created = await createTicket();
    expect(
      (await request(app).post('/api/agent/resolutions').send(answerBody(created._id))).status
    ).toBe(401);
  });
});

// --- The circuit breaker ------------------------------------------------------------------

describe('the circuit breaker', () => {
  const failing = () =>
    new ScriptedModelClient([
      () => {
        throw new Error('529 overloaded');
      },
    ]);
  const neverAsked = () => {
    throw new Error('The model must not be asked while the breaker is open.');
  };
  const scrape = async () => {
    process.env.METRICS_TOKEN = 'a-long-metrics-token-of-at-least-32-characters';
    return (
      await request(app)
        .get('/api/metrics')
        .set('Authorization', `Bearer ${process.env.METRICS_TOKEN}`)
        .expect(200)
    ).text;
  };

  async function failFive() {
    for (let i = 0; i < 5; i += 1) {
      await createTicket({ title: `Ticket ${i}` });
      const result = await processAgentEvents({ modelClient: failing, baseUrl, limit: 1 });
      expect(result.failed).toBe(1);
    }
  }

  test('opens after five failed runs in a row: the next ticket goes to people and the model is not asked', async () => {
    await failFive();
    const created = await createTicket({ title: 'The sixth' });
    const result = await processAgentEvents({ modelClient: neverAsked, baseUrl, limit: 10 });

    expect(result).toMatchObject({ ran: 0, failed: 0 });
    expect(await AgentRun.findOne({ ticketId: created._id })).toMatchObject({
      outcome: 'aborted',
      outcomeReason: 'circuit_open',
    });
    // The ticket is exactly as it was raised.
    expect(await ticketOf(created._id)).toMatchObject({
      category: 'Network',
      assignee: 'Unassigned',
    });
    expect((await ticketOf(created._id))?.agent).toBeUndefined();
  });

  test('says so on the settings, and in the metrics', async () => {
    const before = await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'));
    expect(before.body.settings.circuit).toEqual({ open: false, consecutiveFailures: 0 });
    expect(await scrape()).toMatch(/^agent_circuit_open 0$/m);

    await failFive();
    const after = await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'));
    expect(after.body.settings.circuit).toMatchObject({ open: true, consecutiveFailures: 5 });
    expect(new Date(after.body.settings.circuit.reopensAt).getTime()).toBeGreaterThan(Date.now());
    expect(await scrape()).toMatch(/^agent_circuit_open 1$/m);
  });

  test('stopped runs do not make it look better or worse: only real attempts count', async () => {
    await failFive();
    for (let i = 0; i < 3; i += 1) {
      await createTicket({ title: `Held ${i}` });
      await processAgentEvents({ modelClient: neverAsked, baseUrl, limit: 10 });
    }
    const settings = await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'));
    expect(settings.body.settings.circuit).toMatchObject({ open: true, consecutiveFailures: 5 });
    expect(await AgentRun.countDocuments({ outcomeReason: 'circuit_open' })).toBe(3);
  });

  // The failures were a while ago: the cooldown has passed, so the next run is a probe.
  const cooldownPassed = () =>
    AgentRun.updateMany({ outcome: 'error' }, { finishedAt: new Date(Date.now() - 11 * 60_000) });

  test('lets a run through after the cooldown, and closes when it works', async () => {
    await failFive();
    await cooldownPassed();
    const fresh = await createTicket({ title: 'After the cooldown' });
    const ticketOfRun = (request: { messages: { content: unknown }[] }) =>
      /Your ticket id is ([a-f\d]{24})/.exec(request.messages[0]?.content as string)?.[1] as string;

    const result = await processAgentEvents({
      modelClient: () =>
        new ScriptedModelClient([
          calls(search()),
          calls(read()),
          (req) =>
            calls(
              toolUse('set_triage', triage(ticketOfRun(req))),
              toolUse('propose_resolution', resolution(ticketOfRun(req)))
            ),
        ]),
      baseUrl,
      limit: 1,
    });
    expect(result).toMatchObject({ ran: 1, failed: 0 });
    expect(await AgentRun.findOne({ ticketId: fresh._id })).toMatchObject({ outcome: 'proposed' });

    const settings = await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'));
    expect(settings.body.settings.circuit).toEqual({ open: false, consecutiveFailures: 0 });
  });

  test('a probe that fails after the cooldown opens it again, and the next ticket is held', async () => {
    await failFive();
    await cooldownPassed();
    await createTicket({ title: 'Probe' });
    const probe = await processAgentEvents({ modelClient: failing, baseUrl, limit: 1 });
    expect(probe.failed).toBe(1);

    await createTicket({ title: 'Held after the probe' });
    const held = await processAgentEvents({ modelClient: neverAsked, baseUrl, limit: 10 });
    expect(held).toMatchObject({ ran: 0, failed: 0 });
    expect(await AgentRun.countDocuments({ outcomeReason: 'circuit_open' })).toBe(1);
    const settings = await request(app).get('/api/agent/settings').set(bearer(tokens, 'admin'));
    expect(settings.body.settings.circuit).toMatchObject({ open: true, consecutiveFailures: 5 });
  });

  test('the limits come from the environment', async () => {
    process.env.AGENT_BREAKER_FAILURES = '2';
    for (let i = 0; i < 2; i += 1) {
      await createTicket({ title: `Ticket ${i}` });
      await processAgentEvents({ modelClient: failing, baseUrl, limit: 1 });
    }
    await createTicket({ title: 'Held' });
    await processAgentEvents({ modelClient: neverAsked, baseUrl, limit: 10 });
    expect(await AgentRun.countDocuments({ outcomeReason: 'circuit_open' })).toBe(1);
  });
});
