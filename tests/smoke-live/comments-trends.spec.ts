import { expect, test } from '@playwright/test';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

// The rule that a requester never receives an internal note can only be proved against the
// real API, because it is the server that applies it. One dedicated ticket is created as the
// requester and deleted afterwards.
test(
  'LIVE-COMMENT-001 an internal note reaches staff but never the requester',
  { tag: ['@smoke', '@ticket', '@security'] },
  async ({ request }) => {
    const admin = credentialsFor('admin');
    const requester = credentialsFor('user');
    if (!admin || !requester) {
      test.skip(true, 'Set the admin and requester E2E_* credentials for the comments smoke test.');
      return;
    }
    const auth = async (credentials: { email: string; password: string }) => ({
      Authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: credentials })).json()).token}`,
    });
    const adminHeaders = await auth(admin);
    const userHeaders = await auth(requester);
    const note = `Internal-only ${Date.now()}`;

    const created = await request.post('/api/tickets', {
      headers: userHeaders,
      data: { title: `PW-LIVE-COMMENT-${Date.now()}` },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).ticket._id;

    try {
      const staffNote = await request.post(`/api/tickets/${id}/comments`, {
        headers: adminHeaders,
        data: { body: note, visibility: 'internal' },
      });
      expect(staffNote.status()).toBe(201);
      expect(
        (
          await request.post(`/api/tickets/${id}/comments`, {
            headers: adminHeaders,
            data: { body: 'We are on it.' },
          })
        ).status()
      ).toBe(201);

      // Staff read both.
      const staffThread = await (
        await request.get(`/api/tickets/${id}/comments`, { headers: adminHeaders })
      ).json();
      expect(staffThread.comments.map((c: { body: string }) => c.body)).toEqual([
        note,
        'We are on it.',
      ]);

      // The requester reads only the public one, from every place a ticket can come from.
      const seen = await Promise.all([
        request.get(`/api/tickets/${id}/comments`, { headers: userHeaders }),
        request.get(`/api/tickets/${id}`, { headers: userHeaders }),
        request.get('/api/tickets?limit=100', { headers: userHeaders }),
        request.get('/api/tickets/export', { headers: userHeaders }),
      ]);
      for (const response of seen) {
        expect(response.ok()).toBe(true);
        const text = await response.text();
        expect(text).not.toContain(note);
        expect(text).not.toContain('Internal note added');
      }
      const publicThread = await seen[0].json();
      expect(publicThread.comments.map((c: { body: string }) => c.body)).toEqual(['We are on it.']);

      // And cannot write one.
      const attempt = await request.post(`/api/tickets/${id}/comments`, {
        headers: userHeaders,
        data: { body: 'sneaky', visibility: 'internal' },
      });
      expect(attempt.status()).toBe(403);
    } finally {
      await request.delete(`/api/tickets/${id}`, { headers: adminHeaders });
    }
  }
);

test(
  'LIVE-TREND-001 trends have one entry per day and consistent totals',
  { tag: ['@smoke', '@admin'] },
  async ({ request }) => {
    const admin = credentialsFor('admin');
    if (!admin) {
      test.skip(true, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for the trends smoke test.');
      return;
    }
    const token = (await (await request.post('/api/auth/login', { data: admin })).json()).token;

    const response = await request.get('/api/tickets/stats/trends?days=14&tz=America/Toronto', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const trends = await response.json();
    expect(trends.series).toHaveLength(14);
    expect(trends.timeZone).toBe('America/Toronto');
    const resolved = trends.series.reduce(
      (sum: number, day: { resolved: number }) => sum + day.resolved,
      0
    );
    expect(trends.resolution.resolved).toBe(resolved);
    expect(trends.sla.met).toBeLessThanOrEqual(trends.sla.resolved);
  }
);
