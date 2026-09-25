// The knowledge base is limited per caller: each lookup runs a text query, so a runaway client
// (or agent) must not be able to hammer the database. What matters is who is counted: not
// everyone behind one address together, an agent run on its own, and not requests that were
// already turned away for being unauthenticated or not permitted.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import KbArticle from '../models/KbArticle';
import { issueServiceToken } from '../security/accessToken';
import { bearer, signInAll, startTestDatabase, type TestDatabase, type Tokens } from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
let sequence = 0;

const TICKET = '665f0f40d5d4f541f8ef2002';

// A fresh agent run each time, so every test starts with a full budget of its own.
const newRun = async () => ({
  Authorization: `Bearer ${await issueServiceToken({ ticketId: TICKET, runId: `run-${(sequence += 1)}` })}`,
});

const search = (headers: Record<string, string>) =>
  request(app).get('/api/kb?search=vpn').set(headers);

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await KbArticle.init();
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  delete process.env.KB_RATE_LIMIT_MAX;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  process.env.KB_RATE_LIMIT_MAX = '3';
});

describe('the limit', () => {
  test('lets a caller through up to it, then answers 429 in the usual error shape', async () => {
    const run = await newRun();
    for (let i = 0; i < 3; i += 1) await search(run).expect(200);

    const limited = await search(run).expect(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringMatching(/knowledge-base/),
      requestId: expect.any(String),
    });
    expect(limited.headers['ratelimit']).toBeDefined();
  });

  test('searching and reading an article share one budget', async () => {
    const run = await newRun();
    await search(run).expect(200);
    await request(app).get('/api/kb/KB-001').set(run).expect(404);
    await search(run).expect(200);

    await request(app).get('/api/kb/KB-001').set(run).expect(429);
  });

  test('is read on every request, so raising it takes effect at once', async () => {
    const run = await newRun();
    for (let i = 0; i < 3; i += 1) await search(run).expect(200);
    await search(run).expect(429);

    process.env.KB_RATE_LIMIT_MAX = '10';
    await search(run).expect(200);
  });

  test('is off under test unless a test turns it on, so other suites are not affected', async () => {
    delete process.env.KB_RATE_LIMIT_MAX;
    const run = await newRun();
    for (let i = 0; i < 20; i += 1) await search(run).expect(200);
  });
});

describe('who is counted', () => {
  test('each agent run has a budget of its own, though they share an address and a name', async () => {
    const first = await newRun();
    const second = await newRun();
    for (let i = 0; i < 3; i += 1) await search(first).expect(200);
    await search(first).expect(429);

    for (let i = 0; i < 3; i += 1) await search(second).expect(200);
  });

  test('one person running out does not affect anyone else', async () => {
    for (let i = 0; i < 3; i += 1) await search(bearer(tokens, 'tech')).expect(200);
    await search(bearer(tokens, 'tech')).expect(429);

    await search(bearer(tokens, 'admin')).expect(200);
    await search(await newRun()).expect(200);
  });

  test('a caller who is not signed in, or not permitted, is turned away before the limit', async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app).get('/api/kb?search=vpn').expect(401);
      await search(bearer(tokens, 'user')).expect(403);
    }
    // Neither used up anyone's budget: the requester's would be exhausted after three.
    await search(await newRun()).expect(200);
  });
});
