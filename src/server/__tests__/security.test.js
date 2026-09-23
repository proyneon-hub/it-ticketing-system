// None of these paths touch MongoDB, so the real app runs with no mocks and no database.
const express = require('express');
const request = require('supertest');
const app = require('../app');
const { assertProductionConfig, resolveTrustProxy } = require('../config');
const { describeError } = require('../middleware/errorHandler');
const { corsPolicy } = require('../middleware/security');

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

describe('login rate limiting', () => {
  beforeAll(() => {
    process.env.LOGIN_RATE_LIMIT_MAX = '3';
  });

  afterAll(() => {
    delete process.env.LOGIN_RATE_LIMIT_MAX;
  });

  const login = (password) =>
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
    expect(blocked.body.message).toMatch(/too many/i);
    expect(blocked.body.requestId).toBeDefined();
    expect(blocked.headers['ratelimit']).toBeDefined();
  });
});

describe('startup configuration', () => {
  test('refuses to start in production without AUTH_SECRET', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'production', AUTH_SECRET: 's3cret' })
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
      message: 'Ticket title is required',
      errors: [{ field: 'title', message: 'Ticket title is required' }],
    });
  });

  test('maps cast errors to a 400 and duplicate keys to a 409', () => {
    expect(
      describeError(Object.assign(new Error('x'), { name: 'CastError', path: 'dueAt' }))
    ).toEqual({
      status: 400,
      message: 'Invalid value for dueAt.',
    });
    expect(describeError(Object.assign(new Error('dup'), { code: 11000 })).status).toBe(409);
  });

  test('reports a missing database configuration as 503', () => {
    expect(describeError(new Error('MONGODB_URI is missing. Add it.')).status).toBe(503);
  });
});
