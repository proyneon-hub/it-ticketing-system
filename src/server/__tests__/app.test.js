jest.mock('../db', () => ({
  connectToDatabase: jest.fn().mockResolvedValue({}),
  isDatabaseConnectivityError: jest.fn().mockReturnValue(false)
}));

jest.mock('../models/Ticket', () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn()
}));

const request = require('supertest');
const app = require('../app');
const Ticket = require('../models/Ticket');

async function loginAs(email, password) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  return response.body.token;
}

describe('API auth and ticket routes', () => {
  beforeEach(() => {
    Ticket.aggregate.mockResolvedValue([]);
    Ticket.countDocuments.mockResolvedValue(0);
    Ticket.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    });
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
      sla: { breached: 1, dueSoon: 2 }
    });
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
