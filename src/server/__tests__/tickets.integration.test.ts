// Integration tests: the real Express app, real Mongoose models and a real
// (in-memory) MongoDB. Nothing here is mocked, so these
// cover query building, role scoping, SLA logic and persistence end to end.
import type { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import type { Priority } from '../../shared/ticket-constants';
import Ticket, { type TicketAttrs } from '../models/Ticket';
import { generateTickets } from '../../../scripts/sampleData';
import { toFilter } from '../repositories/ticketRepository';
import { bearer, signInAll, startTestDatabase, type Account, type Tokens } from './helpers';

const HOUR = 60 * 60 * 1000;

let mongod: MongoMemoryServer;
let tokens: Tokens;
let sequence = 0;

const as = (role: Account) => bearer(tokens, role);

// Reads a ticket straight from the database; the test fails here if it is missing.
async function storedTicket(id: string) {
  const ticket = await Ticket.findById(id);
  if (!ticket) throw new Error(`Ticket ${id} is not in the database.`);
  return ticket;
}

// A row from a list response; only the fields these tests read.
interface Row {
  _id: string;
  title: string;
  priority: Priority;
}
interface Activity {
  action: string;
}

// Inserts directly through the model so each test controls the exact state it needs.
function seedTicket(overrides: Partial<TicketAttrs> = {}) {
  sequence += 1;
  return Ticket.create({
    ticketNumber: `TKT-${String(sequence).padStart(4, '0')}`,
    title: `Seeded ticket ${sequence}`,
    requesterEmail: 'other@example.com',
    ...overrides,
  });
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
  await mongoose.connection.collection('counters').deleteMany({});
});

describe('role scoping', () => {
  test('requesters only see, read and modify their own tickets', async () => {
    const mine = await seedTicket({ requesterEmail: 'user@demo.local', title: 'Mine' });
    const theirs = await seedTicket({ requesterEmail: 'other@example.com', title: 'Theirs' });

    const list = await request(app).get('/api/tickets').set(as('user')).expect(200);
    expect(list.body.data.map((ticket: Row) => ticket.title)).toEqual(['Mine']);
    expect(list.body.pagination.total).toBe(1);

    await request(app).get(`/api/tickets/${mine.id}`).set(as('user')).expect(200);
    await request(app).get(`/api/tickets/${theirs.id}`).set(as('user')).expect(404);
    await request(app)
      .patch(`/api/tickets/${theirs.id}`)
      .set(as('user'))
      .send({ title: 'Hijacked' })
      .expect(403);
  });

  test('staff see the whole queue', async () => {
    await seedTicket({ requesterEmail: 'user@demo.local' });
    await seedTicket({ requesterEmail: 'other@example.com' });

    const response = await request(app).get('/api/tickets').set(as('tech')).expect(200);
    expect(response.body.pagination.total).toBe(2);
  });

  test('a requester cannot reassign a ticket to another requester', async () => {
    const mine = await seedTicket({ requesterEmail: 'user@demo.local' });

    const response = await request(app)
      .patch(`/api/tickets/${mine.id}`)
      .set(as('user'))
      .send({ requesterEmail: 'other@example.com' })
      .expect(403);

    expect(response.body.message).toMatch(/requester/i);
    expect((await storedTicket(mine.id)).requesterEmail).toBe('user@demo.local');
  });

  test('requesters cannot change workflow fields but can edit descriptive ones', async () => {
    const mine = await seedTicket({ requesterEmail: 'user@demo.local' });

    await request(app)
      .patch(`/api/tickets/${mine.id}`)
      .set(as('user'))
      .send({ status: 'closed' })
      .expect(403);
    await request(app)
      .patch(`/api/tickets/${mine.id}`)
      .set(as('user'))
      .send({ description: 'More detail' })
      .expect(200);
  });

  test('only admins can delete', async () => {
    const ticket = await seedTicket();

    await request(app).delete(`/api/tickets/${ticket.id}`).set(as('tech')).expect(403);
    await request(app).delete(`/api/tickets/${ticket.id}`).set(as('admin')).expect(204);
    await request(app).delete(`/api/tickets/${ticket.id}`).set(as('admin')).expect(404);
  });
});

