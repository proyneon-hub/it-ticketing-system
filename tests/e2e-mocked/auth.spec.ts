import { expect, test } from '../fixtures/app.fixture';
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

test(
  'AUTH-008 a signed-in user stays signed in after reloading the page',
  { tag: ['@regression', '@auth'] },
  async ({ page, loginPage, dashboardPage }) => {
    await loginPage.loginAs('technician');
    await dashboardPage.expectLoaded();

    // The access token lives in memory only, so a reload starts with none. The page gets
    // a new one by trading the refresh cookie.
    await page.reload();

    await loginPage.expectSignedInUser(testUsers.technician.name);
    await dashboardPage.expectLoaded();
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('token-');
  }
);

test(
  'AUTH-009 an expired access token is renewed without the user noticing',
  { tag: ['@regression', '@auth'] },
  async ({ page, loginPage, dashboardPage }) => {
    let rejectedOnce = false;
    let refreshes = 0;
    await page.route('**/api/auth/refresh', (route) => {
      refreshes += 1;
      return route.fallback();
    });
    // The first ticket request after sign-in finds the token expired.
    await page.route('**/api/tickets?*', (route) => {
      if (rejectedOnce) return route.fallback();
      rejectedOnce = true;
      return route.fulfill({
        status: 401,
        json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
      });
    });

    await loginPage.loginAs('admin');

    await dashboardPage.expectTicketVisible('TKT-0001');
    expect(refreshes).toBe(1);
    await expect(page.getByText('Your session expired. Sign in again.')).toHaveCount(0);
  }
);

test(
  'AUTH-010 a session that cannot be renewed returns to sign-in with an explanation',
  { tag: ['@regression', '@auth', '@error'] },
  async ({ page, loginPage, dashboardPage }) => {
    // The session is ended elsewhere (signed out, or a role change) once this is set:
    // the access token is rejected and renewal is refused.
    let sessionEnded = false;
    await page.route('**/api/auth/refresh', (route) =>
      sessionEnded
        ? route.fulfill({
            status: 401,
            json: { message: 'Session expired. Sign in again.', code: 'UNAUTHORIZED' },
          })
        : route.fallback()
    );
    await page.route('**/api/tickets?*', (route) =>
      sessionEnded
        ? route.fulfill({
            status: 401,
            json: { message: 'Authentication required.', code: 'UNAUTHORIZED' },
          })
        : route.fallback()
    );

    await loginPage.loginAs('admin');
    await dashboardPage.expectTicketVisible('TKT-0001');
    // Idle: no request in flight when the session is ended, so the next one is the refresh.
    await expect(page.getByTestId('refresh-button')).toBeEnabled();
    sessionEnded = true;
    await dashboardPage.refresh();

    // The explanation, not the raw "Authentication required." of the request that failed.
    await dashboardPage.expectError('Your session expired. Sign in again.');
    await loginPage.expectSignedOut();
  }
);
