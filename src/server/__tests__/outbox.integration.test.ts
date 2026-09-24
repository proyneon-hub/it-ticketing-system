// The outbox against a real database and a local stand-in for the webhook: events are recorded
// with the change that caused them (or not at all), delivered with retries, and never sent twice.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import AuditEvent from '../models/AuditEvent';
import Comment from '../models/Comment';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import * as outboxRepository from '../repositories/outboxRepository';
import { deliverPending } from '../services/outboxService';
import {
  bearer,
  signInAll,
  startTestDatabase,
  startWebhookStub,
  type Account,
  type TestDatabase,
  type Tokens,
  type WebhookStub,
} from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let stub: WebhookStub;
const as = (role: Account) => bearer(tokens, role);

const HOUR = 60 * 60 * 1000;
// Later than any backoff (at most about an hour), so a retry is always due when we ask.
const later = (steps: number) => new Date(Date.now() + 2 * HOUR * steps);

const SECRET_NOTE = 'Rotate the admin password before replying';

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Ticket.init();
  await OutboxEvent.init();
  tokens = await signInAll(app);
  stub = await startWebhookStub();
}, 300000);

afterAll(async () => {
  delete process.env.WEBHOOK_URL;
  delete process.env.WEBHOOK_FORMAT;
  delete process.env.CRON_SECRET;
  await stub.close();
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  process.env.WEBHOOK_URL = stub.url;
  delete process.env.WEBHOOK_FORMAT;
  stub.reset();
  vi.restoreAllMocks();
  await Promise.all([
    Ticket.deleteMany({}),
    Comment.deleteMany({}),
    OutboxEvent.deleteMany({}),
    AuditEvent.deleteMany({}),
    mongoose.connection.collection('counters').deleteMany({ _id: 'ticket' as never }),
  ]);
});

const createTicket = async (role: Account = 'tech', body: object = { title: 'VPN drops' }) =>
  (await request(app).post('/api/tickets').set(as(role)).send(body).expect(201)).body.ticket;

const eventTypes = async () =>
  (await OutboxEvent.find().sort({ _id: 1 }).lean()).map((event) => event.type);

