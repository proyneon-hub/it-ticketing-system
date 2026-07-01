import { expect, test } from '@playwright/test';
import { ApiClient } from '../../utils/apiClient';
import { DashboardPage } from '../../pages/DashboardPage';
import { LoginPage } from '../../pages/LoginPage';
import { TicketPage } from '../../pages/TicketPage';
import { users } from '../../fixtures/users';

test('user can create a requester-scoped ticket', async ({ page }) => {
  const login = new LoginPage(page);
  const tickets = new TicketPage(page);
  let createdTitle = '';

  try {
    await login.loginWithDemoRole('user');
    const created = await tickets.createTicket({ priority: 'medium' });
    createdTitle = created.title;

    const row = page.getByRole('row').filter({ hasText: created.title });
    await expect(row).toContainText(users.user.email);
    await expect(row.getByTestId('ticket-status-select')).toBeDisabled();
  } finally {
    if (createdTitle) {
      const admin = await ApiClient.forRole('admin');
      const response = await admin.client.listTickets({ search: createdTitle });
      const body = await response.json();
      for (const ticket of body.tickets) {
        await admin.client.deleteTicket(ticket._id);
      }
      await admin.context.dispose();
    }
  }
});

test('user cannot see assignment or delete controls', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);

  await login.loginWithDemoRole('user');
  await dashboard.expectDeleteControlsHidden();
  await dashboard.expectWorkflowControlsDisabled();
  await expect(page.getByLabel(/Assignee for/i).first()).toBeDisabled();
});
