const { expect, test } = require('@playwright/test');
const { installApiMocks, loginAs } = require('./support');

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('admin logs in and sees the full dashboard', async ({ page }) => {
  await loginAs(page, 'admin');

  await expect(page.locator('.session-card strong')).toHaveText('Priya Admin');
  await expect(page.getByText('TKT-0001')).toBeVisible();
  await expect(page.getByTestId('ticket-delete-button').first()).toBeVisible();
});

test('technician logs in and sees the full queue without delete controls', async ({ page }) => {
  await loginAs(page, 'technician');

  await expect(page.locator('.session-card strong')).toHaveText('Theo Technician');
  await expect(page.getByText('TKT-0001')).toBeVisible();
  await expect(page.getByTestId('ticket-delete-button')).toHaveCount(0);
});

test('user logs in and sees only requester-scoped tickets', async ({ page }) => {
  await loginAs(page, 'user');

  await expect(page.locator('.session-card strong')).toHaveText('Una User');
  await expect(page.getByText('TKT-0002')).toBeVisible();
  await expect(page.getByText('TKT-0001')).toHaveCount(0);
});
