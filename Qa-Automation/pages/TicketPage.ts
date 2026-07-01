import { expect, Page } from '@playwright/test';
import { buildTicketData } from '../fixtures/ticketData';

export class TicketPage {
  constructor(private readonly page: Page) {}

  async createTicket(overrides: Record<string, string> = {}) {
    const ticket = buildTicketData(overrides);
    await this.page.getByTestId('ticket-title').fill(ticket.title);
    await this.page.getByTestId('ticket-description').fill(ticket.description);
    await this.page.getByTestId('ticket-priority').selectOption(ticket.priority);

    const requesterName = this.page.getByLabel('Requester Name');
    if (await requesterName.isEnabled()) {
      await requesterName.fill(ticket.requesterName);
    }

    const requesterEmail = this.page.getByLabel('Requester Email');
    if (await requesterEmail.isEnabled()) {
      await requesterEmail.fill(ticket.requesterEmail);
    }

    await this.page.getByLabel('Category').fill(ticket.category);

    const assignee = this.page.getByLabel('Assignee');
    if (await assignee.isEnabled()) {
      await assignee.fill(ticket.assignee);
    }

    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/api/tickets') && res.request().method() === 'POST'
      ),
      this.page.getByTestId('ticket-create-submit').click(),
    ]);

    expect(response.status()).toBe(201);
    await expect(this.page.getByText('Ticket created successfully.')).toBeVisible();
    await expect(this.page.getByText(ticket.title)).toBeVisible();
    return ticket;
  }

  async changeFirstTicketStatus(status: string) {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/api/tickets/') && res.request().method() === 'PATCH'
      ),
      this.page.getByTestId('ticket-status-select').first().selectOption(status),
    ]);

    expect(response.status()).toBe(200);
    await expect(this.page.getByText('Ticket updated.')).toBeVisible();
  }

  async changeFirstTicketPriority(priority: string) {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/api/tickets/') && res.request().method() === 'PATCH'
      ),
      this.page
        .getByLabel(/Priority for/i)
        .first()
        .selectOption(priority),
    ]);

    expect(response.status()).toBe(200);
    await expect(this.page.getByText('Ticket updated.')).toBeVisible();
  }

  async changeFirstTicketAssignee(assignee: string) {
    const input = this.page.getByLabel(/Assignee for/i).first();
    await input.fill(assignee);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/api/tickets/') && res.request().method() === 'PATCH'
      ),
      input.blur(),
    ]);

    expect(response.status()).toBe(200);
    await expect(this.page.getByText('Ticket updated.')).toBeVisible();
  }

  async deleteTicketByTitle(title: string) {
    const row = this.page.getByRole('row').filter({ hasText: title });
    this.page.once('dialog', (dialog) => dialog.accept());
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/api/tickets/') && res.request().method() === 'DELETE'
      ),
      row.getByTestId('ticket-delete-button').click(),
    ]);

    expect(response.status()).toBe(204);
    await expect(this.page.getByText('Ticket deleted.')).toBeVisible();
    await expect(this.page.getByText(title)).toHaveCount(0);
  }
}
