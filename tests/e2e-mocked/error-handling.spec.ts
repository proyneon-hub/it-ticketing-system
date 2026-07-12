import { test } from '../fixtures/app.fixture';

test(
  'ERROR-001 API failure displays an actionable error',
  { tag: ['@regression', '@error'] },
  async ({ page, loginPage, dashboardPage }) => {
    await page.route('**/api/tickets?*', (route) =>
      route.fulfill({ status: 503, json: { message: 'Tickets are temporarily unavailable.' } })
    );

    await loginPage.loginAs('admin');

    await dashboardPage.expectError('Tickets are temporarily unavailable.');
  }
);

test(
  'ERROR-002 loading state is visible while tickets are pending',
  { tag: ['@regression', '@error'] },
  async ({ page, loginPage, dashboardPage }) => {
    let releaseTicketsRequest: () => void = () => undefined;
    const ticketsRequestPending = new Promise<void>((resolve) => {
      releaseTicketsRequest = resolve;
    });

    await page.route('**/api/tickets?*', async (route) => {
      await ticketsRequestPending;
      await route.fallback();
    });

    await loginPage.loginAs('admin');
    await dashboardPage.expectLoadingState();

    releaseTicketsRequest();
    await dashboardPage.expectTicketVisible('TKT-0001');
  }
);
