import { PROPOSAL_TICKET_ID, REPLY } from '../e2e-mocked/agentSupport';
import { expect, test } from '../fixtures/app.fixture';
import { testTickets } from '../test-data/tickets';

test('captures role dashboards and workflow screenshots', async ({
  page,
  loginPage,
  dashboardPage,
  ticketFormPage,
  trendsPage,
  detailPage,
}, testInfo) => {
  await loginPage.loginAs('admin');
  await page.screenshot({ path: testInfo.outputPath('admin-dashboard.png'), fullPage: true });

  await ticketFormPage.createTicket(testTickets.screenshotCapture);
  await page.screenshot({ path: testInfo.outputPath('ticket-create-form.png'), fullPage: true });

  await dashboardPage.openTicket('TKT-0009');
  await page.screenshot({ path: testInfo.outputPath('ticket-update-flow.png'), fullPage: true });

  // The trends page, and a ticket with its comments (a public reply and a staff-only note).
  await trendsPage.open();
  await trendsPage.expectLoaded();
  await page.screenshot({ path: testInfo.outputPath('trends.png'), fullPage: true });
  await page.goto('/tickets/665f0f40d5d4f541f8ef1001');
  await detailPage.expectLoaded('TKT-0001');
  await detailPage.expectInternalNote('Firmware 4.2 is suspect');
  await page.screenshot({ path: testInfo.outputPath('ticket-comments.png'), fullPage: true });

  await loginPage.logout();
  await loginPage.loginAs('technician');
  await page.screenshot({ path: testInfo.outputPath('technician-dashboard.png'), fullPage: true });

  await loginPage.logout();
  await loginPage.loginAs('user');
  await page.screenshot({ path: testInfo.outputPath('user-dashboard.png'), fullPage: true });
});

// The service desk agent: the reply it drafted for a technician to approve, and the admin page
// that runs it. Both come from the mocked agent API in tests/e2e-mocked/agentSupport.ts.
test('captures the agent screenshots', async ({
  page,
  loginPage,
  detailPage,
  agentPage,
  agentApi,
}, testInfo) => {
  await loginPage.loginAs('technician');
  await page.goto(`/tickets/${PROPOSAL_TICKET_ID}`);
  await detailPage.expectLoaded('TKT-0003');
  await agentPage.expectProposalShown(REPLY);
  await page.screenshot({ path: testInfo.outputPath('agent-proposal.png'), fullPage: true });

  await loginPage.logout();
  await loginPage.loginAs('admin');
  await agentPage.gotoAdmin();
  await expect(page.getByText('The agent is running.')).toBeVisible();
  await expect(page.getByTestId('agent-run-row')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('agent-admin.png'), fullPage: true });
  expect(agentApi.requests).toEqual([]);
});
