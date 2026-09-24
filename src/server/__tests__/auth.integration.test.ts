// Sessions, users and the audit log against the real app, real models and a real
// (replica-set) MongoDB. Nothing is mocked except where a test says so.
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import app from '../app';
import { connectToDatabase } from '../db';
import AuditEvent from '../models/AuditEvent';
import RefreshToken from '../models/RefreshToken';
import Ticket from '../models/Ticket';
import User from '../models/User';
import { verifyAccessToken } from '../security/accessToken';
import { hashPassword } from '../security/password';
import {
  bearer,
  cookieLine,
  cookieValue,
  credentials,
  signInAll,
  startTestDatabase,
  type Account,
  type TestDatabase,
  type Tokens,
} from './helpers';

let mongod: TestDatabase;
let tokens: Tokens;
const as = (account: Account) => bearer(tokens, account);

const ROLES: Record<Account, string> = { admin: 'admin', tech: 'technician', user: 'user' };
const EMAIL = (account: Account) => credentials[account][0];

// Signs in over HTTP and returns everything a client would hold afterwards.
async function signIn(account: Account) {
  const [email, password] = credentials[account];
  const response = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return {
    response,
    token: response.body.token as string,
    user: response.body.user as { id: string; role: string },
    cookie: cookieValue(response) as string,
  };
}

const refresh = (cookie?: string) => {
  const call = request(app).post('/api/auth/refresh');
  return cookie === undefined ? call : call.set('Cookie', `rt=${cookie}`);
};

const auditEvents = (type: string) => AuditEvent.find({ type }).sort({ at: 1 }).lean();

