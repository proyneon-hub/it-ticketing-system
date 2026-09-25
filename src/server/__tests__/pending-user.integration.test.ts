// A ticket waiting on its requester (status pending-user): who can put it there, that it
// pauses the SLA clock everywhere the clock is counted, and that the requester's reply
// puts it back into work. Real app, real database, nothing mocked.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import type { Status } from '../../shared/ticket-constants';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { resumeFromPending } from '../repositories/ticketRepository';
import { transaction } from '../repositories/transaction';
import { issueServiceToken } from '../security/accessToken';
import { escalate } from '../services/slaService';
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

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00Z');
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * HOUR);

let sequence = 0;
function seed(overrides: { status?: Status; dueInHours?: number; requester?: string } = {}) {
  sequence += 1;
  const { status = 'in-progress', dueInHours = 48, requester = 'user@demo.local' } = overrides;
  return Ticket.create({
    ticketNumber: `TKT-${String(sequence).padStart(4, '0')}`,
    title: `Ticket ${sequence}`,
    requesterEmail: requester,
    priority: 'high',
    assignee: 'Theo Technician',
    status,
    createdAt: at(-100),
    dueAt: at(dueInHours),
  });
}

const stored = (id: unknown) => Ticket.findById(id).lean();
const comment = (account: Account, id: unknown, body: object) =>
  request(app).post(`/api/tickets/${id}/comments`).set(as(account)).send(body);

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Ticket.init();
  await OutboxEvent.init();
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  delete process.env.WEBHOOK_URL;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  sequence = 0;
  delete process.env.WEBHOOK_URL;
  await Ticket.deleteMany({});
  await OutboxEvent.deleteMany({});
});

describe('putting a ticket into pending-user', () => {
  test.each(['open', 'in-progress'] as const)('a technician can, from %s', async (status) => {
    const ticket = await seed({ status });
    const response = await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .send({ status: 'pending-user' });

    expect(response.status).toBe(200);
    expect(response.body.ticket.status).toBe('pending-user');
  });

  test('nobody can from resolved or closed', async () => {
    for (const status of ['resolved', 'closed'] as const) {
      const ticket = await seed({ status });
      const response = await request(app)
        .patch(`/api/tickets/${ticket._id}`)
        .set(as('admin'))
        .send({ status: 'pending-user' });
      expect(response.status).toBe(409);
    }
  });

  test('a requester cannot, because status is not theirs to change', async () => {
    const ticket = await seed();
    const response = await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('user'))
      .send({ status: 'pending-user' });
    expect(response.status).toBe(403);
  });

  test('the agent can, on its own ticket, and only to pending-user', async () => {
    const ticket = await seed();
    const agent = {
      Authorization: `Bearer ${await issueServiceToken({ ticketId: String(ticket._id), runId: 'r1' })}`,
    };

    const resolve = await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(agent)
      .send({ status: 'resolved' });
    expect(resolve.status).toBe(403);

    const hand = await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(agent)
      .send({ status: 'pending-user' });
    expect(hand.status).toBe(200);
    expect(hand.body.ticket.status).toBe('pending-user');
    expect(hand.body.ticket.activity.at(-1)).toMatchObject({
      action: 'status_changed',
      from: 'in-progress',
      to: 'pending-user',
      actorRole: 'agent',
    });
  });
});

