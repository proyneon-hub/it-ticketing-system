import { expect, test } from '@playwright/test';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

// The service desk agent, end to end against the deployed site: a ticket is raised as a requester and
// the agent must look at it within 90 seconds. It is skipped unless the agent is really on there
// (switched on, with a key, in assist mode, and not stopped): a deployment that has not turned it on
// is not a failure. One dedicated ticket is created and deleted afterwards.
test(
  'LIVE-AGENT-001 a new ticket is triaged by the agent, and what it drafted stays away from the requester',
  { tag: ['@smoke', '@ticket', '@agent'] },
  async ({ request }) => {
    const admin = credentialsFor('admin');
    const requester = credentialsFor('user');
    if (!admin || !requester) {
      test.skip(true, 'Set the admin and requester E2E_* credentials for the agent smoke test.');
      return;
    }
    test.setTimeout(150_000);
    const auth = async (credentials: { email: string; password: string }) => ({
      Authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: credentials })).json()).token}`,
    });
    const adminHeaders = await auth(admin);
    const userHeaders = await auth(requester);

    const settings = (
      await (await request.get('/api/agent/settings', { headers: adminHeaders })).json()
    ).settings;
    if (!settings?.enabled) {
      test.skip(true, 'The agent is not switched on in this deployment.');
      return;
    }
    if (settings.killSwitch || !['assist', 'auto'].includes(settings.defaultMode)) {
      test.skip(true, 'The agent is stopped, or not in assist mode, so it will not write.');
      return;
    }

    const created = await request.post('/api/tickets', {
      headers: userHeaders,
      data: {
        title: `PW-LIVE-AGENT-${Date.now()}`,
        description: 'The VPN keeps disconnecting every few minutes when I am on a call.',
      },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).ticket._id;

    try {
      // The run appears, and finishes, within 90 seconds.
      let run: { outcome: string; outcomeReason?: string } | undefined;
      await expect
        .poll(
          async () => {
            const runs = (
              await (
                await request.get('/api/agent/runs?limit=25', { headers: adminHeaders })
              ).json()
            ).runs as { ticketId: string; outcome: string; outcomeReason?: string }[];
            run = runs.find((candidate) => candidate.ticketId === id);
            return run?.outcome ?? 'none';
          },
          { timeout: 90_000, intervals: [3_000] }
        )
        .not.toMatch(/^(none|running)$/);

      // It made a decision (or was stopped by a limit, which is also the agent working as designed).
      expect(['proposed', 'escalated', 'triaged', 'aborted']).toContain(run?.outcome);

      // A proposal, if there is one, is waiting for a person: staff can read it, the requester's own
      // copy of the ticket says nothing about the agent, and nothing has been posted to them.
      const staffView = (
        await (await request.get(`/api/tickets/${id}`, { headers: adminHeaders })).json()
      ).ticket;
      if (run?.outcome === 'proposed') {
        expect(staffView.agent?.proposalStatus).toBe('pending');
        const proposal = await request.get(`/api/tickets/${id}/proposal`, {
          headers: adminHeaders,
        });
        expect(proposal.status()).toBe(200);
        expect((await proposal.json()).proposal.proposal.citedKbIds.length).toBeGreaterThan(0);
        const theirs = await request.get(`/api/tickets/${id}/comments`, { headers: userHeaders });
        expect((await theirs.json()).comments).toEqual([]);
      }
      const ownView = (
        await (await request.get(`/api/tickets/${id}`, { headers: userHeaders })).json()
      ).ticket;
      expect(ownView.agent).toBeUndefined();
      expect(
        (await request.get(`/api/tickets/${id}/proposal`, { headers: userHeaders })).status()
      ).toBe(403);
    } finally {
      await request.delete(`/api/tickets/${id}`, { headers: adminHeaders });
    }
  }
);