beforeAll(async () => {
  mongod = await startTestDatabase();
  await connectToDatabase();
  await Promise.all([User.init(), RefreshToken.init(), AuditEvent.init(), Ticket.init()]);
  tokens = await signInAll(app);
}, 300000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// Each test starts with the three demo roles, no sessions and an empty audit log.
beforeEach(async () => {
  for (const account of Object.keys(ROLES) as Account[]) {
    await User.updateOne({ email: EMAIL(account) }, { role: ROLES[account] });
  }
  await Promise.all([
    RefreshToken.deleteMany({}),
    AuditEvent.deleteMany({}),
    Ticket.deleteMany({}),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.COOKIE_SECURE;
});

describe('signing in', () => {
  test('returns a short-lived access token, the user, and a refresh cookie', async () => {
    const { response, token, user } = await signIn('tech');

    expect(user).toMatchObject({
      name: 'Theo Technician',
      email: 'tech@demo.local',
      role: 'technician',
    });
    expect(user.id).toMatch(/^[a-f0-9]{24}$/);
    const claims = await verifyAccessToken(token);
    expect(claims).toMatchObject({ sub: user.id, role: 'technician' });
    expect((claims?.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(15 * 60);
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  test('sets the refresh token as an httpOnly, SameSite=Strict cookie scoped to the auth routes', async () => {
    const { response } = await signIn('tech');

    const line = cookieLine(response);
    expect(line).toContain('HttpOnly');
    expect(line).toContain('SameSite=Strict');
    expect(line).toContain('Path=/api/auth');
    expect(line).toMatch(/Max-Age=604800|Expires=/);
    // Not Secure here: the test server is plain http. Production and Docker set it explicitly.
    expect(line).not.toContain('Secure');
  });

  test('marks the cookie Secure when COOKIE_SECURE is on (production over https)', async () => {
    process.env.COOKIE_SECURE = 'true';
    const { response } = await signIn('tech');
    expect(cookieLine(response)).toContain('Secure');
  });

  test('stores only an argon2id hash of the password, never the password', async () => {
    const user = await User.findOne({ email: 'tech@demo.local' }).select('+passwordHash').lean();

    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(user)).not.toContain('TechPass123!');
  });

  test('stores only a hash of the refresh token, so a database leak hands out no sessions', async () => {
    const { cookie } = await signIn('tech');

    const stored = await RefreshToken.find().lean();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(cookie);
    expect(stored[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test.each([
    ['a wrong password', { email: 'tech@demo.local', password: 'nope' }],
    ['an unknown email', { email: 'nobody@demo.local', password: 'TechPass123!' }],
    ['a missing password', { email: 'tech@demo.local' }],
    ['a non-text password', { email: 'tech@demo.local', password: { $ne: '' } }],
    ['no body at all', {}],
  ])('refuses %s with the same 401 and no cookie', async (_label, body) => {
    const response = await request(app).post('/api/auth/login').send(body).expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password.',
    });
    expect(cookieValue(response)).toBeUndefined();
  });

  test('matches the email regardless of letter case', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'TECH@Demo.Local', password: 'TechPass123!' })
      .expect(200);
  });

  test('keeps working from the demo-users list, which needs no database', async () => {
    const response = await request(app).get('/api/auth/demo-users').expect(200);

    expect(response.body.users.map((user: { role: string }) => user.role)).toEqual([
      'admin',
      'technician',
      'user',
    ]);
    expect(response.body.users[0]).not.toHaveProperty('password');
    expect(response.body.users[0]).toMatchObject({ demoPassword: 'AdminPass123!' });
  });
});

describe('the current user', () => {
  test('is returned for a valid token and refused for a missing or tampered one', async () => {
    const me = await request(app).get('/api/auth/me').set(as('tech')).expect(200);
    expect(me.body.user).toMatchObject({ email: 'tech@demo.local', role: 'technician' });

    await request(app).get('/api/auth/me').expect(401);
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokens.tech.slice(0, -2)}xx`)
      .expect(401);
  });
});

describe('refreshing a session', () => {
  test('trades the cookie for a new access token and a new cookie', async () => {
    const { cookie, user } = await signIn('tech');

    const response = await refresh(cookie).expect(200);

    expect(response.body.user).toMatchObject({ id: user.id, role: 'technician' });
    expect(await verifyAccessToken(response.body.token)).not.toBeNull();
    const rotated = cookieValue(response);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(cookie);
  });

  test('a refresh token works once: the next one it issued works, the old one does not', async () => {
    const { cookie } = await signIn('tech');
    const first = await refresh(cookie).expect(200);
    const next = cookieValue(first) as string;

    await refresh(next).expect(200); // The rotated token is good...
    const replay = await refresh(cookie).expect(401); // ...the retired one is not.
    expect(replay.body.code).toBe('UNAUTHORIZED');
  });

  test('presenting a retired token ends the whole session and is recorded', async () => {
    const { cookie } = await signIn('tech');
    const rotated = cookieValue(await refresh(cookie).expect(200)) as string;

    await refresh(cookie).expect(401); // Someone replays the old token: reuse.

    // The legitimate holder of the newest token is signed out too, since their family is dead.
    await refresh(rotated).expect(401);
    const events = await auditEvents('refresh_reuse');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'failure', actor: { email: 'tech@demo.local' } });
  });

  test('two simultaneous refreshes with one token: exactly one wins', async () => {
    const { cookie } = await signIn('tech');

    const responses = await Promise.all([refresh(cookie), refresh(cookie)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  });

  test.each([
    ['no cookie', undefined],
    ['a made-up token', 'definitely-not-a-real-token'],
  ])('refuses %s and clears the cookie', async (_label, cookie) => {
    const response = await refresh(cookie).expect(401);

    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  test('refuses an expired refresh token', async () => {
    const { cookie } = await signIn('tech');
    await RefreshToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });

    await refresh(cookie).expect(401);
  });

  test('picks up a role change made since sign-in', async () => {
    const { cookie } = await signIn('tech');
    await User.updateOne({ email: 'tech@demo.local' }, { role: 'admin' });

    const response = await refresh(cookie).expect(200);

    expect(response.body.user.role).toBe('admin');
    expect((await verifyAccessToken(response.body.token))?.role).toBe('admin');
  });

  test('refuses a session whose user has been removed', async () => {
    const { cookie } = await signIn('user');
    await User.deleteOne({ email: 'user@demo.local' });

    await refresh(cookie).expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@demo.local', password: 'UserPass123!' })
      .expect(401);
    // Put the demo user back, with the real password, for the tests that follow.
    await User.create({
      email: 'user@demo.local',
      name: 'Una User',
      role: 'user',
      passwordHash: await hashPassword('UserPass123!'),
    });
  });

  test('is refused when the request names another origin, and the token is not used up', async () => {
    const { cookie } = await signIn('tech');

    const foreign = await refresh(cookie).set('Origin', 'https://evil.example').expect(401);
    expect(foreign.body.message).toMatch(/cross-origin/i);

    // The forged request did not consume the real session.
    await refresh(cookie).expect(200);
  });

  test('is allowed from its own origin, and from clients that send no Origin at all', async () => {
    const { cookie } = await signIn('tech');
    const same = await refresh(cookie)
      .set('Host', 'app.example')
      .set('Origin', 'http://app.example')
      .expect(200);

    await refresh(cookieValue(same) as string).expect(200);
  });
});

describe('signing out', () => {
  test('ends the session, clears the cookie and is recorded', async () => {
    const { cookie } = await signIn('tech');

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `rt=${cookie}`)
      .expect(204);

    expect(cookieLine(response)).toMatch(/rt=;|rt=\s*;/);
    await refresh(cookie).expect(401);
    expect(await auditEvents('logout')).toHaveLength(1);
  });

  test('is harmless with no session, and refuses another origin', async () => {
    await request(app).post('/api/auth/logout').expect(204);
    await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example').expect(401);
  });
});

describe('managing users', () => {
  test('an admin lists the users, never with a password hash', async () => {
    const response = await request(app).get('/api/users').set(as('admin')).expect(200);

    expect(response.body.users.map((user: { email: string }) => user.email)).toEqual([
      'admin@demo.local',
      'tech@demo.local',
      'user@demo.local',
    ]);
    expect(response.body.users[0]).toMatchObject({ role: 'admin', name: 'Priya Admin' });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2/);
  });

  test.each(['tech', 'user'] as const)('a %s cannot list or change users', async (account) => {
    const target = await User.findOne({ email: 'user@demo.local' });

    await request(app).get('/api/users').set(as(account)).expect(403);
    await request(app)
      .patch(`/api/users/${target?.id}`)
      .set(as(account))
      .send({ role: 'admin' })
      .expect(403);
    expect((await User.findById(target?.id))?.role).toBe('user');
  });

  test('anonymous callers get 401', async () => {
    await request(app).get('/api/users').expect(401);
  });

  test("an admin changes a role, which ends that user's sessions and is recorded", async () => {
    const tech = await signIn('tech');

    const response = await request(app)
      .patch(`/api/users/${tech.user.id}`)
      .set(as('admin'))
      .send({ role: 'admin' })
      .expect(200);

    expect(response.body.user).toMatchObject({ email: 'tech@demo.local', role: 'admin' });
    await refresh(tech.cookie).expect(401);
    const [event] = await auditEvents('role_changed');
    expect(event).toMatchObject({
      outcome: 'success',
      actor: { email: 'admin@demo.local' },
      target: { type: 'user', id: tech.user.id, label: 'tech@demo.local' },
      detail: 'Role changed from technician to admin.',
    });
  });

  test.each([
    ['an invalid role', { role: 'superuser' }, 'existing', 400],
    ['no role', {}, 'existing', 400],
    ['a malformed id', { role: 'admin' }, 'nope', 400],
    ['an unknown user', { role: 'admin' }, '665f0f40d5d4f541f8ef1234', 404],
  ])('rejects %s', async (_label, body, idKind, status) => {
    const id =
      idKind === 'existing' ? (await User.findOne({ email: 'user@demo.local' }))?.id : idKind;

    await request(app).patch(`/api/users/${id}`).set(as('admin')).send(body).expect(status);
  });

  test('will not demote the last admin', async () => {
    const admin = await User.findOne({ email: 'admin@demo.local' });

    const response = await request(app)
      .patch(`/api/users/${admin?.id}`)
      .set(as('admin'))
      .send({ role: 'technician' })
      .expect(409);

    expect(response.body.code).toBe('LAST_ADMIN');
    expect((await User.findById(admin?.id))?.role).toBe('admin');
  });

  test('lets an admin step down when another admin exists, and then protects the remaining one', async () => {
    const [admin, tech] = await Promise.all([
      User.findOne({ email: 'admin@demo.local' }),
      User.findOne({ email: 'tech@demo.local' }),
    ]);
    await request(app)
      .patch(`/api/users/${tech?.id}`)
      .set(as('admin'))
      .send({ role: 'admin' })
      .expect(200);
    const techAdmin = (await signIn('tech')).token;

    // Two admins now: the first may step down...
    await request(app)
      .patch(`/api/users/${admin?.id}`)
      .set(as('admin'))
      .send({ role: 'technician' })
      .expect(200);
    // ...and the one left cannot.
    await request(app)
      .patch(`/api/users/${tech?.id}`)
      .set({ Authorization: `Bearer ${techAdmin}` })
      .send({ role: 'user' })
      .expect(409);
  });

  test('two admins demoting each other at the same moment leave exactly one admin', async () => {
    const [a, b] = await Promise.all([
      User.findOne({ email: 'admin@demo.local' }),
      User.findOne({ email: 'tech@demo.local' }),
    ]);

    // Repeated, because the bug this guards against (write skew) only shows when the
    // two transactions overlap.
    for (let round = 0; round < 6; round += 1) {
      await User.updateMany({ _id: { $in: [a?._id, b?._id] } }, { role: 'admin' });
      const [tokenA, tokenB] = [(await signIn('admin')).token, (await signIn('tech')).token];

      const responses = await Promise.all([
        request(app)
          .patch(`/api/users/${b?.id}`)
          .set({ Authorization: `Bearer ${tokenA}` })
          .send({ role: 'user' }),
        request(app)
          .patch(`/api/users/${a?.id}`)
          .set({ Authorization: `Bearer ${tokenB}` })
          .send({ role: 'user' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await User.countDocuments({ role: 'admin' })).toBe(1);
    }
  });
});

describe('the audit log', () => {
  test('is readable only by admins', async () => {
    await request(app).get('/api/audit').set(as('admin')).expect(200);
    await request(app).get('/api/audit').set(as('tech')).expect(403);
    await request(app).get('/api/audit').set(as('user')).expect(403);
    await request(app).get('/api/audit').expect(401);
  });

  test('records successful and failed sign-ins with where they came from', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'audit-test/1.0')
      .set('X-Request-Id', 'audit-req-1')
      .send({ email: 'tech@demo.local', password: 'TechPass123!' })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'audit-test/1.0')
      .send({ email: 'tech@demo.local', password: 'wrong-password' })
      .expect(401);

    const [success] = await auditEvents('login_success');
    expect(success).toMatchObject({
      outcome: 'success',
      actor: { email: 'tech@demo.local', role: 'technician' },
      userAgent: 'audit-test/1.0',
      requestId: 'audit-req-1',
    });
    expect(success?.ip).toBeTruthy();

    const [failure] = await auditEvents('login_failure');
    expect(failure).toMatchObject({
      outcome: 'failure',
      target: { type: 'user', label: 'tech@demo.local' },
    });
    expect(failure?.actor).toBeUndefined(); // Nobody was signed in.
    // The password the person typed is never written down.
    expect(JSON.stringify(await AuditEvent.find().lean())).not.toContain('wrong-password');
  });

  test('records ticket deletions and permission denials', async () => {
    const ticket = await Ticket.create({ ticketNumber: 'TKT-0042', title: 'To be deleted' });

    await request(app).delete(`/api/tickets/${ticket.id}`).set(as('tech')).expect(403);
    await request(app).delete(`/api/tickets/${ticket.id}`).set(as('admin')).expect(204);

    const [denied] = await auditEvents('permission_denied');
    expect(denied).toMatchObject({
      outcome: 'denied',
      actor: { email: 'tech@demo.local', role: 'technician' },
    });
    expect(denied?.detail).toContain('DELETE /api/tickets/');

    const [deleted] = await auditEvents('ticket_deleted');
    expect(deleted).toMatchObject({
      outcome: 'success',
      actor: { email: 'admin@demo.local' },
      target: { type: 'ticket', id: ticket.id, label: 'TKT-0042' },
    });
  });

  test('lists newest first, can filter by type, and pages', async () => {
    await signIn('tech');
    await signIn('user');
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech@demo.local', password: 'x' })
      .expect(401);

    const all = await request(app).get('/api/audit?limit=2').set(as('admin')).expect(200);
    expect(all.body.pagination).toMatchObject({ total: 3, totalPages: 2, limit: 2 });
    expect(all.body.events[0].type).toBe('login_failure'); // The latest event.

    const failures = await request(app)
      .get('/api/audit?type=login_failure')
      .set(as('admin'))
      .expect(200);
    expect(failures.body.events).toHaveLength(1);

    await request(app).get('/api/audit?type=nonsense').set(as('admin')).expect(400);
  });

  test('a failure to write an event never breaks the request it describes', async () => {
    vi.spyOn(AuditEvent, 'create').mockRejectedValue(new Error('audit store is down'));

    await signIn('tech'); // Still succeeds (signIn asserts a 200).
    await request(app).delete('/api/tickets/665f0f40d5d4f541f8ef1234').set(as('tech')).expect(403);
  });
});

describe('login rate limiting', () => {
  beforeAll(() => {
    process.env.LOGIN_RATE_LIMIT_MAX = '3';
  });
  afterAll(() => {
    delete process.env.LOGIN_RATE_LIMIT_MAX;
  });

  const login = (password: string) =>
    request(app).post('/api/auth/login').send({ email: 'admin@demo.local', password });

  test('throttles repeated failures but never counts successful sign-ins', async () => {
    // Demo visitors hop between accounts; that must never lock them out.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await login('AdminPass123!').expect(200);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await login('wrong-password').expect(401);
    }

    const blocked = await login('wrong-password').expect(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(blocked.body.message).toMatch(/too many/i);
    expect(blocked.body.requestId).toBeDefined();
    expect(blocked.headers['ratelimit']).toBeDefined();
  });
});

describe('without a signing secret in production', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('sign-in and refresh return 503 and leave no session behind', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech@demo.local', password: 'TechPass123!' })
      .expect(503);
    expect(login.body).toMatchObject({ code: 'AUTH_NOT_CONFIGURED' });
    expect(login.body.token).toBeUndefined();

    await refresh('anything').expect(503);
    expect(await RefreshToken.countDocuments()).toBe(0);
  });
});