describe('the SLA clock while waiting on the requester', () => {
  test('the escalation job leaves an overdue pending-user ticket alone', async () => {
    const ticket = await seed({ status: 'pending-user', dueInHours: -50 });

    expect(await escalate(NOW)).toEqual({ breached: 0, atRisk: 0, more: false });

    const after = await stored(ticket._id);
    expect(after?.slaBreachedAt).toBeUndefined();
    expect(after?.priority).toBe('high');
    expect(after?.activity).toHaveLength(0);
  });

  test('the same ticket is breached as soon as it is worked again', async () => {
    const ticket = await seed({ status: 'pending-user', dueInHours: -50 });
    await escalate(NOW);
    await Ticket.updateOne({ _id: ticket._id }, { $set: { status: 'in-progress' } });

    expect(await escalate(NOW)).toMatchObject({ breached: 1 });
  });

  test('it is not counted as breached or due soon, and not listed under either filter', async () => {
    await seed({ status: 'pending-user', dueInHours: -5 });
    const soon = await seed({ status: 'pending-user', dueInHours: 5 });
    const overdue = await seed({ status: 'in-progress', dueInHours: -5 });
    // Relative to the real clock now, which is what the endpoints use.
    const now = Date.now();
    await Ticket.updateMany({ status: 'pending-user' }, [
      { $set: { dueAt: { $add: [new Date(now), { $subtract: ['$dueAt', NOW] }] } } },
    ]);
    await Ticket.updateOne({ _id: overdue._id }, { $set: { dueAt: new Date(now - HOUR) } });

    const breached = await request(app).get('/api/tickets?sla=breached').set(as('tech'));
    expect(breached.body.tickets.map((t: { _id: string }) => t._id)).toEqual([String(overdue._id)]);

    const dueSoon = await request(app).get('/api/tickets?sla=due-soon').set(as('tech'));
    expect(dueSoon.body.tickets.map((t: { _id: string }) => t._id)).not.toContain(String(soon._id));

    const stats = await request(app).get('/api/tickets/stats').set(as('tech'));
    expect(stats.body.sla).toEqual({ breached: 1, dueSoon: 0 });
    expect(stats.body.byStatus['pending-user']).toBe(2);
  });

  test('asking for pending-user tickets together with an SLA filter matches nothing', async () => {
    await seed({ status: 'pending-user', dueInHours: -5 });
    const response = await request(app)
      .get('/api/tickets?sla=breached&status=pending-user')
      .set(as('tech'));
    expect(response.body.tickets).toEqual([]);
  });
});

describe("the requester's reply", () => {
  test('puts the ticket back in progress and records it in the history', async () => {
    const ticket = await seed({ status: 'pending-user' });
    const before = await stored(ticket._id);

    const response = await comment('user', ticket._id, { body: 'Yes, that fixed it… mostly.' });
    expect(response.status).toBe(201);

    const after = await stored(ticket._id);
    expect(after?.status).toBe('in-progress');
    expect(after?.__v).toBe((before?.__v ?? 0) + 1);
    expect(after?.activity.map((entry) => entry.action)).toEqual([
      'comment_added',
      'status_changed',
    ]);
    expect(after?.activity.at(-1)).toMatchObject({
      from: 'pending-user',
      to: 'in-progress',
      actorRole: 'user',
      detail: 'Requester replied',
    });
  });

  test('announces the move when notifications are on', async () => {
    process.env.WEBHOOK_URL = 'http://127.0.0.1:9/hook';
    const ticket = await seed({ status: 'pending-user' });
    await comment('user', ticket._id, { body: 'Still broken.' });

    const events = await OutboxEvent.find().lean();
    expect(events.map((event) => event.type).sort()).toEqual([
      'ticket.comment_added',
      'ticket.status_changed',
    ]);
    expect(events.find((e) => e.type === 'ticket.status_changed')?.payload).toMatchObject({
      change: { from: 'pending-user', to: 'in-progress' },
      actor: { role: 'user' },
    });
  });

  test.each([
    ['a technician replying', 'tech', { body: 'Any update?' }],
    [
      'a technician leaving an internal note',
      'tech',
      { body: 'Chase later', visibility: 'internal' },
    ],
    ['an admin replying', 'admin', { body: 'Checking.' }],
  ] as const)('is the only thing that does it: not %s', async (_who, account, body) => {
    const ticket = await seed({ status: 'pending-user' });
    expect((await comment(account, ticket._id, body)).status).toBe(201);
    expect((await stored(ticket._id))?.status).toBe('pending-user');
  });

  test('does not touch a ticket that was not waiting on them', async () => {
    const ticket = await seed({ status: 'open' });
    await comment('user', ticket._id, { body: 'Hello?' });
    expect((await stored(ticket._id))?.status).toBe('open');
  });

  test("cannot reach someone else's ticket, so cannot move it", async () => {
    const ticket = await seed({ status: 'pending-user', requester: 'someone@else.example' });
    expect((await comment('user', ticket._id, { body: 'Hi' })).status).toBe(404);
    expect((await stored(ticket._id))?.status).toBe('pending-user');
  });

  test('a technician who moved it first is not overwritten', async () => {
    const ticket = await seed({ status: 'pending-user' });
    // The status has already moved on by the time the (stale) reply is applied.
    await Ticket.updateOne({ _id: ticket._id }, { $set: { status: 'resolved' } });

    const resumed = await transaction((tx) =>
      resumeFromPending(ticket._id, { action: 'status_changed' }, tx)
    );

    expect(resumed).toBeNull();
    expect((await stored(ticket._id))?.status).toBe('resolved');
  });
});
