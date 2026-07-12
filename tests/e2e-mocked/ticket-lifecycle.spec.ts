import { test } from '../fixtures/app.fixture';
import { testTickets } from '../test-data/tickets';

test(
  'TICKET-001 admin can create and delete a ticket',
  { tag: ['@regression', '@admin', '@ticket'] },
  async ({ loginPage, dashboardPage, ticketFormPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectTotalTickets(2);

    await ticketFormPage.createTicket(testTickets.monitorFlicker);

    await dashboardPage.expectSuccess('Ticket created successfully.');
    await dashboardPage.expectTicketVisible('TKT-0009');
    await dashboardPage.expectTotalTickets(3);

    await dashboardPage.deleteFirstTicket();

    await dashboardPage.expectSuccess('Ticket deleted.');
    await dashboardPage.expectTotalTickets(2);
  }
);

test(
  'TICKET-002 title is required',
  { tag: ['@regression', '@ticket'] },
  async ({ loginPage, ticketFormPage }) => {
    await loginPage.loginAs('admin');
    await ticketFormPage.submitWithoutTitle();

    await ticketFormPage.expectTitleRequired();
  }
);

test(
  'TICKET-003 description is required',
  { tag: ['@regression', '@ticket'] },
  async ({ loginPage, ticketFormPage }) => {
    await loginPage.loginAs('admin');
    await ticketFormPage.submitWithoutDescription();

    await ticketFormPage.expectDescriptionRequired();
  }
);

test(
  'TICKET-004 admin can assign a technician',
  { tag: ['@regression', '@admin', '@ticket'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.assignTicket('TKT-0001', 'Theo Technician');

    await dashboardPage.expectSuccess('Ticket updated.');
    await dashboardPage.expectAssignee('TKT-0001', 'Theo Technician');
  }
);

test(
  'TICKET-005 technician updates status and sees activity',
  { tag: ['@regression', '@technician', '@ticket'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('technician');
    await dashboardPage.updateTicketStatus('TKT-0001', 'in-progress');

    await dashboardPage.expectSuccess('Ticket updated.');
    await dashboardPage.openTicket('TKT-0001');
    await dashboardPage.expectActivityVisible();
  }
);
