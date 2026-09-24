// The SLA escalation job against a real database with a fixed clock: it runs at any time,
// any number of times, and does each step once.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import type { Priority, Status } from '../../shared/ticket-constants';
import OutboxEvent from '../models/OutboxEvent';
import Ticket from '../models/Ticket';
import { applySlaStep } from '../repositories/ticketRepository';
import { transaction } from '../repositories/transaction';
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
function seed(
  overrides: { dueInHours?: number; priority?: Priority; status?: Status; title?: string } = {}
) {
  sequence += 1;
  const { dueInHours = -1, priority = 'high', status = 'open', title } = overrides;
  return Ticket.create({
    ticketNumber: `TKT-${String(sequence).padStart(4, '0')}`,
    title: title ?? `Ticket ${sequence}`,
    requesterEmail: 'someone@example.com',
    priority,
    status,
    createdAt: at(-100),
    dueAt: at(dueInHours),
  });
}

const stored = (id: unknown) => Ticket.findById(id).lean();

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

describe('a breach', () => {
  test('marks the ticket, raises its priority one step and records who did it', async () => {
    const ticket = await seed({ priority: 'medium', dueInHours: -2 });

    const result = await escalate(NOW);

    expect(result).toEqual({ breached: 1, atRisk: 0, more: false });
    const after = await stored(ticket._id);
    expect(after?.priority).toBe('high');
    expect(after?.slaBreachedAt).toEqual(NOW);
    expect(after?.slaAtRiskAt).toBeUndefined();
    expect(after?.activity.at(-1)).toMatchObject({
      action: 'sla_breached',
      actorName: 'SLA automation',
      actorRole: 'system',
      from: 'medium',
      to: 'high',
    });
  });

  test('does not move the deadline, so the ticket keeps showing how late it is (a deliberate exception to DEF-007)', async () => {
    const ticket = await seed({ priority: 'medium', dueInHours: -2 });

    await escalate(NOW);

    expect((await stored(ticket._id))?.dueAt).toEqual(at(-2));
    // The same priority change made by a person still resets the deadline, as before.
    const edited = await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .send({ priority: 'low' })
      .expect(200);
    expect(new Date(edited.body.ticket.dueAt).getTime()).not.toBe(at(-2).getTime());
  });

  test('an urgent ticket is marked and stays urgent', async () => {
    const ticket = await seed({ priority: 'urgent', dueInHours: -1 });

    expect(await escalate(NOW)).toMatchObject({ breached: 1 });

    const after = await stored(ticket._id);
    expect(after?.priority).toBe('urgent');
    expect(after?.slaBreachedAt).toEqual(NOW);
    expect(after?.activity.at(-1)?.detail).toBe('SLA deadline passed');
  });

  test('bumps the version, so someone editing from before the change gets a conflict', async () => {
    const ticket = await seed({ dueInHours: -1 });
    const before = (await stored(ticket._id))?.__v ?? 0;

    await escalate(NOW);

    expect((await stored(ticket._id))?.__v).toBe(before + 1);
    await request(app)
      .patch(`/api/tickets/${ticket._id}`)
      .set(as('tech'))
      .set('If-Match', `"${before}"`)
      .send({ priority: 'low' })
      .expect(409);
  });
});

describe('running it again', () => {
  test('changes nothing: no second raise, no second history entry, no new version', async () => {
    const ticket = await seed({ priority: 'low', dueInHours: -3 });
    await escalate(NOW);
    const first = await stored(ticket._id);

    expect(await escalate(NOW)).toEqual({ breached: 0, atRisk: 0, more: false });
    expect(await escalate(at(5))).toEqual({ breached: 0, atRisk: 0, more: false });

    const second = await stored(ticket._id);
    expect(second?.priority).toBe('medium'); // Raised once only.
    expect(second?.activity).toHaveLength(first?.activity.length ?? -1);
    expect(second?.__v).toBe(first?.__v);
    expect(second?.updatedAt).toEqual(first?.updatedAt);
  });

  test('two runs at the same moment step a ticket once', async () => {
    const ticket = await seed({ priority: 'low', dueInHours: -1 });

    const [a, b, c] = await Promise.all([escalate(NOW), escalate(NOW), escalate(NOW)]);

    expect(a.breached + b.breached + c.breached).toBe(1);
    const after = await stored(ticket._id);
    expect(after?.priority).toBe('medium');
    expect(after?.activity.filter((entry) => entry.action === 'sla_breached')).toHaveLength(1);
  });
});

