import { SignJWT, UnsecuredJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PublicUser } from '../auth';
import { ACCESS_TOKEN_TTL_SECONDS, issueAccessToken, verifyAccessToken } from './accessToken';

const user: PublicUser = {
  id: '665f0f40d5d4f541f8ef1001',
  name: 'Theo Technician',
  email: 'tech@demo.local',
  role: 'technician',
};

const originalEnv = { ...process.env };
const SECRET = 'x'.repeat(40);

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...originalEnv };
});

// Signs a token by hand, so the tests can build tokens the server would never issue.
const forge = (
  claims: Record<string, unknown>,
  {
    alg = 'HS256',
    secret = SECRET,
    issuer = 'it-ticketing-system',
    audience = 'it-ticketing-api',
  } = {}
) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(secret));

const goodClaims = { name: user.name, email: user.email, role: user.role };

describe('access tokens', () => {
  test('round-trip the user and expire after fifteen minutes', async () => {
    const token = await issueAccessToken(user);
    const claims = await verifyAccessToken(token);

    expect(claims).toMatchObject({
      sub: user.id,
      name: user.name,
      email: user.email,
      role: 'technician',
    });
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60);
    expect((claims?.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(15 * 60);
  });

  test('stop working once expired, and not a minute before', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const token = await issueAccessToken(user);

    vi.setSystemTime(new Date('2026-06-01T12:14:00Z'));
    expect(await verifyAccessToken(token)).not.toBeNull();

    vi.setSystemTime(new Date('2026-06-01T12:16:00Z'));
    expect(await verifyAccessToken(token)).toBeNull();
  });

  test('reject a tampered payload or signature', async () => {
    const token = await issueAccessToken(user);
    const [header, payload, signature] = token.split('.') as [string, string, string];

    const admin = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'admin' })
    ).toString('base64url');
    expect(await verifyAccessToken(`${header}.${admin}.${signature}`)).toBeNull();
    expect(await verifyAccessToken(`${header}.${payload}.${signature.slice(0, -2)}xx`)).toBeNull();
    expect(await verifyAccessToken('not-a-token')).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
  });

  test('reject a token signed with a different secret', async () => {
    expect(await verifyAccessToken(await forge(goodClaims, { secret: 'y'.repeat(40) }))).toBeNull();
  });

  test('reject other algorithms, including an unsigned token', async () => {
    expect(await verifyAccessToken(await forge(goodClaims, { alg: 'HS512' }))).toBeNull();

    const unsigned = new UnsecuredJWT(goodClaims)
      .setSubject(user.id)
      .setIssuer('it-ticketing-system')
      .setAudience('it-ticketing-api')
      .setExpirationTime('15m')
      .encode();
    expect(await verifyAccessToken(unsigned)).toBeNull();
  });

  test('reject a token meant for a different issuer or audience', async () => {
    expect(await verifyAccessToken(await forge(goodClaims, { issuer: 'someone-else' }))).toBeNull();
    expect(
      await verifyAccessToken(await forge(goodClaims, { audience: 'another-api' }))
    ).toBeNull();
  });

  test('reject a correctly signed token whose claims are wrong', async () => {
    expect(await verifyAccessToken(await forge({ ...goodClaims, role: 'superuser' }))).toBeNull();
    expect(await verifyAccessToken(await forge({ name: user.name, email: user.email }))).toBeNull();
    expect(await verifyAccessToken(await forge({ ...goodClaims, email: 42 }))).toBeNull();
  });
});

describe('the signing secret', () => {
  test.each([
    ['unset', undefined],
    ['shorter than 32 characters', 'too-short-secret'],
  ])('is required in production: %s makes token handling fail with 503', async (_label, secret) => {
    const token = await issueAccessToken(user); // Issued while the test secret is set.
    process.env.NODE_ENV = 'production';
    if (secret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = secret;

    const notConfigured = expect.objectContaining({ statusCode: 503, code: 'AUTH_NOT_CONFIGURED' });
    await expect(issueAccessToken(user)).rejects.toEqual(notConfigured);
    await expect(verifyAccessToken(token)).rejects.toEqual(notConfigured);
  });

  test('a token forged with the public development secret is not accepted in production', async () => {
    // The development secret is in this repository, so anyone can build this token.
    delete process.env.AUTH_SECRET;
    const forged = await forge(
      { name: 'Mallory', email: 'm@evil.example', role: 'admin' },
      { secret: 'local-demo-secret-change-me' }
    );

    process.env.NODE_ENV = 'production';
    await expect(verifyAccessToken(forged)).rejects.toMatchObject({ statusCode: 503 });
  });

  test('works in production with a 32-character secret, and falls back only outside production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_SECRET = 'x'.repeat(32);
    expect(await verifyAccessToken(await issueAccessToken(user))).not.toBeNull();

    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_SECRET;
    expect(await verifyAccessToken(await issueAccessToken(user))).not.toBeNull();
  });
});
