import { expect, test as base } from '@playwright/test';
import { installAgentMocks, type AgentMockState } from '../e2e-mocked/agentSupport';
import { installApiMocks } from '../e2e-mocked/support';
import { AgentPage } from '../pages/AgentPage';
import { AdminPage } from '../pages/AdminPage';
import { LoginPage } from '../pages/LoginPage';
import { TicketDetailPage } from '../pages/TicketDetailPage';
import { TicketDashboardPage } from '../pages/TicketDashboardPage';
import { TicketFormPage } from '../pages/TicketFormPage';
import { TrendsPage } from '../pages/TrendsPage';

type AppFixtures = {
  mockedApi: void;
  agentApi: AgentMockState;
  agentPage: AgentPage;
  loginPage: LoginPage;
  dashboardPage: TicketDashboardPage;
  ticketFormPage: TicketFormPage;
  detailPage: TicketDetailPage;
  adminPage: AdminPage;
  trendsPage: TrendsPage;
};

export const test = base.extend<AppFixtures>({
  mockedApi: [
    async ({ page }, use) => {
      await installApiMocks(page);
      await use();
    },
    { auto: true },
  ],
  // Only for the tests that ask for it: the agent's endpoints, added on top of the mocked API.
  agentApi: async ({ page, mockedApi: _mockedApi }, use) => {
    await use(await installAgentMocks(page));
  },
  agentPage: async ({ page }, use) => {
    await use(new AgentPage(page));
  },
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
  trendsPage: async ({ page }, use) => {
    await use(new TrendsPage(page));
  },
});

export { expect };
