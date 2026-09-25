// Creating a ticket nudges the agent on Vercel. The nudge must never delay the response, and must
// never be able to break it: the requester's ticket is created whatever happens to the agent.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;

const SECRET = 'a-long-enough-secret-for-the-kick-integration';
const KEYS = ['AGENT_ENABLED', 'CRON_SECRET', 'VERCEL', 'VERCEL_URL', 'VERCEL_ENV'];

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Ticket.init();
  await OutboxEvent.init();
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  for (const key of KEYS) delete process.env[key];
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  for (const key of KEYS) delete process.env[key];
  process.env.AGENT_ENABLED = 'true';
  process.env.CRON_SECRET = SECRET;
  process.env.VERCEL = '1';
  process.env.VERCEL_URL = 'desk-abc.vercel.app';
  await Promise.all([Ticket.deleteMany({}), OutboxEvent.deleteMany({})]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const create = () =>
  request(app)
    .post('/api/tickets')
    .set(bearer(tokens, 'user'))
    .send({ title: 'VPN keeps dropping' });

// Only the requests the app itself makes with fetch: supertest talks to the app directly.
const spyOnFetch = (answer: () => Promise<Response>) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(answer as never);

describe('creating a ticket', () => {
  test('asks the deployment to run the agent, once, with the job secret', async () => {
    const fetchSpy = spyOnFetch(async () => new Response('{}'));

    const response = await create().expect(201);
    // The nudge is sent after the response, so give it a tick.
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.body.ticket.title).toBe('VPN keeps dropping');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://desk-abc.vercel.app/api/jobs/agent-runs');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
  });

  test('does not wait for the agent: the response comes back while the nudge is still going', async () => {
    let finish: () => void = () => undefined;
    spyOnFetch(
      () =>
        new Promise<Response>((resolve) => {
          finish = () => resolve(new Response('{}'));
        })
    );

    // The nudge never finishes until we let it, and the ticket is created regardless.
    const response = await create().expect(201);
    expect(response.body.ticket._id).toBeDefined();
    expect(await Ticket.countDocuments()).toBe(1);
    finish();
  });

  test('still creates the ticket when the nudge fails', async () => {
    spyOnFetch(() => Promise.reject(new Error('the deployment is unreachable')));
    await create().expect(201);
    expect(await Ticket.countDocuments()).toBe(1);
    // The event is there for the scheduled job to find.
    expect(await OutboxEvent.countDocuments({ consumer: 'agent', status: 'pending' })).toBe(1);
  });

  test.each([
    ['the agent is off', { AGENT_ENABLED: undefined }],
    ['there is no job secret', { CRON_SECRET: undefined }],
    ['it is not running on Vercel', { VERCEL: undefined }],
  ])('sends no nudge when %s, and creates the ticket as ever', async (_why, overrides) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
    }
    const fetchSpy = spyOnFetch(async () => new Response('{}'));

    await create().expect(201);
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await Ticket.countDocuments()).toBe(1);
  });

  test('a request that is refused, so no ticket is created, sends no nudge', async () => {
    const fetchSpy = spyOnFetch(async () => new Response('{}'));
    await request(app)
      .post('/api/tickets')
      .set(bearer(tokens, 'user'))
      .send({ description: 'no title' })
      .expect(400);
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('editing a ticket does not nudge the agent, which only acts on new tickets', async () => {
    const fetchSpy = spyOnFetch(async () => new Response('{}'));
    const created = await create().expect(201);
    await new Promise((resolve) => setImmediate(resolve));
    fetchSpy.mockClear();

    await request(app)
      .patch(`/api/tickets/${created.body.ticket._id}`)
      .set(bearer(tokens, 'tech'))
      .send({ priority: 'high' })
      .expect(200);
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
