import { expect, test } from '@playwright/test';
import { liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

test('LIVE-HEALTH-001 health endpoint is reachable', { tag: ['@smoke'] }, async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBeTruthy();
  expect((await response.json()) as unknown).toEqual({ ok: true, service: 'it-ticketing-system' });
});