describe('sorting and pagination', () => {
  test('sorts by priority severity, not alphabetically', async () => {
    for (const priority of ['low', 'urgent', 'medium', 'high'] as const) {
      await seedTicket({ priority, title: priority });
    }

    const descending = await request(app)
      .get('/api/tickets?sortBy=priority&sortOrder=desc')
      .set(as('admin'))
      .expect(200);
    expect(descending.body.data.map((ticket: Row) => ticket.priority)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
    ]);

    const ascending = await request(app)
      .get('/api/tickets?sortBy=priority&sortOrder=asc')
      .set(as('admin'))
      .expect(200);
    expect(ascending.body.data.map((ticket: Row) => ticket.priority)).toEqual([
      'low',
      'medium',
      'high',
      'urgent',
    ]);
    expect(ascending.body.data[0]).not.toHaveProperty('priorityRank');
  });

  test('pages through tickets that tie on the sort key in a stable order', async () => {
    // Mixed priorities make the index order differ from _id order, so the test
    // only passes when _id is applied as an explicit tie-breaker.
    const priorities: Priority[] = ['urgent', 'low', 'high', 'medium', 'low'];
    for (let index = 0; index < 25; index += 1) {
      await seedTicket({ status: 'open', priority: priorities[index % priorities.length] });
    }

    const seen = [];
    for (const page of [1, 2, 3]) {
      const response = await request(app)
        .get(`/api/tickets?sortBy=status&sortOrder=asc&page=${page}&limit=10`)
        .set(as('admin'))
        .expect(200);
      expect(response.body.pagination).toMatchObject({ page, limit: 10, total: 25, totalPages: 3 });
      seen.push(...response.body.data.map((ticket: Row) => ticket._id));
    }

    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual([...seen].sort());
  });

  test('paginates priority-sorted results too', async () => {
    for (const priority of ['low', 'low', 'high', 'urgent', 'medium'] as const) {
      await seedTicket({ priority });
    }

    const page = await request(app)
      .get('/api/tickets?sortBy=priority&sortOrder=desc&page=2&limit=2')
      .set(as('admin'))
      .expect(200);

    expect(page.body.data.map((ticket: Row) => ticket.priority)).toEqual(['medium', 'low']);
  });
});

