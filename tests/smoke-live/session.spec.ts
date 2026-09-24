import { expect, test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { TicketDashboardPage } from '../pages/TicketDashboardPage';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

// The refresh cookie only exists between a real browser and a real server, so a mocked
// test cannot prove it works: cookie flags, its path, and the browser sending it back.
test(
  'LIVE-SESSION-001 a real browser stays signed in after a reload, using the refresh cookie',
  { tag: ['@smoke', '@auth'] },
  async ({ page }) => {
    const credentials = credentialsFor('admin');
    if (!credentials) {
      test.skip(true, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for the session smoke test.');
      return;
    }
    const loginPage = new LoginPage(page);
    const dashboardPage = new TicketDashboardPage(page);

    await loginPage.goto();
    await loginPage.login(credentials.email, credentials.password);
    await dashboardPage.expectLoaded();
    await dashboardPage.expectDataLoaded();

    // The token that lets a script act as the user must not be readable by scripts.
    const cookies = await page.context().cookies();
    const refresh = cookies.find((cookie) => cookie.name === 'rt');
    expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/auth' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('rt=');
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toMatch(/eyJ/);

    // A reload drops the in-memory access token; the cookie brings the session back.
    await page.reload();

    await dashboardPage.expectLoaded();
    await dashboardPage.expectDataLoaded();
  }
);

test(
  'LIVE-SESSION-002 refresh tokens rotate, a used one is refused, and sign-out ends the session',
  { tag: ['@smoke', '@auth'] },
  async ({ request }) => {
    const credentials = credentialsFor('user');
    if (!credentials) {
      test.skip(true, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD for the session smoke test.');
      return;
    }
    const cookieOf = (setCookie: string | undefined) => /rt=([^;]+)/.exec(setCookie ?? '')?.[1];
    const withCookie = (value: string | undefined) => ({ headers: { Cookie: `rt=${value}` } });

    const login = await request.post('/api/auth/login', { data: credentials });
    expect(login.ok()).toBe(true);
    const first = cookieOf(login.headers()['set-cookie']);
    expect(first).toBeTruthy();

    const refreshed = await request.post('/api/auth/refresh', withCookie(first));
    expect(refreshed.status()).toBe(200);
    const second = cookieOf(refreshed.headers()['set-cookie']);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    // The first token has been used: presenting it again is treated as theft, which also
    // ends the session the second token belonged to.
    expect((await request.post('/api/auth/refresh', withCookie(first))).status()).toBe(401);
    expect((await request.post('/api/auth/refresh', withCookie(second))).status()).toBe(401);

    const again = await request.post('/api/auth/login', { data: credentials });
    const third = cookieOf(again.headers()['set-cookie']);
    expect((await request.post('/api/auth/logout', withCookie(third))).status()).toBe(204);
    expect((await request.post('/api/auth/refresh', withCookie(third))).status()).toBe(401);
  }
);

test(
  'LIVE-ADMIN-001 only admins can see users and the audit log',
  { tag: ['@smoke', '@admin'] },
  async ({ request }) => {
    const admin = credentialsFor('admin');
    const requester = credentialsFor('user');
    if (!admin || !requester) {
      test.skip(true, 'Set the admin and requester E2E_* credentials for the admin smoke test.');
      return;
    }
    const token = async (credentials: { email: string; password: string }) => ({
      headers: {
        Authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: credentials })).json()).token}`,
      },
    });

    const users = await request.get('/api/users', await token(admin));
    expect(users.status()).toBe(200);
    const body = await users.json();
    expect(body.users.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|argon2/);

    const audit = await request.get('/api/audit?type=login_success&limit=1', await token(admin));
    expect(audit.status()).toBe(200);
    expect((await audit.json()).events[0]).toMatchObject({ type: 'login_success' });

    expect((await request.get('/api/users', await token(requester))).status()).toBe(403);
    expect((await request.get('/api/audit', await token(requester))).status()).toBe(403);
  }
);

// Deep links only work when the server falls back to the app for any non-API path, and a
// reload on one of them has to restore the session before the route guard decides.
test(
  'LIVE-ROUTE-001 a deep link reloads onto the same page and stays signed in',
  { tag: ['@smoke', '@auth'] },
  async ({ page }) => {
    const credentials = credentialsFor('admin');
    if (!credentials) {
      test.skip(true, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for the routing smoke test.');
      return;
    }
    const loginPage = new LoginPage(page);
    const dashboardPage = new TicketDashboardPage(page);

    await loginPage.goto();
    await loginPage.login(credentials.email, credentials.password);
    await dashboardPage.expectLoaded();

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Users' })
      .click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByTestId('user-row').first()).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByTestId('user-row').first()).toBeVisible();
  }
);
