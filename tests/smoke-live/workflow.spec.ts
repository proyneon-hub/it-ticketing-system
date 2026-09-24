import { expect, test } from '@playwright/test';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

// Talks to the real API, because the workflow and version checks live there and
// a mocked browser test cannot prove them. Creates one dedicated ticket and
// deletes it afterwards.
test(
  'LIVE-WORKFLOW-001 the API enforces the status workflow and refuses a stale edit',
  { tag: ['@smoke', '@admin', '@ticket'] },
  async ({ request }) => {
    const credentials = credentialsFor('admin');
    if (!credentials) {
      test.skip(true, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for the workflow smoke test.');
      return;
    }

    const login = await request.post('/api/auth/login', { data: credentials });
    expect(login.ok()).toBe(true);
    const headers = { Authorization: `Bearer ${(await login.json()).token}` };

    const created = await request.post('/api/tickets', {
      headers,
      data: { title: `PW-LIVE-WORKFLOW-${Date.now()}`, priority: 'low' },
    });
    expect(created.status()).toBe(201);
    const ticket = (await created.json()).ticket;
    const url = `/api/tickets/${ticket._id}`;

    try {
      // An open ticket cannot jump straight to resolved, and nothing is written.
      const illegal = await request.patch(url, { headers, data: { status: 'resolved' } });
      expect(illegal.status()).toBe(409);
      const illegalBody = await illegal.json();
      expect(illegalBody.code).toBe('INVALID_TRANSITION');
      expect(illegalBody.message).toBe('Cannot move a ticket from open to resolved.');

      // A legal move succeeds and returns the new version.
      const moved = await request.patch(url, {
        headers: { ...headers, 'If-Match': `"${ticket.__v}"` },
        data: { status: 'in-progress' },
      });
      expect(moved.status()).toBe(200);
      expect(moved.headers()['etag']).toBe(`"${ticket.__v + 1}"`);

      // Editing from the version loaded before that move is refused.
      const stale = await request.patch(url, {
        headers: { ...headers, 'If-Match': `"${ticket.__v}"` },
        data: { priority: 'urgent' },
      });
      expect(stale.status()).toBe(409);
      expect((await stale.json()).code).toBe('VERSION_CONFLICT');

      const current = (await (await request.get(url, { headers })).json()).ticket;
      expect(current.status).toBe('in-progress');
      expect(current.priority).toBe('low');
    } finally {
      await request.delete(url, { headers });
    }
  }
);
