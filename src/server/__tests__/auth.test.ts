import request from 'supertest';
import app from '../app';
import { authenticateDemoUser, issueToken, verifyToken, type PublicUser } from '../auth';

describe('demo auth tokens', () => {
  test('authenticates a seeded admin and verifies the issued token', () => {
    const user = authenticateDemoUser('admin@demo.local', 'AdminPass123!') as PublicUser;
    const token = issueToken(user);

    expect(user.role).toBe('admin');
    expect(verifyToken(token)).toMatchObject({
      email: 'admin@demo.local',
      role: 'admin',
    });
  });

  test('rejects invalid credentials and tampered tokens', () => {
    expect(authenticateDemoUser('admin@demo.local', 'wrong')).toBeNull();
    expect(verifyToken('not-a-token')).toBeNull();
  });
});

describe('signing secret', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const setProductionSecret = (secret: string | undefined) => {
    process.env.NODE_ENV = 'production';
    if (secret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = secret;
  };

  const demoUser = () => authenticateDemoUser('admin@demo.local', 'AdminPass123!') as PublicUser;

  test.each([
    ['unset', undefined],
    ['shorter than 32 characters', 'too-short-secret'],
  ])('refuses to sign or verify tokens in production when the secret is %s', (_label, secret) => {
    const token = issueToken(demoUser());
    setProductionSecret(secret);

    expect(() => issueToken(demoUser())).toThrow(/not configured/);
    expect(() => verifyToken(token)).toThrow(/not configured/);
  });

  test('does not accept a token forged with the public development secret in production', async () => {
    // The default secret is public in this repository, so anyone can build this token.
    const forged = issueToken({ id: 'x', name: 'Mallory', email: 'm@evil.example', role: 'admin' });
    setProductionSecret(undefined);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(503);

    expect(response.body.message).toMatch(/not configured/);
    expect(response.body.requestId).toBeDefined();
  });

  test('sign-in returns 503 rather than issuing a token when production has no secret', async () => {
    setProductionSecret('short');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@demo.local', password: 'AdminPass123!' })
      .expect(503);

    expect(response.body.token).toBeUndefined();
  });

  test('signs and verifies normally in production with a 32-character secret', () => {
    setProductionSecret('x'.repeat(32));

    expect(verifyToken(issueToken(demoUser()))).toMatchObject({ role: 'admin' });
  });

  test('keeps the development fallback outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_SECRET;

    expect(verifyToken(issueToken(demoUser()))).toMatchObject({ role: 'admin' });
  });
});
