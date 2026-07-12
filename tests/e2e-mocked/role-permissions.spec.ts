import { test } from '../fixtures/app.fixture';

test(
  'ROLE-002 technician cannot access admin-only delete controls',
  { tag: ['@regression', '@technician'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('technician');

    await dashboardPage.expectDeleteControlsHidden();
  }
);

test(
  'ROLE-003 requester cannot see administrative controls',
  { tag: ['@regression', '@requester'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('user');

    await dashboardPage.expectDeleteControlsHidden();
    await dashboardPage.expectWorkflowControlsDisabled();
  }
);

test(
  'ROLE-004 requester sees only owned tickets',
  { tag: ['@regression', '@requester'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('user');

    await dashboardPage.expectTicketVisible('TKT-0002');
    await dashboardPage.expectTicketHidden('TKT-0001');
  }
);
