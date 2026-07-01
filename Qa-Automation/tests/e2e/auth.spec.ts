import { expect, test } from '@playwright/test';
import { DashboardPage } from '../../pages/DashboardPage';
import { LoginPage } from '../../pages/LoginPage';
import { users } from '../../fixtures/users';

test('admin can log in and see the dashboard', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);

  await login.loginWithDemoRole('admin');
  await dashboard.expectSignedInAs('admin');
  await dashboard.expectDashboardLoaded();
});

test('technician can log in without delete controls', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);

  await login.loginWithDemoRole('technician');
  await dashboard.expectSignedInAs('technician');
  await dashboard.expectDashboardLoaded();
  await dashboard.expectWorkflowControlsEnabled();
  await dashboard.expectDeleteControlsHidden();
});

test('user can log in with requester-scoped permissions', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);

  await login.loginWithDemoRole('user');
  await dashboard.expectSignedInAs('user');
  await dashboard.expectDashboardLoaded();
  await dashboard.expectDeleteControlsHidden();
  await dashboard.expectWorkflowControlsDisabled();
});

test('invalid password fails with a clear error', async ({ page }) => {
  const login = new LoginPage(page);

  await login.loginWithCredentials(users.admin.email, 'WrongPassword123!');
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await login.expectLoginFormVisible();
});

test('signed-out visitor sees sign-in screen instead of protected dashboard', async ({ page }) => {
  const login = new LoginPage(page);

  await login.goto();
  await login.expectLoginFormVisible();
  await expect(
    page.getByRole('heading', { name: 'Sign in to open the service desk.' })
  ).toBeVisible();
});
