import { expect, test } from '../fixtures/app.fixture';

test('technician cannot access admin-only delete controls', async ({
  loginPage,
  dashboardPage,
}) => {
  await loginPage.loginAs('technician');

  await dashboardPage.expectDeleteControlsHidden();
});

test('user cannot update workflow controls', async ({ loginPage, dashboardPage }) => {
  await loginPage.loginAs('user');

  await dashboardPage.expectWorkflowControlsDisabled();
});

test('user can export only the scoped ticket list', async ({ loginPage, dashboardPage }) => {
  await loginPage.loginAs('user');

  const download = await dashboardPage.exportCsv();

  expect(download.suggestedFilename()).toBe('tickets.csv');
});
