import type { NextFunction, Request, Response } from 'express';
import { requireCronSecret, secretMatches } from './cronAuth';

const SECRET = 'a-long-cron-secret-of-at-least-32-characters';

function run(header: string | undefined, secret: string | undefined) {
  const previous = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  try {
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    requireCronSecret({ get: () => header } as unknown as Request, {} as Response, next);
    return next as ReturnType<typeof vi.fn>;
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
}

describe('secretMatches', () => {
  test('matches only the exact secret, whatever the lengths', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(secretMatches('', SECRET)).toBe(false);
  });
});

describe('requireCronSecret', () => {
  test('lets the right bearer token through', () => {
    const next = run(`Bearer ${SECRET}`, SECRET);
    expect(next).toHaveBeenCalledWith();
  });

  test.each([
    ['no header', undefined],
    ['an empty token', 'Bearer '],
    ['a wrong token', 'Bearer not-the-secret'],
    ['the wrong scheme', `Basic ${SECRET}`],
    ['a bare secret', SECRET],
  ])('refuses %s with 401', (_name, header) => {
    const error = run(header, SECRET).mock.calls[0]?.[0];
    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['too short', 'short-secret'],
  ])('is off, not open, when the secret is %s', (_name, secret) => {
    // Even an empty token that "matches" an empty secret must not get in.
    const error = run(`Bearer ${secret ?? ''}`, secret).mock.calls[0]?.[0];
    expect(error).toMatchObject({ statusCode: 503, code: 'JOBS_NOT_CONFIGURED' });
  });
});
