// Comments and internal notes against the real app and database. The property that
// matters most is negative: a requester never receives an internal note, from any endpoint.
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app';
import { connectToDatabase } from '../db';
import Comment from '../models/Comment';
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

const SECRET = 'Reset the domain admin password before replying';

interface Activity {
  detail?: string;
}
interface CommentBody {
  body: string;
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
  await Ticket.deleteMany({});
  await Comment.deleteMany({});
});

const seedTicket = (requesterEmail: string) =>
  Ticket.create({ ticketNumber: 'TKT-9001', title: 'VPN drops', requesterEmail });

const post = (role: Account, id: string, body: object) =>
  request(app).post(`/api/tickets/${id}/comments`).set(as(role)).send(body);

describe('posting', () => {
  test('a technician can post a public comment and an internal note', async () => {
    const ticket = await seedTicket('user@demo.local');

    const pub = await post('tech', ticket.id, { body: 'Looking into it.' });
    expect(pub.status).toBe(201);
    expect(pub.body.comment).toMatchObject({
      body: 'Looking into it.',
      visibility: 'public',
      author: { role: 'technician', email: 'tech@demo.local' },
    });

    const note = await post('tech', ticket.id, { body: SECRET, visibility: 'internal' });
    expect(note.status).toBe(201);
    expect(note.body.comment.visibility).toBe('internal');
  });

  test('a requester can comment on their own ticket, publicly only', async () => {
    const ticket = await seedTicket('user@demo.local');

    expect((await post('user', ticket.id, { body: 'Still broken.' })).status).toBe(201);

    const note = await post('user', ticket.id, { body: 'sneaky', visibility: 'internal' });
    expect(note.status).toBe(403);
    expect(note.body.code).toBe('FORBIDDEN');
    expect(await Comment.countDocuments({ body: 'sneaky' })).toBe(0);
  });

  test("a requester cannot see or comment on someone else's ticket, and gets a plain 404", async () => {
    const theirs = await seedTicket('other@example.com');

    await request(app).get(`/api/tickets/${theirs.id}/comments`).set(as('user')).expect(404);
    expect((await post('user', theirs.id, { body: 'hello' })).status).toBe(404);
    expect(await Comment.countDocuments()).toBe(0);
  });

  test.each([
    ['an empty body', { body: '   ' }],
    ['a missing body', {}],
    ['a body over 2000 characters', { body: 'x'.repeat(2001) }],
    ['an unknown visibility', { body: 'hi', visibility: 'secret' }],
  ])('rejects %s', async (_name, payload) => {
    const ticket = await seedTicket('user@demo.local');
    const response = await post('tech', ticket.id, payload);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  test('needs a sign-in and a valid ticket id', async () => {
    const ticket = await seedTicket('user@demo.local');
    await request(app).get(`/api/tickets/${ticket.id}/comments`).expect(401);
    await request(app).post(`/api/tickets/${ticket.id}/comments`).send({ body: 'hi' }).expect(401);
    await request(app).get('/api/tickets/not-an-id/comments').set(as('tech')).expect(400);
    await request(app)
      .get('/api/tickets/665f0f40d5d4f541f8ef1999/comments')
      .set(as('tech'))
      .expect(404);
  });

  test('records a history entry that does not repeat the text and does not bump the version', async () => {
    const ticket = await seedTicket('user@demo.local');
    const before = (await Ticket.findById(ticket.id))?.__v;

    await post('tech', ticket.id, { body: SECRET, visibility: 'internal' });

    const stored = await Ticket.findById(ticket.id);
    expect(stored?.__v).toBe(before);
    expect(stored?.activity.at(-1)).toMatchObject({ action: 'comment_added', internal: true });
    expect(JSON.stringify(stored?.activity)).not.toContain(SECRET);
  });

  test('a comment does not make an edit made against the earlier version fail', async () => {
    const ticket = await seedTicket('user@demo.local');
    const loaded = await request(app).get(`/api/tickets/${ticket.id}`).set(as('tech'));

    await post('tech', ticket.id, { body: 'A note in the meantime.', visibility: 'internal' });

    await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set(as('tech'))
      .set('If-Match', `"${loaded.body.ticket.__v}"`)
      .send({ priority: 'high' })
      .expect(200);
  });
});

describe('reading', () => {
  test('staff see the whole thread, oldest first', async () => {
    const ticket = await seedTicket('user@demo.local');
    await post('user', ticket.id, { body: 'First' });
    await post('tech', ticket.id, { body: SECRET, visibility: 'internal' });
    await post('tech', ticket.id, { body: 'Third' });

    const response = await request(app)
      .get(`/api/tickets/${ticket.id}/comments`)
      .set(as('admin'))
      .expect(200);

    expect(response.body.comments.map((c: CommentBody) => c.body)).toEqual([
      'First',
      SECRET,
      'Third',
    ]);
  });

  test('a requester gets only the public comments', async () => {
    const ticket = await seedTicket('user@demo.local');
    await post('tech', ticket.id, { body: 'Public reply' });
    await post('tech', ticket.id, { body: SECRET, visibility: 'internal' });

    const response = await request(app)
      .get(`/api/tickets/${ticket.id}/comments`)
      .set(as('user'))
      .expect(200);

    expect(response.body.comments.map((c: CommentBody) => c.body)).toEqual(['Public reply']);
    expect(JSON.stringify(response.body)).not.toContain(SECRET);
  });

  test('deleting a ticket deletes its comments', async () => {
    const ticket = await seedTicket('user@demo.local');
    await post('tech', ticket.id, { body: 'bye' });

    await request(app).delete(`/api/tickets/${ticket.id}`).set(as('admin')).expect(204);

    expect(await Comment.countDocuments({ ticketId: ticket._id })).toBe(0);
  });
});

// The internal note's text and its history entry must not reach a requester by any route.
describe('a requester never receives an internal note', () => {
  test('from any endpoint', async () => {
    const ticket = await seedTicket('user@demo.local');
    await post('tech', ticket.id, { body: SECRET, visibility: 'internal' });
    await post('tech', ticket.id, { body: 'Public reply' });

    const responses = await Promise.all([
      request(app).get(`/api/tickets/${ticket.id}`).set(as('user')),
      request(app).get('/api/tickets').set(as('user')),
      request(app).get(`/api/tickets/${ticket.id}/comments`).set(as('user')),
      request(app).get('/api/tickets/export').set(as('user')),
      request(app).patch(`/api/tickets/${ticket.id}`).set(as('user')).send({ priority: 'high' }),
      request(app).post('/api/tickets').set(as('user')).send({ title: 'Another' }),
    ]);

    for (const response of responses) {
      expect(response.status).toBeLessThan(300);
      expect(response.text).not.toContain(SECRET);
      expect(response.text).not.toContain('Internal note added');
    }

    // Staff do see the entry, so the absence above is the filter working.
    const staff = await request(app).get(`/api/tickets/${ticket.id}`).set(as('tech'));
    expect(staff.body.ticket.activity.map((a: Activity) => a.detail)).toContain(
      'Internal note added'
    );

    // And the requester still sees the public comment's entry.
    const mine = await request(app).get(`/api/tickets/${ticket.id}`).set(as('user'));
    expect(mine.body.ticket.activity.map((a: Activity) => a.detail)).toContain('Comment added');
  });
});
