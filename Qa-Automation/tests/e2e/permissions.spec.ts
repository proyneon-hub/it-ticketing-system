import { expect, test } from '@playwright/test';
import { buildTicketData } from '../../fixtures/ticketData';
import { ApiClient } from '../../utils/apiClient';
import { DashboardPage } from '../../pages/DashboardPage';
import { LoginPage } from '../../pages/LoginPage';
import { users } from '../../fixtures/users';

test('role controls change after sign out and sign in as another role', async ({ page }) => {
  const userApi = await ApiClient.forRole('user');
  const adminApi = await ApiClient.forRole('admin');
  const seeded = await userApi.client.createTicketAndReturn(
    buildTicketData({ title: `Role switch ${Date.now()}` })
  );
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);

  try {
    await login.loginWithDemoRole('admin');
    await dashboard.expectDashboardLoaded();
    await dashboard.signOut();
    await login.loginWithDemoRole('user');
    await dashboard.search(seeded.ticket.title);
    await dashboard.expectDeleteControlsHidden();
    await dashboard.expectWorkflowControlsDisabled();
  } finally {
    await adminApi.client.deleteTicket(seeded.ticket._id);
    await userApi.context.dispose();
    await adminApi.context.dispose();
  }
});

test('user ticket list does not expose other requester emails in visible rows', async ({
  page,
}) => {
  const login = new LoginPage(page);

  await login.loginWithDemoRole('user');
  const rows = page.getByTestId('ticket-row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    await expect(rows.nth(index)).toContainText(users.user.email);
  }
});
