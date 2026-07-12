import { test } from '@playwright/test';
import { installApiMocks, loginAs } from './support';

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('captures role dashboards and workflow screenshots', async ({ page }, testInfo) => {
  await loginAs(page, 'admin');
  await page.screenshot({ path: testInfo.outputPath('admin-dashboard.png'), fullPage: true });

  await page.getByTestId('ticket-title').fill('Screenshot ticket create form');
  await page.screenshot({ path: testInfo.outputPath('ticket-create-form.png'), fullPage: true });

  await page.getByTestId('ticket-activity-toggle').first().click();
  await page.screenshot({ path: testInfo.outputPath('ticket-update-flow.png'), fullPage: true });

  await page.getByTestId('logout-button').click();
  await loginAs(page, 'technician');
  await page.screenshot({ path: testInfo.outputPath('technician-dashboard.png'), fullPage: true });

  await page.getByTestId('logout-button').click();
  await loginAs(page, 'user');
  await page.screenshot({ path: testInfo.outputPath('user-dashboard.png'), fullPage: true });
});