describe('recording events', () => {
  test('a created ticket, an assignment, a status change and a comment each leave an event', async () => {
    const ticket = await createTicket();
    expect(await eventTypes()).toEqual(['ticket.created']);

    await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .send({ status: 'assigned', assignee: 'Theo Technician' })
      .expect(200);
    await request(app)
      .post(`/api/tickets/${ticket._id}/comments`)
      .set(as('tech'))
      .send({ body: SECRET_NOTE, visibility: 'internal' })
      .expect(201);

    expect(await eventTypes()).toEqual([
      'ticket.created',
      'ticket.status_changed',
      'ticket.assigned',
      'ticket.comment_added',
    ]);
    const stored = await OutboxEvent.find().lean();
    expect(stored.every((event) => event.status === 'pending' && event.attempts === 0)).toBe(true);
  });

  test('an edit that changes nothing worth announcing leaves no event', async () => {
    const ticket = await createTicket();
    await OutboxEvent.deleteMany({});

    await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .send({ priority: 'urgent', description: 'More detail' })
      .expect(200);

    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  test('a comment event never carries the comment text', async () => {
    const ticket = await createTicket();
    await request(app)
      .post(`/api/tickets/${ticket._id}/comments`)
      .set(as('tech'))
      .send({ body: SECRET_NOTE, visibility: 'internal' })
      .expect(201);

    const event = await OutboxEvent.findOne({ type: 'ticket.comment_added' }).lean();
    expect(JSON.stringify(event)).not.toContain(SECRET_NOTE);
    expect(event?.payload.visibility).toBe('internal');
  });

  test('records nothing at all when no webhook is configured', async () => {
    delete process.env.WEBHOOK_URL;
    await createTicket();

    expect(await OutboxEvent.countDocuments()).toBe(0);
    expect(await deliverPending()).toEqual({
      configured: false,
      delivered: 0,
      retried: 0,
      dead: 0,
    });
    expect(stub.requests).toHaveLength(0);
  });

  test('treats a WEBHOOK_URL that is not a web address as unset', async () => {
    process.env.WEBHOOK_URL = 'file:///etc/passwd';
    await createTicket();
    expect(await OutboxEvent.countDocuments()).toBe(0);
    process.env.WEBHOOK_URL = 'not a url';
    await createTicket();
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });
});

describe('atomicity: the change and its event commit together or not at all', () => {
  test('if recording the event fails, the ticket is not created', async () => {
    vi.spyOn(outboxRepository, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));

    const response = await request(app)
      .post('/api/tickets')
      .set(as('tech'))
      .send({ title: 'Should not exist' });

    expect(response.status).toBe(500);
    expect(await Ticket.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  test('if recording the event fails, the edit is not applied', async () => {
    const ticket = await createTicket();
    vi.spyOn(outboxRepository, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));

    await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .send({ status: 'assigned', assignee: 'Theo Technician' })
      .expect(500);

    const stored = await Ticket.findById(ticket._id).lean();
    expect(stored?.status).toBe('open');
    expect(stored?.activity).toHaveLength(1);
    expect(await eventTypes()).toEqual(['ticket.created']);
  });

  test('if recording the event fails, the comment and its history entry are not saved', async () => {
    const ticket = await createTicket();
    vi.spyOn(outboxRepository, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));

    await request(app)
      .post(`/api/tickets/${ticket._id}/comments`)
      .set(as('tech'))
      .send({ body: 'lost' })
      .expect(500);

    expect(await Comment.countDocuments()).toBe(0);
    expect((await Ticket.findById(ticket._id).lean())?.activity).toHaveLength(1);
  });

  test('an edit refused with a version conflict leaves no event behind', async () => {
    const ticket = await createTicket();
    await OutboxEvent.deleteMany({});

    await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .set('If-Match', '"99"')
      .send({ status: 'assigned', assignee: 'Theo Technician' })
      .expect(409);

    expect(await OutboxEvent.countDocuments()).toBe(0);
  });
});

describe('delivering', () => {
  test('sends each event once, oldest first, and marks it delivered', async () => {
    const ticket = await createTicket();
    await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .send({ status: 'assigned', assignee: 'Theo Technician' });

    const result = await deliverPending();

    expect(result).toEqual({ configured: true, delivered: 3, retried: 0, dead: 0 });
    expect(stub.requests.map((r) => (r.body as { type: string }).type)).toEqual([
      'ticket.created',
      'ticket.status_changed',
      'ticket.assigned',
    ]);
    const stored = await OutboxEvent.find().lean();
    expect(stored.every((event) => event.status === 'delivered' && event.deliveredAt)).toBe(true);

    // Nothing is left, so another run sends nothing.
    expect((await deliverPending()).delivered).toBe(0);
    expect(stub.requests).toHaveLength(3);
  });

  test('a webhook that fails twice and then answers is retried until it is delivered', async () => {
    await createTicket();
    stub.queue.push(500, 500);

    const first = await deliverPending({ now: later(1) });
    expect(first).toMatchObject({ delivered: 0, retried: 1 });
    const afterFirst = await OutboxEvent.findOne().lean();
    expect(afterFirst).toMatchObject({ status: 'pending', attempts: 1 });
    expect(afterFirst?.lastError).toContain('HTTP 500');
    // It is not tried again straight away: the next attempt is scheduled in the future.
    expect(afterFirst?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect((await deliverPending()).retried).toBe(0);
    expect(stub.requests).toHaveLength(1);

    await deliverPending({ now: later(2) });
    const third = await deliverPending({ now: later(3) });

    expect(third).toMatchObject({ delivered: 1, retried: 0 });
    const done = await OutboxEvent.findOne().lean();
    expect(done).toMatchObject({ status: 'delivered', attempts: 3 });
    expect(done?.lastError).toBeUndefined();
    expect(stub.requests).toHaveLength(3);
  });

  test('a webhook that never answers ends the event as dead after six attempts, and an admin can retry it', async () => {
    await createTicket();
    stub.fallback = 500;

    const results = [];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      results.push(await deliverPending({ now: later(attempt) }));
    }

    expect(results.slice(0, 5).map((r) => r.retried)).toEqual([1, 1, 1, 1, 1]);
    expect(results[5]).toMatchObject({ retried: 0, dead: 1 });
    expect(results[6]).toMatchObject({ retried: 0, dead: 0 }); // Nothing left to try.
    expect(stub.requests).toHaveLength(6);
    const dead = await OutboxEvent.findOne().lean();
    expect(dead).toMatchObject({ status: 'dead', attempts: 6 });
    expect(dead?.lastError).toContain('HTTP 500');

    // Only admins see and retry it.
    await request(app).get('/api/outbox?status=dead').set(as('tech')).expect(403);
    const listed = await request(app).get('/api/outbox?status=dead').set(as('admin')).expect(200);
    expect(listed.body.events).toHaveLength(1);
    expect(listed.body.pagination.total).toBe(1);
    await request(app).post(`/api/outbox/${dead?._id}/retry`).set(as('tech')).expect(403);

    stub.fallback = 200;
    await request(app).post(`/api/outbox/${dead?._id}/retry`).set(as('admin')).expect(200);
    const revived = await OutboxEvent.findById(dead?._id).lean();
    expect(revived).toMatchObject({ status: 'pending', attempts: 0 });
    expect(revived?.lastError).toBeUndefined();

    expect((await deliverPending({ now: later(8) })).delivered).toBe(1);
    expect((await OutboxEvent.findById(dead?._id).lean())?.status).toBe('delivered');
    expect(await AuditEvent.countDocuments({ type: 'outbox_retried' })).toBe(1);

    // Only a dead event can be retried.
    await request(app).post(`/api/outbox/${dead?._id}/retry`).set(as('admin')).expect(404);
    await request(app).post('/api/outbox/not-an-id/retry').set(as('admin')).expect(400);
  });

  test('two workers at once never send the same event twice', async () => {
    for (let index = 0; index < 6; index += 1)
      await createTicket('tech', { title: `Ticket ${index}` });

    const [a, b, c] = await Promise.all([deliverPending(), deliverPending(), deliverPending()]);

    expect(a.delivered + b.delivered + c.delivered).toBe(6);
    const ids = stub.requests.map(
      (r) => (r.body as { payload: { ticket: { id: string } } }).payload.ticket.id
    );
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(await OutboxEvent.countDocuments({ status: 'delivered' })).toBe(6);
  });

  test('an event a crashed worker was holding is picked up once its lock has run out', async () => {
    await createTicket();
    const now = new Date();
    const claimed = await outboxRepository.claimNext(now, 60_000);
    expect(claimed?.status).toBe('sending');

    // Still locked: nothing to do.
    expect((await deliverPending({ now })).delivered).toBe(0);
    expect(stub.requests).toHaveLength(0);

    // After the lock: it is sent, and the abandoned attempt still counts.
    expect((await deliverPending({ now: new Date(now.getTime() + 120_000) })).delivered).toBe(1);
    expect(await OutboxEvent.findOne().lean()).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  test('a slow webhook is given up on rather than waited for', async () => {
    await createTicket();
    const slow = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('The operation timed out.'))
          );
        })
    );

    const result = await deliverPending({
      timeoutMs: 50,
      now: later(1),
      fetchImpl: slow as unknown as typeof fetch,
    });

    expect(result.retried).toBe(1);
    expect((await OutboxEvent.findOne().lean())?.lastError).toContain('timed out');
  });

  test('the webhook address, which carries a secret, is never stored or logged', async () => {
    await createTicket();
    const failing = vi.fn(async (url: unknown) => {
      throw new Error(`connect ECONNREFUSED ${String(url)}`);
    });

    await deliverPending({ fetchImpl: failing as unknown as typeof fetch });

    const stored = await OutboxEvent.findOne().lean();
    expect(stored?.lastError).toContain('[webhook]');
    expect(stored?.lastError).not.toContain('super-secret-token');
    expect(JSON.stringify(stored)).not.toContain('super-secret-token');
  });

  test('never sends an internal note to the webhook, and picks the message shape from the address', async () => {
    process.env.WEBHOOK_FORMAT = 'discord';
    const ticket = await createTicket('tech', { title: '@everyone' });
    await request(app)
      .post(`/api/tickets/${ticket._id}/comments`)
      .set(as('tech'))
      .send({ body: SECRET_NOTE, visibility: 'internal' });

    await deliverPending();

    const sent = JSON.stringify(stub.requests);
    expect(sent).not.toContain(SECRET_NOTE);
    const first = stub.requests[0]?.body as { content: string; allowed_mentions: unknown };
    expect(first.content).toContain('@everyone'); // Shown as text...
    expect(first.allowed_mentions).toEqual({ parse: [] }); // ...but Discord is told not to ping.
    expect(stub.requests[0]?.path).toContain('/hook');
  });

  test('does not follow a redirect to somewhere else', async () => {
    await createTicket();
    const redirect = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      throw new TypeError('fetch failed');
    });

    const result = await deliverPending({ fetchImpl: redirect as unknown as typeof fetch });
    expect(result.retried).toBe(1);
  });
});

