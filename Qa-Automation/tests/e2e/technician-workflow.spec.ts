import { expect, test } from '@playwright/test';
import { buildTicketData } from '../../fixtures/ticketData';
import { ApiClient } from '../../utils/apiClient';
import { DashboardPage } from '../../pages/DashboardPage';
import { LoginPage } from '../../pages/LoginPage';
import { TicketPage } from '../../pages/TicketPage';

test('technician can view the queue and update ticket status', async ({ page }) => {
  const admin = await ApiClient.forRole('admin');
  const seeded = await admin.client.createTicketAndReturn(
    buildTicketData({ assignee: 'Theo Technician', title: `Technician workflow ${Date.now()}` })
  );
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  const tickets = new TicketPage(page);

  try {
    await login.loginWithDemoRole('technician');
    await dashboard.search(seeded.ticket.title);
    await dashboard.expectTicketRowsVisible();
    await dashboard.expectWorkflowControlsEnabled();
    await tickets.changeFirstTicketStatus('in-progress');
  } finally {
    await admin.client.deleteTicket(seeded.ticket._id);
    await admin.context.dispose();
  }
});

test('technician cannot delete tickets', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);

  await login.loginWithDemoRole('technician');
  await dashboard.expectDeleteControlsHidden();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});
