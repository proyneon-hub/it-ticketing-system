// Assist mode, against the real app and database with only the model faked. The agent triages the
// ticket for real (through the API, with its own token), drafts a reply that nobody can see yet, and
// a person approves, edits or rejects it. What matters most:
//   - the agent's triage and its handover are real writes, made through the same rules as a person's;
//   - a draft reaches the requester only through a person, once, and marked as the agent's;
//   - two people deciding at once cannot both win, and a decision on a ticket that has moved is refused;
//   - a person editing the ticket while the agent works makes the agent step back;
//   - requesters never see what the agent did behind the scenes.
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
import { updateSettings } from '../services/agentSettingsService';
import { processAgentEvents } from '../services/agentWorkerService';
import { importArticles } from '../services/kbService';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let server: Server;
let baseUrl: string;

const AGENT_ENV_KEYS = ['AGENT_ENABLED', 'AGENT_DEFAULT_MODE', 'AGENT_DAILY_COST_CAP_USD'];

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
  await updateSettings({ defaultMode: 'assist' }, 'admin@demo.local');
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
        ...body,
      })
      .expect(201)
  ).body.ticket as { _id: string; __v: number };

const triage = (id: string, overrides: Record<string, unknown> = {}) => ({
  ticket_id: id,
  category: 'Network',
  priority: 'high',
  assignee_group: 'Network Support',
  reasoning_summary: 'A VPN problem.',
  ...overrides,
});

const proposal = (id: string, overrides: Record<string, unknown> = {}) => ({
  ticket_id: id,
  reply_markdown: 'Try the numbered steps in the VPN article and reconnect.',
  cited_kb_ids: ['KB-006'],
  confidence: 'high',
  reasoning_summary: 'The article covers exactly this.',
  ...overrides,
});

const escalation = (id: string, overrides: Record<string, unknown> = {}) => ({
  ticket_id: id,
  assignee_group: 'Security Team',
  reason: 'security_incident',
  summary: {
    reported: 'A suspicious email.',
    checked: 'The knowledge base.',
    ruled_out: 'Nothing.',
    why_escalating: 'A phishing report.',
  },
  ...overrides,
});

const search = () => toolUse('search_kb', { query: 'vpn keeps disconnecting' });
const read = () => toolUse('get_kb_article', { kb_id: 'KB-006' });

const proposing = (id: string): ScriptStep[] => [
  calls(search()),
  calls(read()),
  calls(toolUse('set_triage', triage(id)), toolUse('propose_resolution', proposal(id))),
];

const escalating = (id: string): ScriptStep[] => [
  calls(search()),
  calls(
    toolUse('set_triage', triage(id, { category: 'Security', assignee_group: 'Security Team' })),
    toolUse('escalate', escalation(id))
  ),
];

const model = (script: ScriptStep[]) => () => new ScriptedModelClient(script);

const work = (script: ScriptStep[], extra: Record<string, unknown> = {}) =>
  processAgentEvents({ modelClient: model(script), baseUrl, ...extra });

// One ticket, with the agent having proposed a reply for it.
async function proposed(body: Record<string, unknown> = {}) {
  const ticket = await createTicket(body);
  await work(proposing(ticket._id));
  return ticket;
}

const ticketOf = (id: string) => Ticket.findById(id).lean();
const commentsOf = (id: string) => Comment.find({ ticketId: id }).sort({ createdAt: 1 }).lean();

const decide = (
  id: string,
  action: 'approve' | 'reject',
  who: 'tech' | 'admin' | 'user',
  body = {}
) => request(app).post(`/api/tickets/${id}/proposal/${action}`).set(bearer(tokens, who)).send(body);

// --- The agent's own writes ---------------------------------------------------------------

