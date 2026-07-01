const { expect, test } = require('@playwright/test');
const { installApiMocks, loginAs } = require('./support');

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('technician cannot access admin-only delete controls', async ({ page }) => {
  await loginAs(page, 'technician');

  await expect(page.getByTestId('ticket-delete-button')).toHaveCount(0);
});

test('user cannot update workflow controls', async ({ page }) => {
  await loginAs(page, 'user');

  await expect(page.getByTestId('ticket-status-select')).toBeDisabled();
  await expect(page.locator('.assignee-input')).toBeDisabled();
});

test('user can export only the scoped ticket list', async ({ page }) => {
  await loginAs(page, 'user');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('ticket-export-button').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('tickets.csv');
});
