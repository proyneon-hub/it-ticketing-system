import { expect, test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { TicketDashboardPage } from '../pages/TicketDashboardPage';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

// Read-only, and true for any data set: whatever a requester sees must be theirs.
test(
  'LIVE-ROLE-001 a requester only sees their own tickets and has no delete controls',
  { tag: ['@smoke', '@requester'] },
  async ({ page }) => {
    const credentials = credentialsFor('user');
    if (!credentials) {
      test.skip(true, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD for the requester smoke test.');
      return;
    }

    const loginPage = new LoginPage(page);
    const dashboardPage = new TicketDashboardPage(page);

    await loginPage.goto();
    await loginPage.login(credentials.email, credentials.password);
    await dashboardPage.expectLoaded();
    await dashboardPage.expectDataLoaded();

    const rows = page.getByTestId('ticket-row');
    await expect(rows.filter({ hasNotText: credentials.email })).toHaveCount(0);
    await dashboardPage.expectDeleteControlsHidden();
  }
);
