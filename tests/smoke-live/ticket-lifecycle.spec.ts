import { test } from '@playwright/test';
import { TicketDashboardPage } from '../pages/TicketDashboardPage';
import { TicketFormPage } from '../pages/TicketFormPage';
import { LoginPage } from '../pages/LoginPage';
import { credentialsFor, liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

test(
  'LIVE-TICKET-001 admin creates and cleans up a dedicated live ticket',
  { tag: ['@smoke', '@admin', '@ticket'] },
  async ({ page }) => {
    const credentials = credentialsFor('admin');
    if (!credentials) {
      test.skip(true, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for the live ticket smoke test.');
      return;
    }

    const title = `PW-LIVE-${Date.now()}`;
    const loginPage = new LoginPage(page);
    const dashboardPage = new TicketDashboardPage(page);
    const ticketFormPage = new TicketFormPage(page);
    let created = false;

    await loginPage.goto();
    await loginPage.login(credentials.email, credentials.password);
    await dashboardPage.expectLoaded();

    try {
      await ticketFormPage.createTicket({
        title,
        description: 'Dedicated Playwright live smoke test ticket. Safe to delete.',
        category: 'Automation',
        priority: 'low',
      });
      await dashboardPage.expectSuccess('Ticket created successfully.');
      await dashboardPage.expectTicketVisible(title);
      created = true;
    } finally {
      if (created) {
        await dashboardPage.deleteTicket(title);
        await dashboardPage.expectSuccess('Ticket deleted.');
      }
    }
  }
);
