import { expect } from '@playwright/test';
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

test(
  'TICKET-006 a rejected status change shows the workflow message',
  { tag: ['@regression', '@technician', '@ticket', '@error'] },
  async ({ page, loginPage, dashboardPage }) => {
    // The API answers 409 when a status move is not allowed by the workflow.
    await page.route('**/api/tickets/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 409,
            json: {
              message: 'Cannot move a ticket from open to resolved.',
              code: 'INVALID_TRANSITION',
            },
          })
        : route.fallback()
    );

    await loginPage.loginAs('technician');
    await dashboardPage.updateTicketStatus('TKT-0001', 'in-progress');

    await dashboardPage.expectError('Cannot move a ticket from open to resolved.');
  }
);

test(
  'TICKET-007 the status menu only offers moves the workflow allows',
  { tag: ['@regression', '@technician', '@ticket'] },
  async ({ page, loginPage }) => {
    await loginPage.loginAs('technician');

    const statusMenu = page.getByLabel('Status for TKT-0001');
    await expect(statusMenu).toBeVisible();
    const options = await statusMenu.locator('option').allTextContents();

    // TKT-0001 is open: it cannot jump straight to resolved.
    expect(options).toEqual(['Open', 'Assigned', 'In Progress', 'Closed']);
  }
);

test(
  'TICKET-008 edits are sent against the loaded version and a conflict reloads the list',
  { tag: ['@regression', '@technician', '@ticket', '@error'] },
  async ({ page, loginPage, dashboardPage }) => {
    let sentVersion: string | undefined;
    let listRequests = 0;

    await page.route('**/api/tickets?*', (route) => {
      listRequests += 1;
      return route.fallback();
    });
    // Someone else changed the ticket after this page loaded it.
    await page.route('**/api/tickets/*', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      sentVersion = route.request().headers()['x-ticket-version'];
      return route.fulfill({
        status: 409,
        json: {
          message: 'This ticket changed since you loaded it. Reload it and try again.',
          code: 'VERSION_CONFLICT',
        },
      });
    });

    await loginPage.loginAs('technician');
    await dashboardPage.expectTicketVisible('TKT-0001');
    const listRequestsBeforeEdit = listRequests;

    await dashboardPage.updateTicketStatus('TKT-0001', 'in-progress');

    await dashboardPage.expectError(
      'This ticket changed since you loaded it. Reload it and try again.'
    );
    expect(sentVersion).toBe('0');
    await expect.poll(() => listRequests).toBeGreaterThan(listRequestsBeforeEdit);
  }
);
