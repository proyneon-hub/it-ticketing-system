import { expect } from '@playwright/test';
import { test } from '../fixtures/app.fixture';

// The frames of the README's animated demo: create a ticket, assign it, work it through to
// resolved, then open it to see its history and comments. Run against the mocked API, so
// every frame is deterministic. `npm run screenshots:demo` writes them to Playwright's
// `test-results` folder and scripts/make-demo-gif.py joins them into docs/screenshots/demo.gif.
test('captures the frames of the demo animation', async ({
  page,
  loginPage,
  dashboardPage,
  detailPage,
}, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  const frame = (name: string) =>
    page.screenshot({ path: testInfo.outputPath(`frame-${name}.png`) });
  // Runs an edit and waits for the server's answer and the reload that follows it, so the next
  // edit starts from the ticket as saved. (A person takes longer than this between edits.)
  const saved = async (edit: () => Promise<void>) => {
    const patched = page.waitForResponse((r) => r.request().method() === 'PATCH');
    const reloaded = page.waitForResponse(
      (r) => r.request().method() === 'GET' && r.url().includes('/api/tickets?')
    );
    await edit();
    await patched;
    await reloaded;
  };

  await loginPage.loginAs('admin');
  await dashboardPage.expectLoaded();
  await dashboardPage.expectDataLoaded();
  await frame('1-queue');

  // Create the ticket, showing the form filled in before it is sent.
  await page.getByTestId('ticket-title').fill('Docking station not detected');
  await page
    .getByTestId('ticket-description')
    .fill('The external monitors stay blank after docking. Started this morning.');
  await page.getByTestId('ticket-priority').selectOption('high');
  await page.getByLabel('Category').fill('Hardware');
  await page.getByTestId('ticket-title').scrollIntoViewIfNeeded();
  await frame('2-create');
  await page.getByRole('button', { name: 'Create Ticket' }).click();
  await dashboardPage.expectSuccess('Ticket created successfully.');
  await dashboardPage.expectTicketVisible('TKT-0009');
  await frame('3-created');

  await saved(() => dashboardPage.assignTicket('TKT-0009', 'Theo Technician'));
  await saved(() => dashboardPage.updateTicketStatus('TKT-0009', 'assigned'));
  await dashboardPage.expectAssignee('TKT-0009', 'Theo Technician');
  await frame('4-assigned');

  await saved(() => dashboardPage.updateTicketStatus('TKT-0009', 'in-progress'));
  await saved(() => dashboardPage.updateTicketStatus('TKT-0009', 'resolved'));
  await expect(page.getByLabel('Status for TKT-0009')).toHaveValue('resolved');
  await frame('5-resolved');

  await page.getByRole('link', { name: 'TKT-0009' }).click();
  await detailPage.expectLoaded('TKT-0009');
  await detailPage.expectActivityVisible();
  await page.getByRole('heading', { name: 'Ticket Activity Timeline' }).scrollIntoViewIfNeeded();
  await frame('6-timeline');
});
