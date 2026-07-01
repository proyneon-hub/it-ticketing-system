jest.mock('../db', () => ({
  connectToDatabase: jest.fn().mockResolvedValue({}),
  isDatabaseConnectivityError: jest.fn().mockReturnValue(false),
}));

jest.mock('../models/Ticket', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
}));

jest.mock('../models/Counter', () => ({
  findByIdAndUpdate: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');
const Counter = require('../models/Counter');
const Ticket = require('../models/Ticket');

async function loginAs(email, password) {
  const response = await request(app).post('/api/auth/login').send({ email, password }).expect(200);

  return response.body.token;
}

function mockFind(results = []) {
  const query = {
    sort: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    lean: jest.fn().mockResolvedValue(results),
  };

  Ticket.find.mockReturnValue(query);
  return query;
}

describe('API auth and ticket routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Ticket.aggregate.mockResolvedValue([]);
    Ticket.countDocuments.mockResolvedValue(0);
    Counter.findByIdAndUpdate.mockResolvedValue({ seq: 1 });
    mockFind([]);
  });

  test('requires authentication for ticket data', async () => {
    await request(app).get('/api/tickets').expect(401);
  });

  test('returns scoped dashboard stats for an authenticated technician', async () => {
    const token = await loginAs('tech@demo.local', 'TechPass123!');

    Ticket.aggregate
      .mockResolvedValueOnce([{ _id: 'assigned', count: 2 }])
      .mockResolvedValueOnce([{ _id: 'urgent', count: 1 }]);
    Ticket.countDocuments
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    const response = await request(app)
      .get('/api/tickets/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      total: 4,
      byStatus: { assigned: 2 },
      byPriority: { urgent: 1 },
      sla: { breached: 1, dueSoon: 2 },
    });
  });

  test('returns paginated tickets with validated filters and sorting', async () => {
    const token = await loginAs('admin@demo.local', 'AdminPass123!');
    const query = mockFind([
      {
        _id: '665f0f40d5d4f541f8ef1234',
        ticketNumber: 'TKT-0007',
        title: 'Example ticket',
      },
    ]);
    Ticket.countDocuments.mockResolvedValueOnce(27);

    const response = await request(app)
      .get(
        '/api/tickets?page=2&limit=10&sortBy=ticketNumber&sortOrder=asc&status=open&priority=high'
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      pagination: {
        page: 2,
        limit: 10,
        total: 27,
        totalPages: 3,
      },
    });
    expect(response.body.data).toHaveLength(1);
    expect(Ticket.find).toHaveBeenCalledWith({ status: 'open', priority: 'high' });
    expect(query.sort).toHaveBeenCalledWith({ ticketNumber: 1 });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
  });

  test('rejects invalid ticket list query parameters', async () => {
    const token = await loginAs('admin@demo.local', 'AdminPass123!');

    await request(app)
      .get('/api/tickets?limit=101')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(app)
      .get('/api/tickets?status=waiting')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  test('creates tickets with human-friendly ticket numbers and activity', async () => {
    const token = await loginAs('user@demo.local', 'UserPass123!');
    Counter.findByIdAndUpdate.mockResolvedValue({ seq: 6 });
    Ticket.create.mockImplementation(async (payload) => ({ _id: 'ticket-id', ...payload }));

    const response = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New access request', priority: 'high' })
      .expect(201);

    expect(response.body.ticket).toMatchObject({
      ticketNumber: 'TKT-0006',
      requesterEmail: 'user@demo.local',
      status: 'open',
      assignee: 'Unassigned',
    });
    expect(response.body.ticket.activity[0]).toMatchObject({
      action: 'ticket_created',
      actorEmail: 'user@demo.local',
    });
  });

  test('records structured activity when workflow fields change', async () => {
    const token = await loginAs('tech@demo.local', 'TechPass123!');
    const id = '665f0f40d5d4f541f8ef1234';
    Ticket.findById.mockResolvedValue({
      _id: id,
      requesterEmail: 'user@demo.local',
      status: 'assigned',
      priority: 'urgent',
      assignee: 'Theo Technician',
    });
    Ticket.findByIdAndUpdate.mockResolvedValue({ _id: id, status: 'in-progress' });

    await request(app)
      .patch(`/api/tickets/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in-progress' })
      .expect(200);

    expect(Ticket.findByIdAndUpdate).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        $push: {
          activity: {
            $each: [
              expect.objectContaining({
                action: 'status_changed',
                from: 'assigned',
                to: 'in-progress',
                actorEmail: 'tech@demo.local',
              }),
            ],
          },
        },
      }),
      expect.any(Object)
    );
  });

  test('exports role-scoped tickets as CSV', async () => {
    const token = await loginAs('admin@demo.local', 'AdminPass123!');
    mockFind([
      {
        _id: '665f0f40d5d4f541f8ef1234',
        ticketNumber: 'TKT-0001',
        title: 'Laptop cannot connect to Wi-Fi',
        status: 'open',
        priority: 'high',
        requesterEmail: 'avery@example.com',
        assignee: 'Network Support',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        dueAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const response = await request(app)
      .get('/api/tickets/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('Ticket ID,Title,Status');
    expect(response.text).toContain('TKT-0001,Laptop cannot connect to Wi-Fi,open');
  });

  test('allows only admins to delete tickets', async () => {
    const techToken = await loginAs('tech@demo.local', 'TechPass123!');
    const adminToken = await loginAs('admin@demo.local', 'AdminPass123!');
    const id = '665f0f40d5d4f541f8ef1234';

    await request(app)
      .delete(`/api/tickets/${id}`)
      .set('Authorization', `Bearer ${techToken}`)
      .expect(403);

    Ticket.findByIdAndDelete.mockResolvedValue({ _id: id });

    await request(app)
      .delete(`/api/tickets/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });
});
