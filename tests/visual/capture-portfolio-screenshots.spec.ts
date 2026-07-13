import { test } from '../fixtures/app.fixture';
import { testTickets } from '../test-data/tickets';

test('captures role dashboards and workflow screenshots', async ({
  page,
  loginPage,
  dashboardPage,
  ticketFormPage,
}, testInfo) => {
  await loginPage.loginAs('admin');
  await page.screenshot({ path: testInfo.outputPath('admin-dashboard.png'), fullPage: true });

  await ticketFormPage.createTicket(testTickets.screenshotCapture);
  await page.screenshot({ path: testInfo.outputPath('ticket-create-form.png'), fullPage: true });

  await dashboardPage.openTicket('TKT-0009');
  await page.screenshot({ path: testInfo.outputPath('ticket-update-flow.png'), fullPage: true });

  await loginPage.logout();
  await loginPage.loginAs('technician');
  await page.screenshot({ path: testInfo.outputPath('technician-dashboard.png'), fullPage: true });

  await loginPage.logout();
  await loginPage.loginAs('user');
  await page.screenshot({ path: testInfo.outputPath('user-dashboard.png'), fullPage: true });
});
