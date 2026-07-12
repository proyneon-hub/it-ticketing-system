import { expect, test as base } from '@playwright/test';
import { installApiMocks } from '../e2e/support';
import { LoginPage } from '../pages/LoginPage';
import { TicketDashboardPage } from '../pages/TicketDashboardPage';
import { TicketFormPage } from '../pages/TicketFormPage';

type AppFixtures = {
  mockedApi: void;
  loginPage: LoginPage;
  dashboardPage: TicketDashboardPage;
  ticketFormPage: TicketFormPage;
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
});

export { expect };