describe('SLA and status filters', () => {
  beforeEach(async () => {
    const now = Date.now();
    await seedTicket({ title: 'overdue open', status: 'open', dueAt: new Date(now - 2 * HOUR) });
    await seedTicket({
      title: 'overdue in progress',
      status: 'in-progress',
      dueAt: new Date(now - HOUR),
    });
    await seedTicket({ title: 'due soon', status: 'open', dueAt: new Date(now + 5 * HOUR) });
    await seedTicket({ title: 'healthy', status: 'open', dueAt: new Date(now + 72 * HOUR) });
    await seedTicket({
      title: 'overdue but resolved',
      status: 'resolved',
      dueAt: new Date(now - 10 * HOUR),
    });
  });

  const titles = (response: { body: { data: Row[] } }) =>
    response.body.data.map((ticket: Row) => ticket.title).sort();

  test('breached excludes resolved tickets', async () => {
    const response = await request(app)
      .get('/api/tickets?sla=breached')
      .set(as('admin'))
      .expect(200);
    expect(titles(response)).toEqual(['overdue in progress', 'overdue open']);
  });

  test('due-soon only includes work due within 24 hours', async () => {
    const response = await request(app)
      .get('/api/tickets?sla=due-soon')
      .set(as('admin'))
      .expect(200);
    expect(titles(response)).toEqual(['due soon']);
  });

  test('an SLA filter combines with the status filter instead of overwriting it', async () => {
    const response = await request(app)
      .get('/api/tickets?sla=breached&status=in-progress')
      .set(as('admin'))
      .expect(200);
    expect(titles(response)).toEqual(['overdue in progress']);
  });

  test('a terminal status with an SLA filter matches nothing', async () => {
    const response = await request(app)
      .get('/api/tickets?sla=breached&status=resolved')
      .set(as('admin'))
      .expect(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
  });

  test('stats only count what the requester may see', async () => {
    await seedTicket({ requesterEmail: 'user@demo.local', status: 'open', priority: 'urgent' });

    const response = await request(app).get('/api/tickets/stats').set(as('user')).expect(200);

    expect(response.body).toMatchObject({
      total: 1,
      byStatus: { open: 1 },
      byPriority: { urgent: 1 },
    });
  });

  test('stats agree with the filters', async () => {
    const response = await request(app).get('/api/tickets/stats').set(as('admin')).expect(200);
    expect(response.body).toMatchObject({
      total: 5,
      byStatus: { open: 3, 'in-progress': 1, resolved: 1, closed: 0 },
      sla: { breached: 2, dueSoon: 1 },
    });
  });
});

describe('search', () => {
  const titles = async (query: string, role: Account = 'admin') =>
    (await request(app).get(`/api/tickets?${query}`).set(as(role)).expect(200)).body.data.map(
      (ticket: Row) => ticket.title
    );

  test('matches whole words in title, description, people and category, ignoring case', async () => {
    await seedTicket({ title: 'VPN client fails', requesterName: 'Casey Brown' });
    await seedTicket({ title: 'Printer jam', description: 'Paper stuck in tray two' });
    await seedTicket({ title: 'Laptop', category: 'Onboarding' });
    await seedTicket({ title: 'Mouse', requesterEmail: 'avery@example.com' });

    expect(await titles('search=vpn')).toEqual(['VPN client fails']);
    expect(await titles('search=CASEY')).toEqual(['VPN client fails']);
    expect(await titles('search=paper')).toEqual(['Printer jam']);
    expect(await titles('search=onboarding')).toEqual(['Laptop']);
    expect(await titles('search=avery')).toEqual(['Mouse']);
  });

  test('matches other forms of a word, so connecting finds connect', async () => {
    await seedTicket({ title: 'Cannot connect to Wi-Fi' });
    await seedTicket({ title: 'Something else' });

    expect(await titles('search=connecting')).toEqual(['Cannot connect to Wi-Fi']);
  });

  test('finds a ticket by the start of its number', async () => {
    await seedTicket({ title: 'First' });
    await seedTicket({ title: 'Second' });
    await seedTicket({ ticketNumber: 'TKT-0100', title: 'Hundredth' });

    expect(await titles('search=tkt-0002&sortBy=ticketNumber&sortOrder=asc')).toEqual(['Second']);
    expect(await titles('search=TKT-00&sortBy=ticketNumber&sortOrder=asc')).toEqual([
      'First',
      'Second',
    ]);
    expect(await titles('search=tkt-01')).toEqual(['Hundredth']);
  });

  test('ranks the best match first unless a sort is requested', async () => {
    // The description mention is newer; the title mention is more relevant.
    await seedTicket({ title: 'VPN is down', createdAt: new Date('2026-01-01') });
    await seedTicket({
      title: 'Something else',
      description: 'The vpn is mentioned here',
      createdAt: new Date('2026-06-01'),
    });

    expect(await titles('search=vpn')).toEqual(['VPN is down', 'Something else']);
    expect(await titles('search=vpn&sortBy=createdAt&sortOrder=desc')).toEqual([
      'Something else',
      'VPN is down',
    ]);
  });

  test('treats the search as text, not as a pattern or as search syntax', async () => {
    await seedTicket({ title: 'Cost is (100)' });
    await seedTicket({ title: 'VPN client fails' });

    const pattern = await request(app)
      .get('/api/tickets')
      .query({ search: '.*' })
      .set(as('admin'))
      .expect(200);
    expect(pattern.body.data).toEqual([]);

    // A leading minus would exclude a word, and quotes would demand a phrase.
    expect(await titles('search=-vpn')).toEqual(['VPN client fails']);
    expect(await titles('search=%22vpn')).toEqual(['VPN client fails']);
  });

  test('combines with filters and pagination', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedTicket({ title: `Printer ${index}`, status: index < 3 ? 'open' : 'closed' });
    }

    const response = await request(app)
      .get('/api/tickets?search=printer&status=open&limit=2&page=2')
      .set(as('admin'))
      .expect(200);

    expect(response.body.pagination).toMatchObject({ total: 3, totalPages: 2, page: 2 });
    expect(response.body.data).toHaveLength(1);
  });

  test('search cannot escape a requester scope', async () => {
    await seedTicket({ requesterEmail: 'other@example.com', title: 'Secret' });

    expect(await titles('search=secret', 'user')).toEqual([]);
  });

  describe('uses an index instead of scanning every ticket', () => {
    const planFor = async (search: string) =>
      JSON.stringify(
        await Ticket.find(toFilter({ search, now: new Date() })).explain('queryPlanner')
      );

    test('text search runs on the text index', async () => {
      await seedTicket({ title: 'VPN client fails' });

      const plan = await planFor('vpn');
      expect(plan).toContain('TEXT');
      expect(plan).not.toContain('COLLSCAN');
    });

    test('a ticket-number prefix runs on the ticketNumber index', async () => {
      await seedTicket({ title: 'First' });

      const plan = await planFor('TKT-00');
      expect(plan).toContain('IXSCAN');
      expect(plan).not.toContain('COLLSCAN');
    });
  });
});

