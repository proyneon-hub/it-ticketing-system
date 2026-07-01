const { expect, test } = require('@playwright/test');
const { installApiMocks, loginAs } = require('./support');

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test('admin creates and deletes a ticket', async ({ page }) => {
  await loginAs(page, 'admin');

  await page.getByTestId('ticket-title').fill('Monitor flickers after docking');
  await page
    .getByTestId('ticket-description')
    .fill('External monitor flickers when laptop is docked.');
  await page.getByTestId('ticket-create-submit').click();

  await expect(page.getByText('Ticket created successfully.')).toBeVisible();
  await expect(page.getByText('TKT-0009')).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await page.getByTestId('ticket-delete-button').first().click();
  await expect(page.getByText('Ticket deleted.')).toBeVisible();
});

test('technician updates ticket status and opens activity timeline', async ({ page }) => {
  await loginAs(page, 'technician');

  await page.getByTestId('ticket-status-select').first().selectOption('in-progress');
  await expect(page.getByText('Ticket updated.')).toBeVisible();

  await page.getByTestId('ticket-activity-toggle').first().click();
  await expect(page.getByTestId('ticket-activity-row')).toBeVisible();
  await expect(page.getByText('Ticket Activity Timeline')).toBeVisible();
});
