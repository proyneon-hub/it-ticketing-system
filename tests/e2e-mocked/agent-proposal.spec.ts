import { PROPOSAL_TICKET_ID, REPLY } from './agentSupport';
import { expect, test } from '../fixtures/app.fixture';

const TICKET = `/tickets/${PROPOSAL_TICKET_ID}`;

test.describe('the agent’s drafted reply', () => {
  test('a technician reads it, sees what it is based on, and approves it as written', async ({
    page,
    loginPage,
    detailPage,
    agentApi,
    agentPage,
  }) => {
    await loginPage.loginAs('technician');
    await page.goto(TICKET);
    await detailPage.expectLoaded('TKT-0003');

    await agentPage.expectProposalShown(REPLY);
    await expect(page.getByText('KB-006')).toBeVisible();
    await expect(page.getByText('VPN keeps disconnecting').first()).toBeVisible();
    await expect(page.getByText('Triaged by the agent')).toBeVisible();
    // Nothing has been sent to the requester yet.
    await detailPage.expectCommentCount(0);

    await agentPage.approve();

    await expect(page.getByText(/Reply posted to the requester/)).toBeVisible();
    await agentPage.expectDecision('Approved and posted to the requester as written.');
    await agentPage.expectAiComment(REPLY, 'Theo Technician');
    expect(agentApi.ticketStatus).toBe('pending-user');
    expect(agentApi.requests).toEqual([
      { path: `/api/tickets/${PROPOSAL_TICKET_ID}/proposal/approve`, method: 'POST', body: {} },
    ]);
  });

  test('an edited reply is what is posted', async ({ page, loginPage, agentApi, agentPage }) => {
    await loginPage.loginAs('technician');
    await page.goto(TICKET);
    await agentPage.expectProposalShown(REPLY);

    const edited = 'Please restart the VPN client and your laptop, then tell us if it still drops.';
    await agentPage.editReply(edited);
    await expect(page.getByRole('button', { name: 'Approve edited reply' })).toBeVisible();
    await agentPage.approve();

    await agentPage.expectDecision('Approved after editing, and posted to the requester.');
    await agentPage.expectAiComment(edited, 'Theo Technician');
    expect(agentApi.requests[0]?.body).toEqual({ replyMarkdown: edited });
  });

  test('a rejected reply posts nothing, and the reason is sent', async ({
    page,
    loginPage,
    detailPage,
    agentApi,
    agentPage,
  }) => {
    await loginPage.loginAs('admin');
    await page.goto(TICKET);
    await agentPage.expectProposalShown(REPLY);

    await agentPage.reject('Wrong article.');

    await agentPage.expectDecision('Rejected. Nothing was posted to the requester.');
    await detailPage.expectCommentCount(0);
    expect(agentApi.requests).toEqual([
      {
        path: `/api/tickets/${PROPOSAL_TICKET_ID}/proposal/reject`,
        method: 'POST',
        body: { reason: 'Wrong article.' },
      },
    ]);
  });

  test('says so if someone else decided first', async ({
    page,
    loginPage,
    agentApi,
    agentPage,
  }) => {
    await loginPage.loginAs('technician');
    await page.goto(TICKET);
    await agentPage.expectProposalShown(REPLY);

    // Another technician approves while this one is reading.
    agentApi.conflictNext = true;
    await agentPage.approve();

    await expect(page.getByText(/was decided, or the ticket changed/)).toBeVisible();
  });

  test('a requester never sees the draft, the agent’s history, or that it was involved', async ({
    page,
    loginPage,
    detailPage,
    agentApi,
    agentPage,
  }) => {
    await loginPage.loginAs('user');
    await page.goto(TICKET);
    await detailPage.expectLoaded('TKT-0003');

    await agentPage.expectNoProposal();
    await expect(page.getByText('Triaged by the agent')).toHaveCount(0);
    await expect(page.getByText('Agent drafted a reply')).toHaveCount(0);
    expect(agentApi.requests).toEqual([]);
  });

  test('once approved, the requester reads the reply, labelled as the agent’s and approved by a person', async ({
    page,
    loginPage,
    detailPage,
    agentApi: _agentApi,
    agentPage,
  }) => {
    await loginPage.loginAs('technician');
    await page.goto(TICKET);
    await agentPage.approve();
    await agentPage.expectAiComment(REPLY);

    // Sign out, and read it as the requester.
    await page.getByTestId('logout-button').click();
    await loginPage.loginAs('user');
    await page.goto(TICKET);
    await detailPage.expectLoaded('TKT-0003');

    await agentPage.expectAiComment(REPLY, 'Theo Technician');
    await agentPage.expectNoProposal();
  });
});