describe('ticket lifecycle', () => {
  test('numbers tickets sequentially, even when created concurrently', async () => {
    const created = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((title) =>
        request(app).post('/api/tickets').set(as('admin')).send({ title }).expect(201)
      )
    );

    const numbers = created.map((response) => response.body.ticket.ticketNumber).sort();
    expect(numbers).toEqual(['TKT-0001', 'TKT-0002', 'TKT-0003', 'TKT-0004', 'TKT-0005']);
  });

  test('forces requester-created tickets to the requester and an open, unassigned state', async () => {
    const response = await request(app)
      .post('/api/tickets')
      .set(as('user'))
      .send({
        title: 'Need access',
        requesterEmail: 'someone.else@example.com',
        status: 'closed',
        assignee: 'Theo Technician',
      })
      .expect(201);

    expect(response.body.ticket).toMatchObject({
      requesterEmail: 'user@demo.local',
      status: 'open',
      assignee: 'Unassigned',
      createdByRole: 'user',
    });
    expect(response.body.ticket.dueAt).toBeDefined();
  });

  test('derives the SLA due date from priority', async () => {
    const response = await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .send({ title: 'Outage', priority: 'urgent' })
      .expect(201);

    const { createdAt, dueAt } = response.body.ticket;
    expect(new Date(dueAt).getTime() - new Date(createdAt).getTime()).toBe(4 * HOUR);
  });

  test('records who changed what in the activity log', async () => {
    const ticket = await seedTicket({ status: 'open', assignee: 'Unassigned' });

    const response = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set(as('tech'))
      .send({ status: 'assigned', assignee: 'Theo Technician' })
      .expect(200);

    expect(response.body.ticket.activity).toEqual([
      expect.objectContaining({
        action: 'status_changed',
        from: 'open',
        to: 'assigned',
        actorEmail: 'tech@demo.local',
        actorRole: 'technician',
      }),
      expect.objectContaining({
        action: 'assignee_changed',
        from: 'Unassigned',
        to: 'Theo Technician',
      }),
    ]);
  });

  test('refuses to mark a ticket assigned without an assignee', async () => {
    const ticket = await seedTicket({ assignee: 'Unassigned' });

    await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set(as('tech'))
      .send({ status: 'assigned' })
      .expect(400);
  });

  test('sets resolvedAt on resolution, keeps it on close, and clears it on reopen', async () => {
    const ticket = await seedTicket({ status: 'in-progress' });
    const patch = (role: Account, body: Record<string, unknown>) =>
      request(app).patch(`/api/tickets/${ticket.id}`).set(as(role)).send(body).expect(200);

    const resolved = (await patch('tech', { status: 'resolved' })).body.ticket;
    expect(resolved.resolvedAt).toBeDefined();

    const closed = (await patch('tech', { status: 'closed' })).body.ticket;
    expect(closed.resolvedAt).toBe(resolved.resolvedAt);

    // Reopening a closed ticket is an admin action.
    const reopened = (await patch('admin', { status: 'in-progress' })).body.ticket;
    expect(reopened.resolvedAt).toBeUndefined();
  });

  describe('workflow', () => {
    const patchAs = (role: Account, ticket: { id?: unknown }, body: Record<string, unknown>) =>
      request(app).patch(`/api/tickets/${ticket.id}`).set(as(role)).send(body);

    test('rejects a transition the workflow does not allow with 409 and changes nothing', async () => {
      const ticket = await seedTicket({ status: 'open', assignee: 'Theo Technician' });

      const response = await patchAs('tech', ticket, { status: 'resolved' }).expect(409);

      expect(response.body.message).toBe('Cannot move a ticket from open to resolved.');
      const stored = await storedTicket(ticket.id);
      expect(stored.status).toBe('open');
      expect(stored.activity).toHaveLength(0);
    });

    test('only an admin can reopen a closed ticket', async () => {
      const ticket = await seedTicket({ status: 'closed' });

      const denied = await patchAs('tech', ticket, { status: 'in-progress' }).expect(403);
      expect(denied.body.message).toMatch(/admin/i);
      expect((await storedTicket(ticket.id)).status).toBe('closed');

      await patchAs('admin', ticket, { status: 'in-progress' }).expect(200);
    });

    test('reopening a resolved ticket clears resolvedAt and logs ticket_reopened', async () => {
      const ticket = await seedTicket({ status: 'in-progress' });
      await patchAs('tech', ticket, { status: 'resolved' }).expect(200);

      const response = await patchAs('tech', ticket, { status: 'in-progress' }).expect(200);

      expect(response.body.ticket.resolvedAt).toBeUndefined();
      const actions = response.body.ticket.activity.map((entry: Activity) => entry.action);
      expect(actions).toEqual([
        'status_changed',
        'ticket_resolved',
        'status_changed',
        'ticket_reopened',
      ]);
    });

    test('re-sending the current status is accepted and does not log a second resolution', async () => {
      const ticket = await seedTicket({ status: 'in-progress' });
      await patchAs('tech', ticket, { status: 'resolved' }).expect(200);

      const response = await patchAs('tech', ticket, { status: 'resolved' }).expect(200);

      const resolutions = response.body.ticket.activity.filter(
        (entry: Activity) => entry.action === 'ticket_resolved'
      );
      expect(resolutions).toHaveLength(1);
    });
  });

  describe('concurrent edits', () => {
    const patchWith = (
      ticket: { id?: unknown },
      body: Record<string, unknown>,
      ifMatch?: string,
      role: Account = 'tech'
    ) => {
      const req = request(app).patch(`/api/tickets/${ticket.id}`).set(as(role)).send(body);
      return ifMatch === undefined ? req : req.set('If-Match', ifMatch);
    };

    test('exposes the ticket version and bumps it on every update', async () => {
      const ticket = await seedTicket({ status: 'open' });

      const fetched = await request(app)
        .get(`/api/tickets/${ticket.id}`)
        .set(as('tech'))
        .expect(200);
      expect(fetched.body.ticket.__v).toBe(0);

      const updated = await patchWith(ticket, { priority: 'high' }, '"0"').expect(200);
      expect(updated.body.ticket.__v).toBe(1);
      expect(updated.headers.etag).toBe('"1"');
    });

    test('rejects an edit made against a stale version with 409 and applies nothing', async () => {
      const ticket = await seedTicket({ status: 'open', assignee: 'Theo Technician' });
      await patchWith(ticket, { priority: 'high' }, '"0"').expect(200);

      const stale = await patchWith(ticket, { status: 'in-progress' }, '"0"').expect(409);

      expect(stale.body.message).toMatch(/changed since you loaded/i);
      const stored = await storedTicket(ticket.id);
      expect(stored.status).toBe('open');
      expect(stored.activity.map((entry: Activity) => entry.action)).toEqual(['priority_changed']);
    });

    test('accepts strong, weak and bare version forms and rejects garbage', async () => {
      const ticket = await seedTicket();

      await patchWith(ticket, { priority: 'high' }, '"0"').expect(200);
      await patchWith(ticket, { priority: 'low' }, 'W/"1"').expect(200);
      await patchWith(ticket, { priority: 'urgent' }, '2').expect(200);
      await patchWith(ticket, { priority: 'medium' }, 'not-a-version').expect(400);
      // `*` means "any current version", the same as not sending the header.
      await patchWith(ticket, { priority: 'medium' }, '*').expect(200);
    });

    test('two edits from the same version: exactly one wins, and the log has one entry', async () => {
      const ticket = await seedTicket({ status: 'open', assignee: 'Theo Technician' });

      const responses = await Promise.all([
        patchWith(ticket, { status: 'in-progress' }, '"0"'),
        patchWith(ticket, { status: 'assigned' }, '"0"'),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const stored = await storedTicket(ticket.id);
      expect(stored.__v).toBe(1);
      expect(stored.activity).toHaveLength(1);
      expect(stored.activity[0].from).toBe('open');
    });

    test('without If-Match a lost race is retried, so activity always records the real previous value', async () => {
      const ticket = await seedTicket({ status: 'in-progress', assignee: 'Theo Technician' });

      const responses = await Promise.all([
        patchWith(ticket, { priority: 'high' }),
        patchWith(ticket, { priority: 'urgent' }),
        patchWith(ticket, { assignee: 'Una Support' }, undefined, 'admin'),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      const stored = await storedTicket(ticket.id);
      expect(stored.__v).toBe(3);
      // Each change starts from what the previous one produced: no two entries share a `from`.
      const priorityChanges = stored.activity.filter(
        (entry: Activity) => entry.action === 'priority_changed'
      );
      expect(priorityChanges).toHaveLength(2);
      expect(priorityChanges[1].from).toBe(priorityChanges[0].to);
      expect(priorityChanges[0].from).toBe('medium');
    });

    test('a ticket deleted during the update is 404, not a conflict', async () => {
      const ticket = await seedTicket();
      await Ticket.deleteOne({ _id: ticket.id });

      await patchWith(ticket, { priority: 'high' }, '"0"').expect(404);
    });
  });

  test('recalculates the SLA due date when priority changes', async () => {
    const ticket = await seedTicket({ priority: 'low' });
    const original = await storedTicket(ticket.id);

    const response = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set(as('tech'))
      .send({ priority: 'urgent' })
      .expect(200);

    expect(new Date(response.body.ticket.dueAt).getTime()).toBe(
      (original.createdAt as Date).getTime() + 4 * HOUR
    );
  });

  test('keeps an explicit due date instead of recalculating it', async () => {
    const ticket = await seedTicket({ priority: 'low' });
    const dueAt = '2031-01-01T00:00:00.000Z';

    const response = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set(as('tech'))
      .send({ priority: 'urgent', dueAt })
      .expect(200);

    expect(response.body.ticket.dueAt).toBe(dueAt);
  });
});

describe('error codes', () => {
  // Clients branch on `code`, not on the wording of `message`.
  test('every kind of failure carries a stable machine-readable code', async () => {
    const mine = await seedTicket({ requesterEmail: 'user@demo.local' });
    const open = await seedTicket({ status: 'open', assignee: 'Theo Technician' });
    const missing = '665f0f40d5d4f541f8ef1234';

    const cases: [string, { status: number; body: { code: string } }, string][] = [
      ['no token', await request(app).get('/api/tickets'), 'UNAUTHORIZED'],
      [
        'bad query',
        await request(app).get('/api/tickets?limit=1000').set(as('admin')),
        'VALIDATION_FAILED',
      ],
      [
        'bad id',
        await request(app).get('/api/tickets/not-an-id').set(as('admin')),
        'VALIDATION_FAILED',
      ],
      [
        'requester deleting',
        await request(app).delete(`/api/tickets/${mine.id}`).set(as('user')),
        'FORBIDDEN',
      ],
      [
        'unknown ticket',
        await request(app).get(`/api/tickets/${missing}`).set(as('admin')),
        'NOT_FOUND',
      ],
      ['unknown route', await request(app).get('/api/nope').set(as('admin')), 'NOT_FOUND'],
      [
        'illegal status move',
        await request(app)
          .patch(`/api/tickets/${open.id}`)
          .set(as('tech'))
          .send({ status: 'resolved' }),
        'INVALID_TRANSITION',
      ],
      [
        'stale version',
        await request(app)
          .patch(`/api/tickets/${open.id}`)
          .set(as('tech'))
          .set('If-Match', '"9"')
          .send({ priority: 'high' }),
        'VERSION_CONFLICT',
      ],
    ];

    for (const [label, response, code] of cases) {
      expect({ label, code: response.body.code }).toEqual({ label, code });
    }
    expect(cases.map(([, response]) => response.status)).toEqual([
      401, 400, 400, 403, 404, 404, 409, 409,
    ]);
  });
});

describe('validation', () => {
  test('rejects an over-long title with a field-level 400', async () => {
    const response = await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .send({ title: 'x'.repeat(121) })
      .expect(400);

    expect(response.body.errors).toEqual([expect.objectContaining({ field: 'title' })]);
  });

  test.each([
    ['a missing title', {}, 'Title is required.'],
    ['an unknown priority', { title: 't', priority: 'meh' }, 'Invalid priority.'],
    [
      'a malformed requester email',
      { title: 't', requesterEmail: 'nope' },
      'Invalid requester email.',
    ],
    ['a malformed due date', { title: 't', dueAt: 'tomorrow-ish' }, 'Invalid SLA due date.'],
  ])('rejects %s', async (_label, body, message) => {
    const response = await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .send(body)
      .expect(400);
    expect(response.body.message).toBe(message);
  });

  test('ignores fields that are not part of the ticket contract', async () => {
    const response = await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .send({
        title: 'Clean',
        ticketNumber: 'TKT-9999',
        createdByRole: 'user',
        resolvedAt: '2020-01-01',
      })
      .expect(201);

    expect(response.body.ticket.ticketNumber).toBe('TKT-0001');
    expect(response.body.ticket.createdByRole).toBe('admin');
    expect(response.body.ticket.resolvedAt).toBeUndefined();
  });

  test('rejects malformed ids and empty patches', async () => {
    const ticket = await seedTicket();

    await request(app).get('/api/tickets/not-an-id').set(as('admin')).expect(400);
    await request(app).get('/api/tickets/123456789012').set(as('admin')).expect(400);
    await request(app).patch(`/api/tickets/${ticket.id}`).set(as('admin')).send({}).expect(400);
  });

  test('rejects malformed JSON', async () => {
    await request(app)
      .post('/api/tickets')
      .set(as('admin'))
      .set('Content-Type', 'application/json')
      .send('{"title": ')
      .expect(400);
  });

  test.each([
    ['limit=101', 'limit must be an integer between 1 and 100.'],
    ['page=0', 'page must be an integer between 1 and 100000.'],
    ['status=waiting', 'Invalid status filter.'],
    ['sortBy=password', 'Invalid sortBy field.'],
    ['search[$ne]=x', 'Invalid search text.'],
  ])('rejects the list query %s', async (query, message) => {
    const response = await request(app).get(`/api/tickets?${query}`).set(as('admin')).expect(400);
    expect(response.body.message).toBe(message);
  });
});

describe('CSV export', () => {
  test('exports only what the requester is allowed to see', async () => {
    await seedTicket({ requesterEmail: 'user@demo.local', title: 'Mine' });
    await seedTicket({ requesterEmail: 'other@example.com', title: 'Theirs' });

    const response = await request(app).get('/api/tickets/export').set(as('user')).expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('Mine');
    expect(response.text).not.toContain('Theirs');
  });

  test('neutralises spreadsheet formulas in user-controlled text', async () => {
    await seedTicket({ title: '=HYPERLINK("http://evil.example","click")' });

    const response = await request(app).get('/api/tickets/export').set(as('admin')).expect(200);

    expect(response.text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  });

  test('streams every matching ticket in chunks, with no row cap', async () => {
    // More than the 10,000 rows the old in-memory export would stop at.
    const count = 10_050;
    await Ticket.insertMany(generateTickets(count, { seed: 7 }));

    const response = await request(app).get('/api/tickets/export').set(as('admin')).expect(200);

    expect(response.headers['transfer-encoding']).toBe('chunked');
    expect(response.headers['content-length']).toBeUndefined();
    expect(response.headers['content-disposition']).toContain('tickets.csv');
    expect(response.text.trim().split('\n')).toHaveLength(1 + count);
  });

  test('keeps the list ordering, including priority rank, in the streamed rows', async () => {
    for (const priority of ['low', 'urgent', 'medium', 'high'] as const) {
      await seedTicket({ priority, title: priority });
    }

    const response = await request(app)
      .get('/api/tickets/export?sortBy=priority&sortOrder=desc')
      .set(as('admin'))
      .expect(200);

    const rows = response.text.trim().split('\n').slice(1);
    expect(rows.map((row) => row.split(',')[1])).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  test('applies the same filters as the list view and ignores paging', async () => {
    for (let index = 0; index < 12; index += 1) {
      await seedTicket({ priority: index < 11 ? 'low' : 'urgent' });
    }

    const response = await request(app)
      .get('/api/tickets/export?priority=low&page=9&limit=2')
      .set(as('admin'))
      .expect(200);

    expect(response.text.trim().split('\n')).toHaveLength(1 + 11);
  });
});

describe('operability', () => {
  test('readiness reports a healthy database', async () => {
    const response = await request(app).get('/api/ready').expect(200);
    expect(response.body).toMatchObject({
      ok: true,
      database: 'up',
      service: 'it-ticketing-system',
    });
    expect(response.body.version).toEqual(expect.any(String));
  });

  test('liveness never depends on the database', async () => {
    await request(app).get('/api/health').expect(200, { ok: true, service: 'it-ticketing-system' });
  });

  test('every response carries a request id, and errors echo it', async () => {
    const generated = await request(app).get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);

    const supplied = await request(app)
      .get('/api/tickets')
      .set('x-request-id', 'support-case-42')
      .expect(401);
    expect(supplied.headers['x-request-id']).toBe('support-case-42');

    const missing = await request(app).get('/api/nope').set('x-request-id', 'trace-me').expect(404);
    expect(missing.body.requestId).toBe('trace-me');
  });

  test('replaces a malformed incoming request id instead of trusting it', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('x-request-id', 'bad id\twith spaces');
    expect(response.headers['x-request-id']).not.toContain('bad');
  });
});