describe('at risk, then breached', () => {
  test('a ticket due within 24 hours is marked once and its priority is left alone', async () => {
    const ticket = await seed({ priority: 'high', dueInHours: 5 });

    expect(await escalate(NOW)).toEqual({ breached: 0, atRisk: 1, more: false });

    const after = await stored(ticket._id);
    expect(after?.priority).toBe('high');
    expect(after?.slaAtRiskAt).toEqual(NOW);
    expect(after?.slaBreachedAt).toBeUndefined();
    expect(after?.activity.at(-1)).toMatchObject({ action: 'sla_at_risk', actorRole: 'system' });
    expect(await escalate(at(1))).toEqual({ breached: 0, atRisk: 0, more: false });
  });

  test('carries on to a breach once the deadline passes', async () => {
    const ticket = await seed({ priority: 'high', dueInHours: 5 });
    await escalate(NOW);

    expect(await escalate(at(6))).toEqual({ breached: 1, atRisk: 0, more: false });

    const after = await stored(ticket._id);
    expect(after?.slaAtRiskAt).toEqual(NOW);
    expect(after?.slaBreachedAt).toEqual(at(6));
    expect(after?.priority).toBe('urgent');
    expect(after?.activity.map((entry) => entry.action)).toEqual(['sla_at_risk', 'sla_breached']);
  });

  test('a ticket that was never seen at risk is breached straight away', async () => {
    const ticket = await seed({ dueInHours: 5 });
    expect(await escalate(at(10))).toMatchObject({ breached: 1, atRisk: 0 });
    expect((await stored(ticket._id))?.slaAtRiskAt).toBeUndefined();
  });
});

describe('what it leaves alone', () => {
  test.each(['resolved', 'closed'] as const)(
    'a %s ticket, even a long overdue one',
    async (status) => {
      const ticket = await seed({ status, dueInHours: -50 });
      expect(await escalate(NOW)).toEqual({ breached: 0, atRisk: 0, more: false });
      const after = await stored(ticket._id);
      expect(after?.slaBreachedAt).toBeUndefined();
      expect(after?.priority).toBe('high');
    }
  );

  test('a ticket with a distant deadline', async () => {
    const ticket = await seed({ dueInHours: 25 });
    expect(await escalate(NOW)).toEqual({ breached: 0, atRisk: 0, more: false });
    expect((await stored(ticket._id))?.activity).toHaveLength(0);
  });

  test('does not write over a priority someone changed after the job looked', async () => {
    const ticket = await seed({ priority: 'medium', dueInHours: -1 });
    // The job planned "medium to high", but a person made it "low" in the meantime.
    await Ticket.updateOne({ _id: ticket._id }, { $set: { priority: 'low' } });

    const applied = await transaction((tx) =>
      applySlaStep(
        ticket._id,
        {
          marker: 'slaBreachedAt',
          set: { slaBreachedAt: NOW, priority: 'high' },
          activity: { action: 'sla_breached' },
          expectedPriority: 'medium',
        },
        tx
      )
    );

    expect(applied).toBeNull();
    const after = await stored(ticket._id);
    expect(after?.priority).toBe('low');
    expect(after?.slaBreachedAt).toBeUndefined();
    // The next run plans from the new priority.
    expect(await escalate(NOW)).toMatchObject({ breached: 1 });
    expect((await stored(ticket._id))?.priority).toBe('medium');
  });
});

describe('at scale', () => {
  test('works through more overdue tickets than one batch holds', async () => {
    await Ticket.insertMany(
      Array.from({ length: 230 }, (_, index) => ({
        ticketNumber: `TKT-${String(index + 1).padStart(4, '0')}`,
        title: `Overdue ${index}`,
        requesterEmail: 'someone@example.com',
        priority: 'low',
        createdAt: at(-100),
        dueAt: at(-1 - index / 100),
      }))
    );

    const result = await escalate(NOW);

    expect(result).toEqual({ breached: 230, atRisk: 0, more: false });
    expect(await Ticket.countDocuments({ slaBreachedAt: { $exists: true } })).toBe(230);
    expect(await Ticket.countDocuments({ priority: 'medium' })).toBe(230);
  });
});

describe('announcing it', () => {
  test('a breach and an at-risk step each leave an event, when notifications are on', async () => {
    process.env.WEBHOOK_URL = 'http://127.0.0.1:9/hook';
    await seed({ priority: 'medium', dueInHours: -1, title: 'Late one' });
    await seed({ dueInHours: 4, title: 'Nearly late' });

    await escalate(NOW);

    const events = await OutboxEvent.find().sort({ _id: 1 }).lean();
    expect(events.map((event) => event.type).sort()).toEqual([
      'ticket.sla_at_risk',
      'ticket.sla_breached',
    ]);
    const breach = events.find((event) => event.type === 'ticket.sla_breached');
    expect(breach?.payload).toMatchObject({
      actor: null,
      change: { from: 'medium', to: 'high' },
      ticket: { title: 'Late one', priority: 'high' },
    });
  });

  test('a second run announces nothing again', async () => {
    process.env.WEBHOOK_URL = 'http://127.0.0.1:9/hook';
    await seed({ dueInHours: -1 });
    await escalate(NOW);
    await escalate(NOW);

    expect(await OutboxEvent.countDocuments()).toBe(1);
  });

  test('leaves no event when notifications are off', async () => {
    await seed({ dueInHours: -1 });
    await escalate(NOW);
    expect(await OutboxEvent.countDocuments()).toBe(0);
  });
});
