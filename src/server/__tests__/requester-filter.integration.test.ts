// The requesterEmail filter on the ticket list: how the agent (and staff) see what one person has
// raised. The property that matters is that it can only ever narrow what a caller may already
// see: a requester is held to their own address whatever they send.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import Ticket from '../models/Ticket';
import { issueServiceToken } from '../security/accessToken';
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

interface Row {
  title: string;
  requesterEmail: string;
}

const list = async (account: Account, query: string) =>
  (await request(app).get(`/api/tickets?${query}`).set(as(account)).expect(200)).body as {
    tickets: Row[];
    pagination: { total: number };
  };

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
  await Ticket.deleteMany({});
  await Ticket.create([
    {
      ticketNumber: 'TKT-0001',
      title: 'Una one',
      requesterEmail: 'user@demo.local',
      status: 'open',
    },
    {
      ticketNumber: 'TKT-0002',
      title: 'Una two',
      requesterEmail: 'user@demo.local',
      status: 'closed',
    },
    { ticketNumber: 'TKT-0003', title: 'Avery one', requesterEmail: 'avery@example.com' },
    { ticketNumber: 'TKT-0004', title: 'Avery two', requesterEmail: 'avery@example.com' },
    { ticketNumber: 'TKT-0005', title: 'Casey one', requesterEmail: 'casey@example.com' },
  ]);
});

const titles = (rows: Row[]) => rows.map((row) => row.title).sort();

describe('for staff', () => {
  test('narrows the list to one requester', async () => {
    const { tickets, pagination } = await list('tech', 'requesterEmail=avery@example.com');
    expect(titles(tickets)).toEqual(['Avery one', 'Avery two']);
    expect(pagination.total).toBe(2);
  });

  test('ignores letter case, in the filter and in what is stored', async () => {
    const { tickets } = await list('admin', 'requesterEmail=AVERY@Example.COM');
    expect(titles(tickets)).toEqual(['Avery one', 'Avery two']);
  });

  test('combines with the other filters', async () => {
    const { tickets } = await list('tech', 'requesterEmail=user@demo.local&status=open');
    expect(titles(tickets)).toEqual(['Una one']);
  });

  test('an address with no tickets is an empty list', async () => {
    const { tickets, pagination } = await list('tech', 'requesterEmail=nobody@example.com');
    expect(tickets).toEqual([]);
    expect(pagination.total).toBe(0);
  });

  test('is matched exactly, not as a fragment or a pattern', async () => {
    expect((await list('tech', 'requesterEmail=avery')).tickets).toEqual([]);
    expect((await list('tech', 'requesterEmail=.*')).tickets).toEqual([]);
    expect(
      (
        await list(
          'tech',
          `requesterEmail=${encodeURIComponent('avery@example.com|casey@example.com')}`
        )
      ).tickets
    ).toEqual([]);
  });

  test('a blank filter means no filter', async () => {
    expect((await list('tech', 'requesterEmail=')).pagination.total).toBe(5);
    expect((await list('tech', 'requesterEmail=%20%20')).pagination.total).toBe(5);
  });

  test('is refused when it is far too long', async () => {
    const response = await request(app)
      .get(`/api/tickets?requesterEmail=${'a'.repeat(255)}`)
      .set(as('tech'));
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/254/);
  });

  test('applies to the CSV export as well', async () => {
    const response = await request(app)
      .get('/api/tickets/export?requesterEmail=casey@example.com')
      .set(as('admin'))
      .expect(200);
    expect(response.text).toContain('Casey one');
    expect(response.text).not.toContain('Avery');
    expect(response.text).not.toContain('Una one');
    expect(response.text).not.toContain('Una two');
  });
});

describe('for a requester', () => {
  test('is always their own tickets, whatever address they ask for', async () => {
    const own = ['Una one', 'Una two'];
    expect(titles((await list('user', '')).tickets)).toEqual(own);
    expect(titles((await list('user', 'requesterEmail=avery@example.com')).tickets)).toEqual(own);
    expect(titles((await list('user', 'requesterEmail=user@demo.local')).tickets)).toEqual(own);
    expect(titles((await list('user', 'requesterEmail=nobody@example.com')).tickets)).toEqual(own);
  });

  test('cannot see another requester’s tickets by naming them', async () => {
    const { tickets, pagination } = await list('user', 'requesterEmail=casey@example.com');
    expect(tickets.map((row) => row.requesterEmail)).not.toContain('casey@example.com');
    expect(pagination.total).toBe(2);
  });

  test('the stats and export are unaffected by it', async () => {
    const stats = await request(app)
      .get('/api/tickets/stats?requesterEmail=casey@example.com')
      .set(as('user'))
      .expect(200);
    expect(stats.body.total).toBe(2);

    const csv = await request(app)
      .get('/api/tickets/export?requesterEmail=casey@example.com')
      .set(as('user'))
      .expect(200);
    expect(csv.text).not.toContain('Casey');
    expect(csv.text).toContain('Una one');
  });
});

describe('for the agent', () => {
  test('can look up a requester’s tickets, without being able to open any but its own', async () => {
    const own = await Ticket.findOne({ title: 'Una one' });
    const agent = {
      Authorization: `Bearer ${await issueServiceToken({ ticketId: String(own?._id), runId: 'r1' })}`,
    };

    const response = await request(app)
      .get('/api/tickets?requesterEmail=avery@example.com')
      .set(agent)
      .expect(200);
    expect(titles(response.body.tickets)).toEqual(['Avery one', 'Avery two']);

    const other = await Ticket.findOne({ title: 'Avery one' });
    await request(app).get(`/api/tickets/${other?._id}`).set(agent).expect(403);
  });
});
