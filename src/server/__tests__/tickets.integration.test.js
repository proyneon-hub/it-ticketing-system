// Integration tests: the real Express app, real Mongoose models and a real
// (in-memory) MongoDB. Unlike app.test.js nothing here is mocked, so these
// cover query building, role scoping, SLA logic and persistence end to end.
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

jest.setTimeout(60000);

const HOUR = 60 * 60 * 1000;
const credentials = {
  admin: ['admin@demo.local', 'AdminPass123!'],
  tech: ['tech@demo.local', 'TechPass123!'],
  user: ['user@demo.local', 'UserPass123!'],
};

let mongod;
let app;
let Ticket;
let tokens;
let sequence = 0;

const as = (role) => ({ Authorization: `Bearer ${tokens[role]}` });

// Inserts directly through the model so each test controls the exact state it needs.
function seedTicket(overrides = {}) {
  sequence += 1;
  return Ticket.create({
    ticketNumber: `TKT-${String(sequence).padStart(4, '0')}`,
    title: `Seeded ticket ${sequence}`,
    requesterEmail: 'other@example.com',
    ...overrides,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  app = require('../app');
  Ticket = require('../models/Ticket');

  tokens = {};
  for (const [role, [email, password]] of Object.entries(credentials)) {
    const response = await request(app).post('/api/auth/login').send({ email, password });
    tokens[role] = response.body.token;
  }
  await require('../db').connectToDatabase();
  await Ticket.init();
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
    expect(list.body.data.map((ticket) => ticket.title)).toEqual(['Mine']);
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
    expect((await Ticket.findById(mine.id)).requesterEmail).toBe('user@demo.local');
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
    for (const priority of ['low', 'urgent', 'medium', 'high']) {
      await seedTicket({ priority, title: priority });
    }

    const descending = await request(app)
      .get('/api/tickets?sortBy=priority&sortOrder=desc')
      .set(as('admin'))
      .expect(200);
    expect(descending.body.data.map((ticket) => ticket.priority)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
    ]);

    const ascending = await request(app)
      .get('/api/tickets?sortBy=priority&sortOrder=asc')
      .set(as('admin'))
      .expect(200);
    expect(ascending.body.data.map((ticket) => ticket.priority)).toEqual([
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
    const priorities = ['urgent', 'low', 'high', 'medium', 'low'];
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
      seen.push(...response.body.data.map((ticket) => ticket._id));
    }

    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual([...seen].sort());
  });

  test('paginates priority-sorted results too', async () => {
    for (const priority of ['low', 'low', 'high', 'urgent', 'medium']) {
      await seedTicket({ priority });
    }

    const page = await request(app)
      .get('/api/tickets?sortBy=priority&sortOrder=desc&page=2&limit=2')
      .set(as('admin'))
      .expect(200);

    expect(page.body.data.map((ticket) => ticket.priority)).toEqual(['medium', 'low']);
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

  const titles = (response) => response.body.data.map((ticket) => ticket.title).sort();

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
  test('matches title, requester and ticket number case-insensitively', async () => {
    await seedTicket({ title: 'VPN client fails', requesterName: 'Casey' });
    await seedTicket({ title: 'Printer jam', requesterName: 'Jamie' });

    const byTitle = await request(app).get('/api/tickets?search=vpn').set(as('admin')).expect(200);
    expect(byTitle.body.data.map((ticket) => ticket.title)).toEqual(['VPN client fails']);

    const byNumber = await request(app)
      .get('/api/tickets?search=tkt-0002')
      .set(as('admin'))
      .expect(200);
    expect(byNumber.body.data.map((ticket) => ticket.title)).toEqual(['Printer jam']);
  });

  test('treats regex metacharacters as literal text', async () => {
    await seedTicket({ title: 'Cost is (100)' });
    await seedTicket({ title: 'Something else' });

    const response = await request(app)
      .get('/api/tickets')
      .query({ search: '.*' })
      .set(as('admin'))
      .expect(200);
    expect(response.body.data).toEqual([]);
  });

  test('search cannot escape a requester scope', async () => {
    await seedTicket({ requesterEmail: 'other@example.com', title: 'Secret' });

    const response = await request(app)
      .get('/api/tickets?search=secret')
      .set(as('user'))
      .expect(200);
    expect(response.body.data).toEqual([]);
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
    expect(new Date(dueAt) - new Date(createdAt)).toBe(4 * HOUR);
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
    const patch = (role, body) =>
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
    const patchAs = (role, ticket, body) =>
      request(app).patch(`/api/tickets/${ticket.id}`).set(as(role)).send(body);

    test('rejects a transition the workflow does not allow with 409 and changes nothing', async () => {
      const ticket = await seedTicket({ status: 'open', assignee: 'Theo Technician' });

      const response = await patchAs('tech', ticket, { status: 'resolved' }).expect(409);

      expect(response.body.message).toBe('Cannot move a ticket from open to resolved.');
      const stored = await Ticket.findById(ticket.id);
      expect(stored.status).toBe('open');
      expect(stored.activity).toHaveLength(0);
    });

    test('only an admin can reopen a closed ticket', async () => {
      const ticket = await seedTicket({ status: 'closed' });

      const denied = await patchAs('tech', ticket, { status: 'in-progress' }).expect(403);
      expect(denied.body.message).toMatch(/admin/i);
      expect((await Ticket.findById(ticket.id)).status).toBe('closed');

      await patchAs('admin', ticket, { status: 'in-progress' }).expect(200);
    });

    test('reopening a resolved ticket clears resolvedAt and logs ticket_reopened', async () => {
      const ticket = await seedTicket({ status: 'in-progress' });
      await patchAs('tech', ticket, { status: 'resolved' }).expect(200);

      const response = await patchAs('tech', ticket, { status: 'in-progress' }).expect(200);

      expect(response.body.ticket.resolvedAt).toBeUndefined();
      const actions = response.body.ticket.activity.map((entry) => entry.action);
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
        (entry) => entry.action === 'ticket_resolved'
      );
      expect(resolutions).toHaveLength(1);
    });
  });

  test('recalculates the SLA due date when priority changes', async () => {
    const ticket = await seedTicket({ priority: 'low' });
    const original = await Ticket.findById(ticket.id);

    const response = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set(as('tech'))
      .send({ priority: 'urgent' })
      .expect(200);

    expect(new Date(response.body.ticket.dueAt).getTime()).toBe(
      original.createdAt.getTime() + 4 * HOUR
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
