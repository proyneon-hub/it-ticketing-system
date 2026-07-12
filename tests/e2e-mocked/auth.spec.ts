import { test } from '../fixtures/app.fixture';
import { testUsers } from '../test-data/users';

test(
  'AUTH-001 admin can log in',
  { tag: ['@regression', '@auth', '@admin'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.goto();
    await loginPage.login(testUsers.admin.email, testUsers.admin.password);

    await loginPage.expectSignedInUser(testUsers.admin.name);
    await dashboardPage.expectLoaded();
    await dashboardPage.expectDeleteControlsVisible();
  }
);

test(
  'AUTH-002 technician can log in',
  { tag: ['@regression', '@auth', '@technician'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.goto();
    await loginPage.login(testUsers.technician.email, testUsers.technician.password);

    await loginPage.expectSignedInUser(testUsers.technician.name);
    await dashboardPage.expectLoaded();
  }
);

test(
  'AUTH-003 requester can log in',
  { tag: ['@regression', '@auth', '@requester'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.goto();
    await loginPage.login(testUsers.user.email, testUsers.user.password);

    await loginPage.expectSignedInUser(testUsers.user.name);
    await dashboardPage.expectLoaded();
  }
);

test(
  'AUTH-004 invalid password displays an error',
  { tag: ['@regression', '@auth', '@error'] },
  async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.login(testUsers.admin.email, 'incorrect-password');

    await loginPage.expectLoginError('Invalid demo credentials.');
  }
);

test(
  'AUTH-007 logout returns the user to login',
  { tag: ['@regression', '@auth'] },
  async ({ loginPage }) => {
    await loginPage.loginAs('admin');
    await loginPage.logout();

    await loginPage.expectSignedOut();
  }
);
