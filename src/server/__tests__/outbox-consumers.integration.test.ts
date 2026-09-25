// The outbox has two consumers, the webhook and the agent. What matters is isolation: each one
// only ever claims, counts and sends its own events, an event two want is written together with
// the change that caused it, and turning the agent off changes nothing that existed before it.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import * as outboxRepository from '../repositories/outboxRepository';
import { deliverPending } from '../services/outboxService';
import {
  bearer,
  signInAll,
  startTestDatabase,
  startWebhookStub,
  type TestDatabase,
  type Tokens,
  type WebhookStub,
} from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let stub: WebhookStub;

// Read at call time and a little ahead, so an event recorded a moment ago is already due.
const claim = (consumer: 'webhook' | 'agent') =>
  outboxRepository.claimNext(consumer, new Date(Date.now() + 1000), 60_000);

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
  delete process.env.AGENT_ENABLED;
  await stub.close();
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  delete process.env.WEBHOOK_URL;
  delete process.env.AGENT_ENABLED;
  stub.reset();
  vi.restoreAllMocks();
  await Promise.all([Ticket.deleteMany({}), OutboxEvent.deleteMany({})]);
});

const createTicket = async () =>
  (
    await request(app)
      .post('/api/tickets')
      .set(bearer(tokens, 'tech'))
      .send({ title: 'VPN drops' })
      .expect(201)
  ).body.ticket;

const stored = () =>
  OutboxEvent.find()
    .sort({ _id: 1 })
    .lean()
    .then((events) => events.map((event) => `${event.type}:${event.consumer}`));

describe('what is recorded', () => {
  test('with neither on, nothing: a deployment that uses neither collects nothing', async () => {
    await createTicket();
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  test('with only the webhook on, exactly what it recorded before consumers existed', async () => {
    process.env.WEBHOOK_URL = stub.url;
    await createTicket();
    expect(await stored()).toEqual(['ticket.created:webhook']);
  });

  test('with only the agent on, a created ticket records one event for the agent', async () => {
    process.env.AGENT_ENABLED = 'true';
    await createTicket();
    expect(await stored()).toEqual(['ticket.created:agent']);
  });

  test('with both on, a created ticket records one event for each', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    await createTicket();
    expect(await stored()).toEqual(['ticket.created:webhook', 'ticket.created:agent']);
  });

  test('the agent hears about new tickets only: an edit or a comment is the webhook alone', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    const ticket = await createTicket();
    await OutboxEvent.deleteMany({});

    await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(bearer(tokens, 'tech'))
      .send({ status: 'assigned', assignee: 'Theo Technician' })
      .expect(200);
    await request(app)
      .post(`/api/tickets/${ticket._id}/comments`)
      .set(bearer(tokens, 'tech'))
      .send({ body: 'On it.' })
      .expect(201);

    expect(await stored()).toEqual([
      'ticket.status_changed:webhook',
      'ticket.assigned:webhook',
      'ticket.comment_added:webhook',
    ]);
  });

  test('both events carry the same small snapshot, never the description', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    await request(app)
      .post('/api/tickets')
      .set(bearer(tokens, 'tech'))
      .send({ title: 'VPN drops', description: 'My password is hunter2' })
      .expect(201);

    const events = await OutboxEvent.find().lean();
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toEqual(events[1]?.payload);
    expect(JSON.stringify(events)).not.toContain('hunter2');
  });
});

