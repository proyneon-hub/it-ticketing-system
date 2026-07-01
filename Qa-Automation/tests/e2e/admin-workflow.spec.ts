import { expect, test } from '@playwright/test';
import { ApiClient } from '../../utils/apiClient';
import { DashboardPage } from '../../pages/DashboardPage';
import { LoginPage } from '../../pages/LoginPage';
import { TicketPage } from '../../pages/TicketPage';

test('admin can create, update, inspect, and delete a ticket', async ({ page }) => {
  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  const tickets = new TicketPage(page);

  await login.loginWithDemoRole('admin');
  const created = await tickets.createTicket({ priority: 'high' });
  await tickets.changeFirstTicketPriority('urgent');
  await tickets.changeFirstTicketAssignee('QA Escalation Team');
  await tickets.changeFirstTicketStatus('in-progress');
  await dashboard.openFirstActivityTimeline();
  await tickets.deleteTicketByTitle(created.title);
});

test('admin API cleanup can remove automation-created tickets', async () => {
  const { client, context } = await ApiClient.forRole('admin');
  const created = await client.createTicketAndReturn({
    title: `Admin cleanup ${Date.now()}`,
    description: 'Temporary ticket for cleanup verification.',
    requesterName: 'QA Admin',
    requesterEmail: 'qa-admin@example.com',
    priority: 'low',
  });

  const deleteResponse = await client.deleteTicket(created.ticket._id);
  expect(deleteResponse.status()).toBe(204);
  await context.dispose();
});
