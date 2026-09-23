import { expect, test } from '@playwright/test';
import { liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

test(
  'LIVE-READY-001 readiness probe confirms the database and returns a request id',
  { tag: ['@smoke'] },
  async ({ request }) => {
    const response = await request.get('/api/ready');

    expect(response.status()).toBe(200);
    expect(response.headers()['x-request-id']).toBeTruthy();
    expect((await response.json()) as unknown).toMatchObject({
      ok: true,
      database: 'up',
      service: 'it-ticketing-system',
    });
  }
);

test(
  'LIVE-READY-002 unauthenticated ticket access is refused with a traceable error',
  { tag: ['@smoke'] },
  async ({ request }) => {
    const response = await request.get('/api/tickets', {
      headers: { 'x-request-id': 'live-smoke-trace' },
    });

    expect(response.status()).toBe(401);
    expect(response.headers()['x-request-id']).toBe('live-smoke-trace');
  }
);