describe('isolation', () => {
  test('the webhook delivers its events and leaves the agent’s untouched', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    await createTicket();

    const result = await deliverPending();

    expect(result).toMatchObject({ delivered: 1, retried: 0, dead: 0 });
    expect(stub.requests).toHaveLength(1);
    const agentEvent = await OutboxEvent.findOne({ consumer: 'agent' }).lean();
    expect(agentEvent).toMatchObject({ status: 'pending', attempts: 0 });
  });

  test('the webhook cannot claim an agent event, even when it is the only one there', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    await createTicket();
    await OutboxEvent.deleteMany({ consumer: 'webhook' });

    expect(await claim('webhook')).toBeNull();
    expect(await deliverPending()).toMatchObject({ delivered: 0 });
    expect(stub.requests).toHaveLength(0);
    expect((await OutboxEvent.findOne().lean())?.status).toBe('pending');
  });

  test('the agent cannot claim a webhook event', async () => {
    process.env.WEBHOOK_URL = stub.url;
    await createTicket();

    expect(await claim('agent')).toBeNull();
    expect((await OutboxEvent.findOne().lean())?.status).toBe('pending');
  });

  test('each claims its own, and a claim marks it as being sent', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    await createTicket();

    const forAgent = await claim('agent');
    const forWebhook = await claim('webhook');

    expect(forAgent).toMatchObject({ consumer: 'agent', status: 'sending', attempts: 1 });
    expect(forWebhook).toMatchObject({ consumer: 'webhook', status: 'sending', attempts: 1 });
    expect(await claim('agent')).toBeNull();
    expect(await claim('webhook')).toBeNull();
  });

  test('a failing webhook does not hold up the agent', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    stub.fallback = 500;
    await createTicket();

    expect(await deliverPending()).toMatchObject({ delivered: 0, retried: 1 });
    expect(await claim('agent')).toMatchObject({ consumer: 'agent', attempts: 1 });
  });

  test('the webhook backlog metric counts webhook events only', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    await createTicket();
    await createTicket();

    const webhook = await outboxRepository.countByStatus('webhook');
    const agent = await outboxRepository.countByStatus('agent');
    expect(webhook).toEqual([{ _id: 'pending', count: 2 }]);
    expect(agent).toEqual([{ _id: 'pending', count: 2 }]);

    await OutboxEvent.deleteMany({ consumer: 'agent' });
    expect(await outboxRepository.countByStatus('agent')).toEqual([]);
    expect(await outboxRepository.countByStatus('webhook')).toEqual([{ _id: 'pending', count: 2 }]);
  });
});

describe('events written before consumers existed', () => {
  // Inserted through the raw collection, so no default fills in the field: this is exactly what
  // an event already sitting in a production database looks like.
  const legacy = () =>
    OutboxEvent.collection.insertOne({
      type: 'ticket.created',
      payload: {
        ticket: {
          id: '665f0f40d5d4f541f8ef2002',
          number: 'TKT-0001',
          title: 'Old event',
          status: 'open',
          priority: 'high',
          assignee: 'Unassigned',
        },
        actor: null,
      },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 1000),
    });

  test('are the webhook’s: it delivers them, and the agent never sees them', async () => {
    process.env.WEBHOOK_URL = stub.url;
    await legacy();
    expect((await OutboxEvent.collection.findOne({}))?.consumer).toBeUndefined();

    expect(await claim('agent')).toBeNull();
    expect(await deliverPending()).toMatchObject({ delivered: 1 });
    expect(stub.requests).toHaveLength(1);
  });

  test('are counted with the webhook’s backlog', async () => {
    await legacy();
    expect(await outboxRepository.countByStatus('webhook')).toEqual([{ _id: 'pending', count: 1 }]);
    expect(await outboxRepository.countByStatus('agent')).toEqual([]);
  });
});

describe('atomicity', () => {
  test('if recording the events fails, the ticket is not created, whoever wanted them', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    vi.spyOn(outboxRepository, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));

    await request(app)
      .post('/api/tickets')
      .set(bearer(tokens, 'tech'))
      .send({ title: 'Should not exist' })
      .expect(500);

    expect(await Ticket.countDocuments()).toBe(0);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });

  test('both events are written in one go, so a ticket is never announced to only one', async () => {
    process.env.WEBHOOK_URL = stub.url;
    process.env.AGENT_ENABLED = 'true';
    const enqueue = vi.spyOn(outboxRepository, 'enqueue');

    await createTicket();

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0].map((draft) => draft.consumer)).toEqual(['webhook', 'agent']);
  });
});
