// None of these paths touch MongoDB, so the real app runs with no mocks and no database.
import express from 'express';
import request from 'supertest';
import app from '../app';
import { assertProductionConfig, resolveTrustProxy } from '../config';
import { ConflictError, ValidationError } from '../errors';
import { describeError } from '../middleware/errorHandler';
import { corsPolicy } from '../middleware/security';
import { issueAccessToken } from '../security/accessToken';

describe('security headers', () => {
  test('sets hardening headers and does not advertise the framework', async () => {
    const response = await request(app).get('/api/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });

  test('does not force https, which would break plain-http localhost and Docker', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
});

describe('CORS', () => {
  test('does not grant cross-origin access by default', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('allows only origins listed in CORS_ORIGINS', async () => {
    const restricted = express();
    restricted.use(corsPolicy({ CORS_ORIGINS: 'https://app.example, https://admin.example' }));
    restricted.get('/ping', (_req, res) => res.json({ ok: true }));

    const allowed = await request(restricted).get('/ping').set('Origin', 'https://admin.example');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.example');

    const denied = await request(restricted).get('/ping').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('database unavailable', () => {
  let originalUri: string | undefined;

  beforeAll(() => {
    originalUri = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
  });

  afterAll(() => {
    if (originalUri !== undefined) process.env.MONGODB_URI = originalUri;
  });

  test('readiness reports 503 while liveness stays up', async () => {
    await request(app).get('/api/health').expect(200);

    const ready = await request(app).get('/api/ready').expect(503);
    expect(ready.body).toMatchObject({ ok: false, database: 'down' });
  });

  test('ticket routes explain that the database is not configured', async () => {
    const token = await issueAccessToken({
      id: '665f0f40d5d4f541f8ef1001',
      name: 'Priya Admin',
      email: 'admin@demo.local',
      role: 'admin',
    });

    const response = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .expect(503);

    expect(response.body.message).toMatch(/Database is not configured/);
    expect(response.body.requestId).toBeDefined();
  });
});

describe('readiness reports whether authentication is configured', () => {
  const original = process.env.AUTH_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
  });

  test.each([
    [undefined, false],
    ['short', false],
    ['x'.repeat(32), true],
  ])('AUTH_SECRET %p -> authConfigured %p', async (secret, expected) => {
    if (secret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = secret;

    // The database is unreachable in this suite, so readiness is 503; the flag is still reported.
    const ready = await request(app).get('/api/ready');
    expect(ready.body.authConfigured).toBe(expected);
  });
});

describe('startup configuration', () => {
  test('refuses to start in production without a strong AUTH_SECRET', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
    expect(() => assertProductionConfig({ NODE_ENV: 'production', AUTH_SECRET: 's3cret' })).toThrow(
      /at least 32 characters/
    );
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(32) })
    ).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
  });

  test.each([
    [{}, false],
    [{ VERCEL: '1' }, 1],
    [{ TRUST_PROXY: '2' }, 2],
    [{ TRUST_PROXY: 'loopback' }, 'loopback'],
    [{ VERCEL: '1', TRUST_PROXY: '' }, 1],
  ])('resolves trust proxy for %j', (env, expected) => {
    expect(resolveTrustProxy(env)).toEqual(expected);
  });
});

describe('error mapping', () => {
  test('hides the details of unexpected errors', () => {
    expect(describeError(new Error('connection string mongodb://user:pw@host'))).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error.',
    });
  });

  test('maps schema validation failures to a 400 with field details', () => {
    const error = Object.assign(new Error('Validation failed'), {
      name: 'ValidationError',
      errors: { title: { path: 'title', message: 'Ticket title is required' } },
    });

    expect(describeError(error)).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Ticket title is required',
      errors: [{ field: 'title', message: 'Ticket title is required' }],
    });
  });

  test('maps cast errors to a 400 and duplicate keys to a 409', () => {
    expect(
      describeError(Object.assign(new Error('x'), { name: 'CastError', path: 'dueAt' }))
    ).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Invalid value for dueAt.',
    });
    expect(describeError(Object.assign(new Error('dup'), { code: 11000 }))).toMatchObject({
      status: 409,
      code: 'DUPLICATE',
    });
  });

  test('reports a missing database configuration as 503', () => {
    expect(describeError(new Error('MONGODB_URI is missing. Add it.'))).toMatchObject({
      status: 503,
      code: 'DATABASE_NOT_CONFIGURED',
    });
  });

  test('reports an unreachable database as 503 with its own code', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(describeError(error)).toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
  });

  test('keeps the status, code and field details of an error thrown on purpose', () => {
    const error = new ConflictError('VERSION_CONFLICT', 'This ticket changed.');
    expect(describeError(error)).toEqual({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'This ticket changed.',
    });
    expect(describeError(new ValidationError('Bad', [{ field: 'title', message: 'Bad' }]))).toEqual(
      {
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Bad',
        errors: [{ field: 'title', message: 'Bad' }],
      }
    );
  });
});
