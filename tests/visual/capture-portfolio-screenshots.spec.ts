import { test } from '../fixtures/app.fixture';
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
