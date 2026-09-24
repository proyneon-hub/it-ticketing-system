import { expect, test as base } from '@playwright/test';
import { installApiMocks } from '../e2e-mocked/support';
import { AdminPage } from '../pages/AdminPage';
import { LoginPage } from '../pages/LoginPage';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { TicketDashboardPage } from '../pages/TicketDashboardPage';
import { TicketFormPage } from '../pages/TicketFormPage';

type AppFixtures = {
  mockedApi: void;
  loginPage: LoginPage;
  dashboardPage: TicketDashboardPage;
  ticketFormPage: TicketFormPage;
  detailPage: TicketDetailPage;
  adminPage: AdminPage;
};

export const test = base.extend<AppFixtures>({
  mockedApi: [
    async ({ page }, use) => {
      await installApiMocks(page);
      await use();
    },
    { auto: true },
  ],
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new TicketDashboardPage(page));
  },
  ticketFormPage: async ({ page }, use) => {
    await use(new TicketFormPage(page));
  },
  detailPage: async ({ page }, use) => {
    await use(new TicketDetailPage(page));
  },
  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },
});

export { expect };
