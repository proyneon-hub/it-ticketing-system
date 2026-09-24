import { expect, test } from '@playwright/test';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

// The scheduled jobs sit behind a shared secret that only the deployment and its scheduler
// know, so this needs CRON_SECRET in the test environment too (the real-stack CI job sets a
// throwaway one for the Compose stack).
const cronSecret = process.env.CRON_SECRET;

test(
  'LIVE-JOBS-001 the job endpoints refuse anyone without the secret',
  { tag: ['@smoke', '@security'] },
  async ({ request }) => {
    for (const path of ['/api/jobs/sla-escalation', '/api/jobs/outbox-delivery']) {
      const response = await request.post(path);
      // 401 when jobs are configured, 503 when they are off. Never a success.
      expect([401, 503]).toContain(response.status());
    }
    const admin = credentialsFor('admin');
    if (admin) {
      const login = await request.post('/api/auth/login', { data: admin });
      const token = (await login.json()).token;
      const asAdmin = await request.post('/api/jobs/sla-escalation', {
        headers: { Authorization: `Bearer ${token}` },
      });
      // A signed-in admin is not the scheduler.
      expect([401, 503]).toContain(asAdmin.status());
    }
  }
);

test(
  'LIVE-JOBS-002 SLA escalation marks an overdue ticket once, and delivery does nothing without a webhook',
  { tag: ['@smoke', '@admin', '@ticket'] },
  async ({ request }) => {
    const admin = credentialsFor('admin');
    if (!admin || !cronSecret) {
      test.skip(true, 'Set CRON_SECRET and the admin E2E_* credentials for the jobs smoke test.');
      return;
    }
    const token = (await (await request.post('/api/auth/login', { data: admin })).json()).token;
    const headers = { Authorization: `Bearer ${token}` };
    const job = { headers: { Authorization: `Bearer ${cronSecret}` } };

    const created = await request.post('/api/tickets', {
      headers,
      data: {
        title: `PW-LIVE-SLA-${Date.now()}`,
        priority: 'low',
        dueAt: '2020-01-01T00:00:00Z',
      },
    });
    expect(created.status()).toBe(201);
    const ticket = (await created.json()).ticket;

    try {
      const first = await request.post('/api/jobs/sla-escalation', job);
      expect(first.status()).toBe(200);
      expect((await first.json()).breached).toBeGreaterThanOrEqual(1);

      const after = (await (await request.get(`/api/tickets/${ticket._id}`, { headers })).json())
        .ticket;
      expect(after.priority).toBe('medium'); // Raised one step from low.
      expect(after.slaBreachedAt).toBeTruthy();
      expect(after.dueAt).toBe(ticket.dueAt); // The deadline did not move.
      expect(after.activity.at(-1)).toMatchObject({
        action: 'sla_breached',
        actorRole: 'system',
      });

      // Running it again leaves the ticket as it is.
      await request.post('/api/jobs/sla-escalation', job);
      const again = (await (await request.get(`/api/tickets/${ticket._id}`, { headers })).json())
        .ticket;
      expect(again.priority).toBe('medium');
      expect(again.__v).toBe(after.__v);
      expect(again.activity).toHaveLength(after.activity.length);

      const delivery = await request.post('/api/jobs/outbox-delivery', job);
      expect(delivery.status()).toBe(200);
      expect(await delivery.json()).toMatchObject({ configured: false, delivered: 0 });
    } finally {
      await request.delete(`/api/tickets/${ticket._id}`, { headers });
    }
  }
);
