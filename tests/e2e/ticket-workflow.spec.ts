import { test } from '../fixtures/app.fixture';
import { testTickets } from '../test-data/tickets';

test('admin creates and deletes a ticket', async ({ loginPage, dashboardPage, ticketFormPage }) => {
  await loginPage.loginAs('admin');

  await ticketFormPage.createTicket(testTickets.monitorFlicker);

  await dashboardPage.expectSuccess('Ticket created successfully.');
  await dashboardPage.expectTicketVisible('TKT-0009');

  await dashboardPage.deleteFirstTicket();
  await dashboardPage.expectSuccess('Ticket deleted.');
});

test('technician updates ticket status and opens activity timeline', async ({
  loginPage,
  dashboardPage,
}) => {
  await loginPage.loginAs('technician');

  await dashboardPage.updateTicketStatus('TKT-0001', 'in-progress');
  await dashboardPage.expectSuccess('Ticket updated.');

  await dashboardPage.openTicket('TKT-0001');
  await dashboardPage.expectActivityVisible();
});
