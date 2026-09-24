// Trends against a real database, with the clock fixed and every expected number worked
// out by hand from the tickets below.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import type { TokenPayload } from '../auth';
import { connectToDatabase } from '../db';
import Ticket from '../models/Ticket';
import { getTrends } from '../services/ticketService';
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

const admin: TokenPayload = {
  sub: 'admin',
  exp: 0,
  name: 'Priya Admin',
  email: 'admin@demo.local',
  role: 'admin',
};

// Noon in Toronto (EDT, UTC-4).
const NOW = new Date('2026-06-15T16:00:00Z');

let sequence = 0;
function ticket(fields: {
  createdAt: string;
  resolvedAt?: string;
  dueAt: string;
  requesterEmail?: string;
}) {
  sequence += 1;
  return {
    ticketNumber: `TKT-${String(sequence).padStart(4, '0')}`,
    title: `Ticket ${sequence}`,
    requesterEmail: fields.requesterEmail ?? 'someone@example.com',
    status: fields.resolvedAt ? ('resolved' as const) : ('open' as const),
    createdAt: new Date(fields.createdAt),
    ...(fields.resolvedAt ? { resolvedAt: new Date(fields.resolvedAt) } : {}),
    dueAt: new Date(fields.dueAt),
  };
}

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
  sequence = 0;
  await Ticket.deleteMany({});
  // Toronto (UTC-4) evening / morning boundaries are what make these cases interesting.
  await Ticket.insertMany([
    // A: opened the evening of the 12th in Toronto (03:00Z on the 13th), so before the
    // window there but on the 13th in UTC. Resolved 16:00 on the 13th, 17 h later, in time.
    ticket({
      createdAt: '2026-06-13T03:00:00Z',
      resolvedAt: '2026-06-13T20:00:00Z',
      dueAt: '2026-06-14T00:00:00Z',
    }),
    // B: opened 01:00 on the 13th, resolved 01:00 on the 14th (24 h), one hour late.
    ticket({
      createdAt: '2026-06-13T05:00:00Z',
      resolvedAt: '2026-06-14T05:00:00Z',
      dueAt: '2026-06-14T04:00:00Z',
    }),
    // C: opened on the 14th, still open.
    ticket({ createdAt: '2026-06-14T12:00:00Z', dueAt: '2026-06-16T12:00:00Z' }),
    // D: opened 22:00 on the 14th in Toronto (02:00Z on the 15th), resolved 06:00 on the 15th, 8 h, in time.
    ticket({
      createdAt: '2026-06-15T02:00:00Z',
      resolvedAt: '2026-06-15T10:00:00Z',
      dueAt: '2026-06-16T00:00:00Z',
    }),
    // E: opened before the window, resolved on the 15th after 120 h, past its deadline.
    ticket({
      createdAt: '2026-06-10T12:00:00Z',
      resolvedAt: '2026-06-15T12:00:00Z',
      dueAt: '2026-06-11T12:00:00Z',
      requesterEmail: 'user@demo.local',
    }),
    // F: long finished, so in neither count.
    ticket({
      createdAt: '2026-05-01T12:00:00Z',
      resolvedAt: '2026-06-01T12:00:00Z',
      dueAt: '2026-05-03T12:00:00Z',
    }),
  ]);
});

describe('the numbers', () => {
  test('count per day in the caller’s time zone, and work out the headline figures', async () => {
    const trends = await getTrends(admin, { days: 3, tz: 'America/Toronto' }, NOW);

    expect(trends.series).toEqual([
      { date: '2026-06-13', opened: 1, resolved: 1 }, // B opened; A resolved (A opened on the 12th)
      { date: '2026-06-14', opened: 2, resolved: 1 }, // C and D opened; B resolved
      { date: '2026-06-15', opened: 0, resolved: 2 }, // D and E resolved
    ]);
    // Resolved in the window: A 17 h + B 24 h + D 8 h + E 120 h = 169 h over 4 tickets.
    expect(trends.resolution).toEqual({ resolved: 4, meanHours: 42.3 });
    // A and D met their deadline; B and E did not.
    expect(trends.sla).toEqual({ resolved: 4, met: 2, compliancePercent: 50 });
  });

  test('the same tickets fall on different days in UTC', async () => {
    const trends = await getTrends(admin, { days: 3, tz: 'UTC' }, NOW);

    expect(trends.series).toEqual([
      { date: '2026-06-13', opened: 2, resolved: 1 }, // A and B opened
      { date: '2026-06-14', opened: 1, resolved: 1 }, // C opened
      { date: '2026-06-15', opened: 1, resolved: 2 }, // D opened
    ]);
    expect(trends.resolution.resolved).toBe(4);
  });

  test('a shorter window leaves out what happened before it', async () => {
    const trends = await getTrends(admin, { days: 1, tz: 'America/Toronto' }, NOW);

    expect(trends.series).toEqual([{ date: '2026-06-15', opened: 0, resolved: 2 }]);
    // Only D (8 h, met) and E (120 h, missed): mean 64 h, 50%.
    expect(trends.resolution).toEqual({ resolved: 2, meanHours: 64 });
    expect(trends.sla.compliancePercent).toBe(50);
  });

  test('reports no averages, not zero, when nothing was resolved', async () => {
    await Ticket.deleteMany({});

    const trends = await getTrends(admin, { days: 7, tz: 'UTC' }, NOW);

    expect(trends.series).toHaveLength(7);
    expect(trends.series.every((day) => day.opened === 0 && day.resolved === 0)).toBe(true);
    expect(trends.resolution.meanHours).toBeNull();
    expect(trends.sla.compliancePercent).toBeNull();
  });
});

describe('scoping', () => {
  test("a requester's trends cover only their own tickets", async () => {
    const requester: TokenPayload = {
      sub: 'user',
      exp: 0,
      name: 'Morgan Lee',
      email: 'user@demo.local',
      role: 'user',
    };

    const trends = await getTrends(requester, { days: 3, tz: 'America/Toronto' }, NOW);

    // Only E is theirs: opened before the window, resolved on the 15th after 120 h, late.
    expect(trends.series).toEqual([
      { date: '2026-06-13', opened: 0, resolved: 0 },
      { date: '2026-06-14', opened: 0, resolved: 0 },
      { date: '2026-06-15', opened: 0, resolved: 1 },
    ]);
    expect(trends.resolution).toEqual({ resolved: 1, meanHours: 120 });
    expect(trends.sla.compliancePercent).toBe(0);
  });
});

describe('over HTTP', () => {
  test('staff get the response shape and sensible defaults', async () => {
    const response = await request(app)
      .get('/api/tickets/stats/trends')
      .set(as('tech'))
      .expect(200);

    expect(response.body.days).toBe(30);
    expect(response.body.timeZone).toBe('UTC');
    expect(response.body.series).toHaveLength(30);
  });

  test.each([
    ['days=0', 'days must be an integer between 1 and 90.'],
    ['days=91', 'days must be an integer between 1 and 90.'],
    ['days=abc', 'days must be an integer between 1 and 90.'],
    ['tz=Mars/Olympus_Mons', 'Unknown time zone.'],
  ])('rejects %s', async (query, message) => {
    const response = await request(app)
      .get(`/api/tickets/stats/trends?${query}`)
      .set(as('admin'))
      .expect(400);
    expect(response.body.message).toBe(message);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  test('needs a sign-in', async () => {
    await request(app).get('/api/tickets/stats/trends').expect(401);
  });
});
