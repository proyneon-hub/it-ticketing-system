import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { TicketDashboardPage } from '../pages/TicketDashboardPage';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

test(
  'LIVE-AUTH-001 configured admin can load the live dashboard',
  { tag: ['@smoke', '@admin'] },
  async ({ page }) => {
    const credentials = credentialsFor('admin');
    if (!credentials) {
      test.skip(true, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for the live login smoke test.');
      return;
    }

    const loginPage = new LoginPage(page);
    const dashboardPage = new TicketDashboardPage(page);

    await loginPage.goto();
    await loginPage.login(credentials.email, credentials.password);
    await dashboardPage.expectLoaded();
  }
);
