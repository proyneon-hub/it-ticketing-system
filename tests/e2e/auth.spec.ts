import { test } from '../fixtures/app.fixture';
import { testUsers } from '../test-data/users';

test('admin logs in and sees the full dashboard', async ({ loginPage, dashboardPage }) => {
  await loginPage.goto();
  await loginPage.login(testUsers.admin.email, testUsers.admin.password);

  await loginPage.expectSignedInUser(testUsers.admin.name);
  await dashboardPage.expectLoaded();
  await dashboardPage.expectTicketVisible('TKT-0001');
  await dashboardPage.expectDeleteControlsVisible();
});

test('technician logs in and sees the full queue without delete controls', async ({
  loginPage,
  dashboardPage,
}) => {
  await loginPage.goto();
  await loginPage.login(testUsers.technician.email, testUsers.technician.password);

  await loginPage.expectSignedInUser(testUsers.technician.name);
  await dashboardPage.expectLoaded();
  await dashboardPage.expectTicketVisible('TKT-0001');
  await dashboardPage.expectDeleteControlsHidden();
});

test('user logs in and sees only requester-scoped tickets', async ({
  loginPage,
  dashboardPage,
}) => {
  await loginPage.goto();
  await loginPage.login(testUsers.user.email, testUsers.user.password);

  await loginPage.expectSignedInUser(testUsers.user.name);
  await dashboardPage.expectLoaded();
  await dashboardPage.expectTicketVisible('TKT-0002');
  await dashboardPage.expectTicketHidden('TKT-0001');
});
