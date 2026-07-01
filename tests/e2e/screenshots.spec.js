const { test } = require('@playwright/test');
const { installApiMocks, loginAs } = require('./support');

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('captures role dashboards and workflow screenshots', async ({ page }) => {
  await loginAs(page, 'admin');
  await page.screenshot({ path: 'docs/screenshots/admin-dashboard.png', fullPage: true });

  await page.getByTestId('ticket-title').fill('Screenshot ticket create form');
  await page.screenshot({ path: 'docs/screenshots/ticket-create-form.png', fullPage: true });

  await page.getByTestId('ticket-activity-toggle').first().click();
  await page.screenshot({ path: 'docs/screenshots/ticket-update-flow.png', fullPage: true });

  await page.getByTestId('logout-button').click();
  await loginAs(page, 'technician');
  await page.screenshot({ path: 'docs/screenshots/technician-dashboard.png', fullPage: true });

  await page.getByTestId('logout-button').click();
  await loginAs(page, 'user');
  await page.screenshot({ path: 'docs/screenshots/user-dashboard.png', fullPage: true });
});
