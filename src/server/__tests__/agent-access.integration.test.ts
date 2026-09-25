// What the service desk agent's token may and may not do, against the real app and database.
// The property that matters is negative: the agent works on one ticket and nothing else, and
// nothing a request says can widen that.
import { SignJWT } from 'jose';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import Comment from '../models/Comment';
import Ticket from '../models/Ticket';
import { issueServiceToken } from '../security/accessToken';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let own: string;
let other: string;
let agentToken: string;

const asAgent = () => ({ Authorization: `Bearer ${agentToken}` });

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Ticket.init();
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Ticket.deleteMany({});
  await Comment.deleteMany({});
  const [a, b] = await Ticket.create([
    { ticketNumber: 'TKT-9101', title: 'VPN drops', requesterEmail: 'user@demo.local' },
    { ticketNumber: 'TKT-9102', title: 'Printer offline', requesterEmail: 'user@demo.local' },
  ]);
  own = String(a?._id);
  other = String(b?._id);
  agentToken = await issueServiceToken({ ticketId: own, runId: 'run-1' });
});

describe('the ticket it was started for', () => {
  test('can be read', async () => {
    const response = await request(app).get(`/api/tickets/${own}`).set(asAgent());
    expect(response.status).toBe(200);
    expect(response.body.ticket.ticketNumber).toBe('TKT-9101');
  });

  test('can be triaged: category, priority and assignee, recorded as the agent', async () => {
    const response = await request(app)
      .patch(`/api/tickets/${own}`)
      .set(asAgent())
      .send({ category: 'Network', priority: 'high', assignee: 'Network Support' });

    expect(response.status).toBe(200);
    expect(response.body.ticket).toMatchObject({
      category: 'Network',
      priority: 'high',
      assignee: 'Network Support',
    });
    const actors = response.body.ticket.activity.map(
      (entry: { actorRole?: string }) => entry.actorRole
    );
    expect(actors).toContain('agent');
  });

  test.each([
    ['status', { status: 'closed' }],
    ['title', { title: 'Rewritten by the agent' }],
    ['description', { description: 'Rewritten by the agent' }],
    ['requesterEmail', { requesterEmail: 'someone@else.example' }],
  ])('cannot change its %s', async (_field, patch) => {
    const response = await request(app).patch(`/api/tickets/${own}`).set(asAgent()).send(patch);
    expect(response.status).toBe(403);
    expect((await Ticket.findById(own))?.title).toBe('VPN drops');
  });

  test('takes a public reply and an internal note, both marked as from the agent', async () => {
    const reply = await request(app)
      .post(`/api/tickets/${own}/comments`)
      .set(asAgent())
      .send({ body: 'Try the VPN reconnect steps in KB-001.' });
    const note = await request(app)
      .post(`/api/tickets/${own}/comments`)
      .set(asAgent())
      .send({ body: 'Escalated: needs the network team.', visibility: 'internal' });

    expect(reply.status).toBe(201);
    expect(reply.body.comment.author).toMatchObject({ role: 'agent', name: 'Service Desk Agent' });
    expect(note.status).toBe(201);
    expect(note.body.comment.visibility).toBe('internal');

    const thread = await request(app).get(`/api/tickets/${own}/comments`).set(asAgent());
    expect(thread.status).toBe(200);
    expect(thread.body.comments).toHaveLength(2);
  });

  test('the requester sees the agent public reply but not its internal note', async () => {
    await request(app)
      .post(`/api/tickets/${own}/comments`)
      .set(asAgent())
      .send({ body: 'Public.' });
    await request(app)
      .post(`/api/tickets/${own}/comments`)
      .set(asAgent())
      .send({ body: 'Private.', visibility: 'internal' });

    const thread = await request(app)
      .get(`/api/tickets/${own}/comments`)
      .set(bearer(tokens, 'user'));
    expect(thread.body.comments.map((c: { body: string }) => c.body)).toEqual(['Public.']);
  });
});

describe('every other ticket', () => {
  test('cannot be read, changed or commented on', async () => {
    const read = await request(app).get(`/api/tickets/${other}`).set(asAgent());
    const change = await request(app)
      .patch(`/api/tickets/${other}`)
      .set(asAgent())
      .send({ priority: 'urgent' });
    const listComments = await request(app).get(`/api/tickets/${other}/comments`).set(asAgent());
    const comment = await request(app)
      .post(`/api/tickets/${other}/comments`)
      .set(asAgent())
      .send({ body: 'Hello' });

    for (const response of [read, change, listComments, comment]) {
      expect(response.status).toBe(403);
    }
    expect((await Ticket.findById(other))?.priority).not.toBe('urgent');
    expect(await Comment.countDocuments({ ticketId: other })).toBe(0);
  });

  test('cannot be reached by putting its id in another place in the request', async () => {
    const response = await request(app)
      .patch(`/api/tickets/${other}`)
      .set(asAgent())
      .set('X-Ticket-Id', own)
      .query({ id: own })
      .send({ priority: 'urgent', ticketId: own });
    expect(response.status).toBe(403);
  });
});

describe('everything outside a single ticket', () => {
  test('it may list tickets, as a technician can, to look for similar ones', async () => {
    const response = await request(app).get('/api/tickets').set(asAgent());
    expect(response.status).toBe(200);
    expect(response.body.tickets).toHaveLength(2);
  });

  test.each([
    ['create a ticket', 'post', '/api/tickets', { title: 'x', description: 'y' }],
    ['read the queue stats', 'get', '/api/tickets/stats', undefined],
    ['read the trends', 'get', '/api/tickets/stats/trends', undefined],
    ['export every ticket', 'get', '/api/tickets/export', undefined],
  ] as const)('cannot %s', async (_what, method, path, body) => {
    const response = await request(app)[method](path).set(asAgent()).send(body);
    expect(response.status).toBe(403);
  });

  test('cannot delete a ticket', async () => {
    const response = await request(app).delete(`/api/tickets/${own}`).set(asAgent());
    expect(response.status).toBe(403);
    expect(await Ticket.exists({ _id: own })).toBeTruthy();
  });

  test.each([
    ['list users', 'get', '/api/users'],
    ['change a role', 'patch', '/api/users/665f0f40d5d4f541f8ef9999'],
    ['read the audit log', 'get', '/api/audit'],
    ['read the outbox', 'get', '/api/outbox'],
  ] as const)('cannot %s', async (_what, method, path) => {
    const response = await request(app)[method](path).set(asAgent()).send({ role: 'admin' });
    expect(response.status).toBe(403);
  });
});

describe('the agent role', () => {
  test('cannot be given to anyone through the role endpoint', async () => {
    const users = await request(app).get('/api/users').set(bearer(tokens, 'admin'));
    const target = users.body.users.find((u: { email: string }) => u.email === 'user@demo.local');

    const response = await request(app)
      .patch(`/api/users/${target.id}`)
      .set(bearer(tokens, 'admin'))
      .send({ role: 'agent' });
    expect(response.status).toBe(400);
  });

  test('an agent token with no ticket in it is refused outright', async () => {
    const forged = await new SignJWT({
      name: 'Service Desk Agent',
      email: 'agent@service.local',
      role: 'agent',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('service-desk-agent')
      .setIssuer('it-ticketing-system')
      .setAudience('it-ticketing-api')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET || 'local-demo-secret-change-me'));

    const response = await request(app)
      .get(`/api/tickets/${own}`)
      .set({
        Authorization: `Bearer ${forged}`,
      });
    expect(response.status).toBe(401);
  });
});
