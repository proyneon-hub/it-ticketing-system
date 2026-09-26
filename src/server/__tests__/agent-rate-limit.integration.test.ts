// The agent's routes and the decisions on its proposals are limited: each does real work, so a runaway
// client (or an agent run in a loop) must not be able to hammer them. What matters is who is counted:
// each person on their own, an agent run on its own, and, in front of authentication, an address, so a
// flood of unauthenticated requests is turned away before anything is checked.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import { agentIpRateLimitOptions, agentRateLimitOptions } from '../middleware/security';
import { issueServiceToken } from '../security/accessToken';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;

const TICKET = '665f0f40d5d4f541f8ef2002';
const newRun = async () => ({
  Authorization: `Bearer ${await issueServiceToken({
    ticketId: TICKET,
    runId: String(new mongoose.Types.ObjectId()),
  })}`,
});

const settings = (headers: Record<string, string>) =>
  request(app).get('/api/agent/settings').set(headers);
const proposal = (headers: Record<string, string>) =>
  request(app).get(`/api/tickets/${TICKET}/proposal`).set(headers);

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  delete process.env.AGENT_API_RATE_LIMIT_MAX;
  delete process.env.AGENT_API_IP_RATE_LIMIT_MAX;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  delete process.env.AGENT_API_IP_RATE_LIMIT_MAX;
  process.env.AGENT_API_RATE_LIMIT_MAX = '3';
});

describe('the per-caller limit', () => {
  test('lets a person through up to it, then answers 429 in the usual error shape', async () => {
    // A signed-in technician's own budget: fresh, because their user id is not used elsewhere here.
    const tech = bearer(tokens, 'tech');
    for (let i = 0; i < 3; i += 1) await settings(tech).expect(200);

    const limited = await settings(tech).expect(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringMatching(/Too many requests/),
      requestId: expect.any(String),
    });
    expect(limited.headers['ratelimit']).toBeDefined();
  });

  test('the routes and the decisions on a proposal share one budget', async () => {
    const admin = bearer(tokens, 'admin');
    await settings(admin).expect(200);
    await proposal(admin).expect(404);
    await request(app)
      .post(`/api/tickets/${TICKET}/proposal/reject`)
      .set(admin)
      .send({})
      .expect(404);
    await settings(admin).expect(429);
    await proposal(admin).expect(429);
  });

  test('is per person: one person running out does not affect anyone else', async () => {
    const user = bearer(tokens, 'user');
    // The requester is turned away by permission, but their attempts are still counted for them.
    for (let i = 0; i < 3; i += 1) await settings(user).expect(403);
    await settings(user).expect(429);

    // The one who was not the requester still has a full budget of their own.
    await request(app)
      .get('/api/agent/runs')
      .set(await newRun())
      .expect(403);
  });

  test('an agent run has a budget of its own, though it shares an address and a name', async () => {
    const one = await newRun();
    const two = await newRun();
    const body = { ticketId: TICKET };
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/agent/escalations').set(one).send(body).expect(400);
    }
    await request(app).post('/api/agent/escalations').set(one).send(body).expect(429);
    // Another run is not held back by it.
    await request(app).post('/api/agent/escalations').set(two).send(body).expect(400);
  });

  test('is read on every request, so raising it takes effect at once', async () => {
    const run = await newRun();
    for (let i = 0; i < 3; i += 1) await request(app).get('/api/agent/runs').set(run).expect(403);
    await request(app).get('/api/agent/runs').set(run).expect(429);

    process.env.AGENT_API_RATE_LIMIT_MAX = '100';
    await request(app).get('/api/agent/runs').set(run).expect(403);
  });

  test('is off under test unless a test turns it on, so other suites are not affected', async () => {
    delete process.env.AGENT_API_RATE_LIMIT_MAX;
    const admin = bearer(tokens, 'admin');
    for (let i = 0; i < 10; i += 1) await settings(admin).expect(200);
  });
});

describe('the per-address limit', () => {
  test('comes before authentication, so a flood of unauthenticated requests is answered 429', async () => {
    process.env.AGENT_API_IP_RATE_LIMIT_MAX = '2';
    await request(app).get('/api/agent/settings').expect(401);
    await request(app).get('/api/agent/settings').expect(401);
    await request(app).get('/api/agent/settings').expect(429);
    // It covers the proposal routes too (they sit behind the ticket routes' own sign-in check, so it
    // is a signed-in request that meets it there).
    await proposal(bearer(tokens, 'admin')).expect(429);
  });

  test('is far above the per-caller limit, so it only ever stops a flood', () => {
    const ip = agentIpRateLimitOptions().limit as () => number;
    const caller = agentRateLimitOptions().limit as () => number;
    delete process.env.AGENT_API_RATE_LIMIT_MAX;
    delete process.env.AGENT_API_IP_RATE_LIMIT_MAX;
    expect(caller()).toBe(120);
    expect(ip()).toBeGreaterThanOrEqual(caller() * 4);
  });
});