describe('a new ticket in assist mode', () => {
  test('is triaged for real, and the reply is drafted and held for a person', async () => {
    const created = await createTicket();
    const result = await work(proposing(created._id));

    expect(result).toEqual({ configured: true, ran: 1, skipped: 0, failed: 0, more: false });

    const ticket = await ticketOf(created._id);
    expect(ticket).toMatchObject({
      category: 'Network',
      priority: 'high',
      assignee: 'Network Support',
      status: 'open',
    });
    expect(ticket?.agent).toMatchObject({ triageSource: 'agent', proposalStatus: 'pending' });

    const run = await AgentRun.findOne().lean();
    expect(run).toMatchObject({
      mode: 'assist',
      outcome: 'proposed',
      requesterEmail: 'user@demo.local',
    });
    expect(String(ticket?.agent?.lastRunId)).toBe(String(run?._id));
    // What it "would have" done is only recorded in shadow mode.
    expect(run?.intendedActions).toEqual([]);

    // The reply is not on the ticket: nobody has approved it.
    expect(await commentsOf(created._id)).toEqual([]);
    const actors = ticket?.activity.map((entry) => `${entry.action}:${entry.actorRole}`);
    expect(actors).toContain('priority_changed:agent');
    expect(actors).toContain('agent_proposed:agent');
  });

  test('the requester sees none of it: no agent field, no internal history', async () => {
    const created = await proposed();

    const asRequester = await request(app)
      .get(`/api/tickets/${created._id}`)
      .set(bearer(tokens, 'user'));
    expect(asRequester.body.ticket.agent).toBeUndefined();
    const seen = asRequester.body.ticket.activity.map((e: { action: string }) => e.action);
    expect(seen).not.toContain('agent_proposed');

    const asStaff = await request(app)
      .get(`/api/tickets/${created._id}`)
      .set(bearer(tokens, 'tech'));
    expect(asStaff.body.ticket.agent).toMatchObject({
      triageSource: 'agent',
      proposalStatus: 'pending',
    });
    expect(asStaff.body.ticket.activity.map((e: { action: string }) => e.action)).toContain(
      'agent_proposed'
    );
  });

  test('an escalation is a real handover: assigned, with the summary as an internal note', async () => {
    const created = await createTicket();
    await work(escalating(created._id));

    const ticket = await ticketOf(created._id);
    expect(ticket).toMatchObject({
      assignee: 'Security Team',
      status: 'assigned',
      category: 'Security',
    });
    expect(ticket?.agent).toMatchObject({ triageSource: 'agent' });
    expect(ticket?.agent?.proposalStatus).toBeUndefined();

    const [note, ...rest] = await commentsOf(created._id);
    expect(rest).toEqual([]);
    expect(note).toMatchObject({ visibility: 'internal', source: 'agent' });
    expect(note?.author.role).toBe('agent');
    expect(note?.body).toContain('security_incident');
    expect(note?.body).toContain('Why escalating: A phishing report.');
    expect(await AgentRun.findOne()).toMatchObject({ mode: 'assist', outcome: 'escalated' });

    // The requester cannot read the note, or see that it exists.
    const asRequester = await request(app)
      .get(`/api/tickets/${created._id}/comments`)
      .set(bearer(tokens, 'user'));
    expect(asRequester.body.comments).toEqual([]);
    const asStaff = await request(app)
      .get(`/api/tickets/${created._id}/comments`)
      .set(bearer(tokens, 'tech'));
    expect(asStaff.body.comments).toHaveLength(1);
  });

  test('a ticket somebody has already assigned keeps its owner', async () => {
    const created = await createTicket();
    await request(app)
      .patch(`/api/tickets/${created._id}`)
      .set(bearer(tokens, 'tech'))
      .send({ assignee: 'Alex Technician', status: 'assigned' })
      .expect(200);

    await work(proposing(created._id));
    const ticket = await ticketOf(created._id);
    expect(ticket?.assignee).toBe('Alex Technician');
    expect(ticket).toMatchObject({ category: 'Network', priority: 'high' });
  });

  test('a person who changes the triage afterwards becomes its author', async () => {
    const created = await proposed();
    await request(app)
      .patch(`/api/tickets/${created._id}`)
      .set(bearer(tokens, 'tech'))
      .send({ priority: 'urgent' })
      .expect(200);
    expect((await ticketOf(created._id))?.agent).toMatchObject({
      triageSource: 'human',
      proposalStatus: 'pending',
    });

    // A change that is not triage leaves it as it was.
    const second = await proposed();
    await request(app)
      .patch(`/api/tickets/${second._id}`)
      .set(bearer(tokens, 'tech'))
      .send({ status: 'in-progress' })
      .expect(200);
    expect((await ticketOf(second._id))?.agent?.triageSource).toBe('agent');
  });

  test('a setting of auto runs as assist, and posting is refused', async () => {
    await updateSettings({ defaultMode: 'auto', autoAllowlist: ['Network'] }, 'admin@demo.local');
    const created = await createTicket();
    const script: ScriptStep[] = [
      calls(search()),
      calls(read()),
      calls(toolUse('set_triage', triage(created._id))),
      calls(toolUse('post_resolution', proposal(created._id))),
      calls(toolUse('propose_resolution', proposal(created._id))),
    ];
    await work(script);

    expect(await AgentRun.findOne()).toMatchObject({ mode: 'assist', outcome: 'proposed' });
    expect(await commentsOf(created._id)).toEqual([]);
    const refused = await AgentStep.findOne({ toolName: 'post_resolution' }).lean();
    expect(refused?.outputSummary).toMatch(/not_allowed/);
  });
});

