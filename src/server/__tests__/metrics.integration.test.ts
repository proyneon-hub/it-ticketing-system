// Prometheus metrics against the real app: who may read them, that route labels stay bounded,
// and that the counters move when things happen.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import {
  bearer,
  signInAll,
  startTestDatabase,
  type Account,
  type TestDatabase,
  type Tokens,
} from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
const as = (role: Account) => bearer(tokens, role);

const TOKEN = 'a-long-metrics-token-of-at-least-32-characters';
const scrape = () =>
  request(app).get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(200);

// The value of one sample, matched by its metric name and (part of) its label set.
function sample(text: string, name: string, labels = ''): number {
  const line = text
    .split('\n')
    .find((row) => row.startsWith(`${name}{`) && row.includes(labels) && !row.startsWith('#'));
  const bare = text.split('\n').find((row) => row.startsWith(`${name} `));
  const row = labels ? line : (bare ?? line);
  return row ? Number(row.slice(row.lastIndexOf(' ') + 1)) : 0;
}

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Ticket.init();
  await OutboxEvent.init();
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  delete process.env.METRICS_TOKEN;
  delete process.env.WEBHOOK_URL;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  process.env.METRICS_TOKEN = TOKEN;
  delete process.env.WEBHOOK_URL;
  await Ticket.deleteMany({});
  await OutboxEvent.deleteMany({});
});

describe('who can read them', () => {
  test('the endpoint does not exist unless a token is configured', async () => {
    delete process.env.METRICS_TOKEN;
    const off = await request(app).get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`);
    const missing = await request(app).get('/api/no-such-thing');

    expect(off.status).toBe(404);
    expect(off.body.code).toBe('NOT_FOUND');
    expect(off.body.message).toMatch(/^Route not found/);
    expect(missing.status).toBe(404);
  });

  test('a token that is too short is treated as no token', async () => {
    process.env.METRICS_TOKEN = 'short';
    await request(app).get('/api/metrics').set('Authorization', 'Bearer short').expect(404);
  });

  test.each([
    ['no credentials', undefined],
    ['a wrong token', 'Bearer not-the-token'],
    ['a bare token', TOKEN],
  ])('refuses %s', async (_name, header) => {
    const req = request(app).get('/api/metrics');
    const response = await (header ? req.set('Authorization', header) : req);
    expect(response.status).toBe(401);
    expect(response.text).not.toContain('http_requests_total');
  });

  test('a signed-in admin is not the scraper', async () => {
    await request(app).get('/api/metrics').set(as('admin')).expect(401);
  });

  test('serves the Prometheus text format, with the process metrics too', async () => {
    const response = await scrape();

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# TYPE http_request_duration_seconds histogram');
    expect(response.text).toContain('# TYPE http_requests_total counter');
    expect(response.text).toContain('process_cpu_user_seconds_total');
    expect(response.text).toContain('nodejs_heap_size_total_bytes');
  });
});

describe('what is measured', () => {
  test('labels requests by route template, so ids and probes cannot multiply the series', async () => {
    const first = await Ticket.create({ ticketNumber: 'TKT-7001', title: 'One' });
    const second = await Ticket.create({ ticketNumber: 'TKT-7002', title: 'Two' });

    await request(app).get(`/api/tickets/${first.id}`).set(as('admin')).expect(200);
    await request(app).get(`/api/tickets/${second.id}`).set(as('admin')).expect(200);
    await request(app).get('/api/wp-admin/setup-config-9f3a1c.php').expect(404);
    const text = (await scrape()).text;

    expect(sample(text, 'http_requests_total', 'route="/api/tickets/:id",status="200"')).toBe(2);
    expect(text).not.toContain(first.id);
    expect(text).not.toContain(second.id);
    expect(text).toContain('route="unmatched"');
    expect(text).not.toContain('setup-config');
  });

  test('counts by status and records a duration histogram', async () => {
    await request(app).get('/api/tickets').expect(401);
    await request(app).get('/api/tickets').set(as('admin')).expect(200);
    const text = (await scrape()).text;

    // A request turned away by authentication never reaches its route, so it is "unmatched".
    expect(sample(text, 'http_requests_total', 'route="unmatched",status="401"')).toBeGreaterThan(
      0
    );
    expect(
      sample(text, 'http_requests_total', 'route="/api/tickets",status="200"')
    ).toBeGreaterThan(0);
    // Label order in a sample is not fixed, so check both labels are on the same bucket line.
    expect(text).toMatch(
      /http_request_duration_seconds_bucket\{(?=[^}]*route="\/api\/tickets")(?=[^}]*le="0.5")[^}]*\}/
    );
    expect(text).toMatch(/http_request_duration_seconds_count\{[^}]*status_class="2xx"/);
  });

  test('counts tickets created', async () => {
    const before = sample((await scrape()).text, 'tickets_created_total');

    await request(app).post('/api/tickets').set(as('tech')).send({ title: 'Counted' }).expect(201);
    await request(app).post('/api/tickets').set(as('tech')).send({}).expect(400); // Not created.

    expect(sample((await scrape()).text, 'tickets_created_total')).toBe(before + 1);
  });

  test('reports the outbox by status, read from the database at scrape time', async () => {
    process.env.WEBHOOK_URL = 'http://127.0.0.1:9/hook';
    await request(app)
      .post('/api/tickets')
      .set(as('tech'))
      .send({ title: 'Announced' })
      .expect(201);
    await OutboxEvent.updateOne({}, { $set: { status: 'dead' } });
    await request(app)
      .post('/api/tickets')
      .set(as('tech'))
      .send({ title: 'Announced 2' })
      .expect(201);

    const text = (await scrape()).text;

    expect(sample(text, 'outbox_events', 'status="dead"')).toBe(1);
    expect(sample(text, 'outbox_events', 'status="pending"')).toBe(1);
    expect(sample(text, 'outbox_events', 'status="delivered"')).toBe(0);
  });
});