describe('the scheduled job endpoints', () => {
  const SECRET = 'a-long-cron-secret-of-at-least-32-characters';

  test('need the bearer secret, and are off when none is configured', async () => {
    delete process.env.CRON_SECRET;
    const off = await request(app)
      .post('/api/jobs/outbox-delivery')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(off.status).toBe(503);
    expect(off.body.code).toBe('JOBS_NOT_CONFIGURED');

    process.env.CRON_SECRET = SECRET;
    await request(app).post('/api/jobs/outbox-delivery').expect(401);
    await request(app)
      .post('/api/jobs/outbox-delivery')
      .set('Authorization', 'Bearer wrong-secret')
      .expect(401);
    // A signed-in admin's token is not the job secret.
    await request(app).post('/api/jobs/sla-escalation').set(as('admin')).expect(401);
  });

  test('outbox delivery sends what is due', async () => {
    process.env.CRON_SECRET = SECRET;
    await createTicket();

    const response = await request(app)
      .post('/api/jobs/outbox-delivery')
      .set('Authorization', `Bearer ${SECRET}`)
      .expect(200);

    expect(response.body).toEqual({ configured: true, delivered: 1, retried: 0, dead: 0 });
    expect(stub.requests).toHaveLength(1);
  });

  test('SLA escalation reports what it did', async () => {
    process.env.CRON_SECRET = SECRET;
    await Ticket.create({
      ticketNumber: 'TKT-8001',
      title: 'Overdue',
      priority: 'medium',
      requesterEmail: 'someone@example.com',
      dueAt: new Date(Date.now() - HOUR),
    });

    const response = await request(app)
      .post('/api/jobs/sla-escalation')
      .set('Authorization', `Bearer ${SECRET}`)
      .expect(200);

    expect(response.body).toEqual({ breached: 1, atRisk: 0, more: false });
  });
});

describe('admin outbox listing', () => {
  test('is for admins, filters by status and pages', async () => {
    for (let index = 0; index < 3; index += 1) await createTicket('tech', { title: `T${index}` });
    await OutboxEvent.updateOne({}, { $set: { status: 'dead' } });

    const all = await request(app).get('/api/outbox?limit=2').set(as('admin')).expect(200);
    expect(all.body.events).toHaveLength(2);
    expect(all.body.pagination).toMatchObject({ total: 3, totalPages: 2 });

    const dead = await request(app).get('/api/outbox?status=dead').set(as('admin')).expect(200);
    expect(dead.body.events).toHaveLength(1);

    await request(app).get('/api/outbox?status=bogus').set(as('admin')).expect(400);
    await request(app).get('/api/outbox').expect(401);
    await request(app).get('/api/outbox').set(as('user')).expect(403);
  });
});