// --- Deciding on a proposal ---------------------------------------------------------------

describe('reading the proposal', () => {
  test('staff see the reply, its sources, the confidence and the triage', async () => {
    const created = await proposed();
    const response = await request(app)
      .get(`/api/tickets/${created._id}/proposal`)
      .set(bearer(tokens, 'tech'));

    expect(response.status).toBe(200);
    expect(response.body.proposal).toMatchObject({
      status: 'pending',
      proposal: {
        replyMarkdown: 'Try the numbered steps in the VPN article and reconnect.',
        citedKbIds: ['KB-006'],
        confidence: 'high',
      },
      triage: { category: 'Network', priority: 'high', assigneeGroup: 'Network Support' },
    });
    expect(response.body.proposal.citedArticles).toEqual([
      { id: 'KB-006', title: expect.stringMatching(/VPN/i) },
    ]);
  });

  test.each([
    ['a requester', 'user', 403],
    ['nobody signed in', undefined, 401],
  ])('is refused to %s', async (_who, account, status) => {
    const created = await proposed();
    const req = request(app).get(`/api/tickets/${created._id}/proposal`);
    if (account) req.set(bearer(tokens, account as 'user'));
    expect((await req).status).toBe(status);
  });

  test('is refused to the agent itself', async () => {
    const created = await proposed();
    const token = await issueServiceToken({
      ticketId: created._id,
      runId: String(new mongoose.Types.ObjectId()),
    });
    const response = await request(app)
      .get(`/api/tickets/${created._id}/proposal`)
      .set({ Authorization: `Bearer ${token}` });
    expect(response.status).toBe(403);
  });

  test('a ticket the agent never proposed anything for, or one that does not exist, is not found', async () => {
    const plain = await createTicket();
    expect(
      (await request(app).get(`/api/tickets/${plain._id}/proposal`).set(bearer(tokens, 'tech')))
        .status
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/tickets/${new mongoose.Types.ObjectId()}/proposal`)
          .set(bearer(tokens, 'tech'))
      ).status
    ).toBe(404);
    expect(
      (await request(app).get('/api/tickets/not-an-id/proposal').set(bearer(tokens, 'tech'))).status
    ).toBe(400);
  });
});

describe('approving a proposal', () => {
  test('posts the reply as the agent, approved by the person, and waits for the requester', async () => {
    const created = await proposed();
    const response = await decide(created._id, 'approve', 'tech');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'approved' });

    const ticket = await ticketOf(created._id);
    expect(ticket).toMatchObject({ status: 'pending-user' });
    expect(ticket?.agent?.proposalStatus).toBe('approved');
    expect(ticket?.activity.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['proposal_approved', 'status_changed', 'comment_added'])
    );

    const [comment, ...rest] = await commentsOf(created._id);
    expect(rest).toEqual([]);
    expect(comment).toMatchObject({
      visibility: 'public',
      body: 'Try the numbered steps in the VPN article and reconnect.',
      source: 'agent',
      author: { name: 'Service Desk Agent', role: 'agent' },
      approvedBy: { email: 'tech@demo.local' },
    });

    // The requester reads it, labelled as the agent's, and answering puts the ticket back in work.
    const asRequester = await request(app)
      .get(`/api/tickets/${created._id}/comments`)
      .set(bearer(tokens, 'user'));
    expect(asRequester.body.comments[0]).toMatchObject({
      source: 'agent',
      approvedBy: { name: expect.any(String) },
    });
    await request(app)
      .post(`/api/tickets/${created._id}/comments`)
      .set(bearer(tokens, 'user'))
      .send({ body: 'That fixed it, thanks.' })
      .expect(201);
    expect((await ticketOf(created._id))?.status).toBe('in-progress');
  });

  test('an edited reply is what is posted, and is recorded as edited', async () => {
    const created = await proposed();
    const edited = 'Reconnect the VPN, then restart your laptop, and tell us if it still drops.';
    const response = await decide(created._id, 'approve', 'admin', { replyMarkdown: edited });
    expect(response.body).toEqual({ status: 'edited' });

    const [comment] = await commentsOf(created._id);
    expect(comment?.body).toBe(edited);
    expect(comment?.approvedBy?.email).toBe('admin@demo.local');
    expect((await ticketOf(created._id))?.agent?.proposalStatus).toBe('edited');
  });

  test('a "reply" that is the same as the draft is not an edit', async () => {
    const created = await proposed();
    const response = await decide(created._id, 'approve', 'tech', {
      replyMarkdown: '  Try the numbered steps in the VPN article and reconnect.  ',
    });
    expect(response.body).toEqual({ status: 'approved' });
  });

  test('cannot be done twice: the second is refused and nothing is posted again', async () => {
    const created = await proposed();
    await decide(created._id, 'approve', 'tech').expect(200);
    const again = await decide(created._id, 'approve', 'tech');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('NO_PENDING_PROPOSAL');
    expect(await commentsOf(created._id)).toHaveLength(1);
  });

  test('two people deciding at the same moment cannot both win', async () => {
    const created = await proposed();
    const [a, b] = await Promise.all([
      decide(created._id, 'approve', 'tech'),
      decide(created._id, 'approve', 'admin'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await commentsOf(created._id)).toHaveLength(1);
  });

  test('an approval racing a rejection has one winner', async () => {
    const created = await proposed();
    const [a, b] = await Promise.all([
      decide(created._id, 'approve', 'tech'),
      decide(created._id, 'reject', 'admin'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const comments = await commentsOf(created._id);
    const status = (await ticketOf(created._id))?.agent?.proposalStatus;
    expect(comments.length).toBe(status === 'approved' ? 1 : 0);
  });

  test('still works after a person has started on the ticket, and moves it to wait for the requester', async () => {
    const created = await proposed();
    // A person takes the ticket and starts on it, so the reply may no longer fit.
    await request(app)
      .patch(`/api/tickets/${created._id}`)
      .set(bearer(tokens, 'tech'))
      .send({ status: 'in-progress' })
      .expect(200);
    // The status the decision is made against is read fresh, so the move is from where it is now.
    const response = await decide(created._id, 'approve', 'tech');
    expect(response.status).toBe(200);
    expect((await ticketOf(created._id))?.status).toBe('pending-user');
  });

  test('on a ticket that is already finished it posts the reply and leaves the status', async () => {
    const created = await proposed();
    const patch = (status: string) =>
      request(app)
        .patch(`/api/tickets/${created._id}`)
        .set(bearer(tokens, 'tech'))
        .send({ status })
        .expect(200);
    await patch('in-progress');
    await patch('resolved');

    const response = await decide(created._id, 'approve', 'tech');
    expect(response.status).toBe(200);
    expect((await ticketOf(created._id))?.status).toBe('resolved');
    expect(await commentsOf(created._id)).toHaveLength(1);
  });

  test.each([
    ['a requester', 'user', 403],
    ['nobody signed in', undefined, 401],
  ])('is refused to %s, and nothing is posted', async (_who, account, status) => {
    const created = await proposed();
    const req = request(app).post(`/api/tickets/${created._id}/proposal/approve`).send({});
    if (account) req.set(bearer(tokens, account as 'user'));
    expect((await req).status).toBe(status);
    expect(await commentsOf(created._id)).toEqual([]);
    expect((await ticketOf(created._id))?.agent?.proposalStatus).toBe('pending');
  });

  test.each([
    ['too short', { replyMarkdown: 'Hi' }],
    ['too long', { replyMarkdown: 'x'.repeat(2001) }],
    ['not text', { replyMarkdown: 42 }],
  ])('refuses an edited reply that is %s', async (_what, body) => {
    const created = await proposed();
    const response = await decide(created._id, 'approve', 'tech', body);
    expect(response.status).toBe(400);
    expect(await commentsOf(created._id)).toEqual([]);
  });

  test('a ticket the agent never proposed anything for has nothing to approve', async () => {
    const created = await createTicket();
    expect((await decide(created._id, 'approve', 'tech')).status).toBe(404);
  });
});

describe('rejecting a proposal', () => {
  test('posts nothing, leaves the ticket where it was, and records why', async () => {
    const created = await proposed();
    const before = await ticketOf(created._id);
    const response = await decide(created._id, 'reject', 'tech', { reason: 'Wrong article.' });
    expect(response.body).toEqual({ status: 'rejected' });

    const ticket = await ticketOf(created._id);
    expect(ticket?.agent?.proposalStatus).toBe('rejected');
    expect(ticket?.status).toBe(before?.status);
    expect(ticket?.__v).toBe(before?.__v);
    expect(await commentsOf(created._id)).toEqual([]);
    const entry = ticket?.activity.find((e) => e.action === 'proposal_rejected');
    expect(entry).toMatchObject({ detail: 'Wrong article.', actorEmail: 'tech@demo.local' });
  });

  test('cannot be done after the proposal was decided, and needs no reason', async () => {
    const created = await proposed();
    await decide(created._id, 'reject', 'tech').expect(200);
    expect((await decide(created._id, 'reject', 'tech')).status).toBe(409);
    expect((await decide(created._id, 'approve', 'tech')).status).toBe(409);
  });

  test('is refused to a requester', async () => {
    const created = await proposed();
    expect((await decide(created._id, 'reject', 'user')).status).toBe(403);
    expect((await ticketOf(created._id))?.agent?.proposalStatus).toBe('pending');
  });

  test('a reason that is too long is refused', async () => {
    const created = await proposed();
    expect((await decide(created._id, 'reject', 'tech', { reason: 'x'.repeat(201) })).status).toBe(
      400
    );
  });
});

// --- The agent's handover endpoint --------------------------------------------------------

describe('POST /agent/escalations', () => {
  const asAgentFor = async (ticketId: string) => ({
    Authorization: `Bearer ${await issueServiceToken({
      ticketId,
      runId: String(new mongoose.Types.ObjectId()),
    })}`,
  });
  const body = (ticketId: string, overrides: Record<string, unknown> = {}) => ({
    ticketId,
    assigneeGroup: 'Network Support',
    reason: 'out_of_kb_scope',
    summary: 'Reported: no article covers this.',
    ...overrides,
  });

  test('assigns the ticket and leaves the summary as an internal note', async () => {
    const created = await createTicket();
    const response = await request(app)
      .post('/api/agent/escalations')
      .set(await asAgentFor(created._id))
      .send(body(created._id));
    expect(response.status).toBe(201);
    expect(response.body.ticket).toMatchObject({ assignee: 'Network Support', status: 'assigned' });

    const [note] = await commentsOf(created._id);
    expect(note).toMatchObject({ visibility: 'internal', source: 'agent' });
  });

  test('keeps the status of a ticket that is already being worked, and only changes hands', async () => {
    const created = await createTicket();
    await request(app)
      .patch(`/api/tickets/${created._id}`)
      .set(bearer(tokens, 'tech'))
      .send({ status: 'in-progress' })
      .expect(200);
    const response = await request(app)
      .post('/api/agent/escalations')
      .set(await asAgentFor(created._id))
      .send(body(created._id));
    expect(response.body.ticket.status).toBe('in-progress');
    expect(response.body.ticket.assignee).toBe('Network Support');
  });

  test('is refused for any ticket but the one the token names, and changes nothing', async () => {
    const own = await createTicket();
    const other = await createTicket({ title: 'Printer offline' });
    const response = await request(app)
      .post('/api/agent/escalations')
      .set(await asAgentFor(own._id))
      .send(body(other._id));
    expect(response.status).toBe(403);
    expect((await ticketOf(other._id))?.assignee).toBe('Unassigned');
    expect(await commentsOf(other._id)).toEqual([]);
  });

  test.each([
    ['a technician', 'tech'],
    ['an admin', 'admin'],
    ['a requester', 'user'],
  ])('is refused to %s: only the agent hands tickets over', async (_who, account) => {
    const created = await createTicket();
    const response = await request(app)
      .post('/api/agent/escalations')
      .set(bearer(tokens, account as 'tech'))
      .send(body(created._id));
    expect(response.status).toBe(403);
    expect((await ticketOf(created._id))?.assignee).toBe('Unassigned');
  });

  test.each([
    ['a group that is not one', { assigneeGroup: 'Everyone' }],
    ['a reason that is not one', { reason: 'because' }],
    ['no summary', { summary: '' }],
    ['a summary that is too long', { summary: 'x'.repeat(1801) }],
    ['an id that is not an id', { ticketId: 'nope' }],
  ])('refuses %s', async (_what, overrides) => {
    const created = await createTicket();
    const response = await request(app)
      .post('/api/agent/escalations')
      .set(await asAgentFor(created._id))
      .send(body(created._id, overrides));
    expect(response.status).toBe(400);
  });

  test('is refused without a token', async () => {
    const created = await createTicket();
    expect((await request(app).post('/api/agent/escalations').send(body(created._id))).status).toBe(
      401
    );
  });
});

// --- A person editing while the agent works ------------------------------------------------

describe('a person editing the ticket while the agent works', () => {
  // Wraps the agent's requests: before each PATCH goes out, a technician edits the ticket, so the
  // version the agent read is out of date by the time its own write arrives.
  const editBeforePatch =
    (ticketId: string, times: number): typeof fetch =>
    async (input, init) => {
      if (init?.method === 'PATCH' && times-- > 0) {
        await request(app)
          .patch(`/api/tickets/${ticketId}`)
          .set(bearer(tokens, 'tech'))
          .send({ title: `Edited by a person ${times}` })
          .expect(200);
      }
      return fetch(input, init);
    };

  test('one edit is absorbed: the agent reads the ticket again and its triage still lands', async () => {
    const created = await createTicket();
    await work(proposing(created._id), { fetchImpl: editBeforePatch(created._id, 1) });

    const ticket = await ticketOf(created._id);
    expect(ticket).toMatchObject({ category: 'Network', priority: 'high' });
    expect(ticket?.title).toBe('Edited by a person 0');
    expect(await AgentRun.findOne()).toMatchObject({ outcome: 'proposed' });
  });

  test('two edits in a row make it step back: nothing of its own is written', async () => {
    const created = await createTicket();
    const result = await work(proposing(created._id), {
      fetchImpl: editBeforePatch(created._id, 2),
    });

    expect(result.ran).toBe(1);
    const ticket = await ticketOf(created._id);
    expect(ticket).toMatchObject({ category: 'General Support', priority: 'medium' });
    expect(ticket?.agent?.proposalStatus).toBeUndefined();
    expect(await AgentRun.findOne()).toMatchObject({
      outcome: 'aborted',
      outcomeReason: 'ticket_changed',
    });
    expect(await commentsOf(created._id)).toEqual([]);
  });
});

// --- Limits ---------------------------------------------------------------------------------

describe('the per-requester limit', () => {
  test('sends a requester’s tickets to a person once they have had their share in the hour', async () => {
    await updateSettings({ perRequesterHourlyLimit: 2 }, 'admin@demo.local');
    const first = await createTicket({ title: 'First problem' });
    const second = await createTicket({ title: 'Second problem' });
    const third = await createTicket({ title: 'Third problem' });

    const asked: string[] = [];
    const script = (id: string): ScriptStep[] => [
      () => {
        asked.push(id);
        return calls(search());
      },
      calls(read()),
      calls(toolUse('set_triage', triage(id)), toolUse('propose_resolution', proposal(id))),
    ];
    const queue = [first, second, third].map((t) => script(t._id));
    const result = await processAgentEvents({
      modelClient: () => new ScriptedModelClient(queue.shift() ?? []),
      baseUrl,
    });

    expect(result).toMatchObject({ ran: 2, skipped: 1 });
    expect(asked).toHaveLength(2);
    const runs = await AgentRun.find().sort({ startedAt: 1 }).lean();
    expect(runs.map((r) => r.outcome)).toEqual(['proposed', 'proposed', 'aborted']);
    expect(runs[2]?.outcomeReason).toBe('requester_rate_limited');
    // The ticket is with people, as it would be without the agent.
    expect(await ticketOf(third._id)).toMatchObject({ category: 'General Support' });
  });

  test('is per requester: someone else’s tickets are not held back', async () => {
    await updateSettings({ perRequesterHourlyLimit: 1 }, 'admin@demo.local');
    const mine = await createTicket();
    const theirs = (
      await request(app)
        .post('/api/tickets')
        .set(bearer(tokens, 'tech'))
        .send({
          title: 'Printer offline',
          description: 'It says offline.',
          requesterName: 'Sam Other',
          requesterEmail: 'sam@example.com',
        })
        .expect(201)
    ).body.ticket as { _id: string };

    const queue = [proposing(mine._id), proposing(theirs._id)];
    const result = await processAgentEvents({
      modelClient: () => new ScriptedModelClient(queue.shift() ?? []),
      baseUrl,
    });
    expect(result).toMatchObject({ ran: 2, skipped: 0 });
  });

  test('a limit of zero runs nothing', async () => {
    await updateSettings({ perRequesterHourlyLimit: 0 }, 'admin@demo.local');
    await createTicket();
    const result = await processAgentEvents({
      modelClient: () => {
        throw new Error('The model must not be asked.');
      },
      baseUrl,
    });
    expect(result).toMatchObject({ ran: 0, skipped: 1 });
    expect(await AgentRun.findOne()).toMatchObject({ outcomeReason: 'requester_rate_limited' });
  });

  test('older runs do not count: only the last hour does', async () => {
    await updateSettings({ perRequesterHourlyLimit: 1 }, 'admin@demo.local');
    await AgentRun.create({
      ticketId: new mongoose.Types.ObjectId(),
      ticketVersion: 0,
      idempotencyKey: 'old:v0',
      mode: 'assist',
      model: 'claude-sonnet-5',
      promptVersion: 'triage.v1',
      outcome: 'proposed',
      requesterEmail: 'user@demo.local',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const created = await createTicket();
    const result = await work(proposing(created._id));
    expect(result).toMatchObject({ ran: 1, skipped: 0 });
  });
});

describe('the kill switch in assist mode', () => {
  test('stops the agent before it writes anything', async () => {
    await updateSettings({ killSwitch: true }, 'admin@demo.local');
    const created = await createTicket();
    const before = await ticketOf(created._id);
    await processAgentEvents({
      modelClient: () => {
        throw new Error('The model must not be asked.');
      },
      baseUrl,
    });
    const after = await ticketOf(created._id);
    expect(after?.__v).toBe(before?.__v);
    expect(after?.agent).toBeUndefined();
    expect(await AgentRun.findOne()).toMatchObject({ outcomeReason: 'kill_switch' });
  });
});
