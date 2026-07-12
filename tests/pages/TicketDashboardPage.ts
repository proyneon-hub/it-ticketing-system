import { expect, type Download, type Page } from '@playwright/test';
import type { TicketPriority, TicketStatus } from '../test-data/types';

export class TicketDashboardPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Ticket Dashboard' })).toBeVisible();
  }

  async search(term: string): Promise<void> {
    await this.page.getByLabel('Search tickets').fill(term);
  }

  async filterByStatus(status: TicketStatus): Promise<void> {
    await this.page.getByLabel('Filter by status').selectOption(status);
  }

  async filterByPriority(priority: TicketPriority): Promise<void> {
    await this.page.getByLabel('Filter by priority').selectOption(priority);
  }

  async openTicket(ticketNumber: string): Promise<void> {
    await this.ticketRow(ticketNumber).getByRole('button', { name: 'Activity' }).click();
  }

  async expectTicketVisible(ticketNumber: string): Promise<void> {
    await expect(this.ticketRow(ticketNumber)).toBeVisible();
  }

  async expectTicketHidden(ticketNumber: string): Promise<void> {
    await expect(this.ticketRow(ticketNumber)).toHaveCount(0);
  }

  async expectDeleteControlsVisible(): Promise<void> {
    await expect(this.page.getByTestId('ticket-delete-button').first()).toBeVisible();
  }

  async expectDeleteControlsHidden(): Promise<void> {
    await expect(this.page.getByTestId('ticket-delete-button')).toHaveCount(0);
  }

  async expectWorkflowControlsDisabled(): Promise<void> {
    await expect(this.page.getByTestId('ticket-status-select').first()).toBeDisabled();
    await expect(this.page.getByLabel(/Assignee for/).first()).toBeDisabled();
  }

  async expectTotalTickets(total: number): Promise<void> {
    const totalCard = this.page.locator('.stat-card').filter({ hasText: 'Total Tickets' });
    await expect(totalCard.getByText(String(total), { exact: true })).toBeVisible();
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.page.getByText('No tickets found.', { exact: true })).toBeVisible();
  }

  async expectLoadingState(): Promise<void> {
    await expect(this.page.getByText('Loading tickets...', { exact: true })).toBeVisible();
  }

  async expectError(message: string): Promise<void> {
    await expect(this.page.getByText(message, { exact: true })).toBeVisible();
  }

  async exportCsv(): Promise<Download> {
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Export CSV' }).click();
    return downloadPromise;
  }

  async updateTicketStatus(ticketNumber: string, status: TicketStatus): Promise<void> {
    await this.ticketRow(ticketNumber)
      .getByLabel(`Status for ${ticketNumber}`)
      .selectOption(status);
  }

  async assignTicket(ticketNumber: string, assignee: string): Promise<void> {
    const assigneeInput = this.ticketRow(ticketNumber).getByLabel(`Assignee for ${ticketNumber}`);
    await assigneeInput.fill(assignee);
    await assigneeInput.blur();
  }

  async expectAssignee(ticketNumber: string, assignee: string): Promise<void> {
    await expect(
      this.ticketRow(ticketNumber).getByLabel(`Assignee for ${ticketNumber}`)
    ).toHaveValue(assignee);
  }

  async deleteFirstTicket(): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.accept());
    await this.page.getByTestId('ticket-delete-button').first().click();
  }

  async expectSuccess(message: string): Promise<void> {
    await expect(this.page.getByText(message, { exact: true })).toBeVisible();
  }

  async expectActivityVisible(): Promise<void> {
    await expect(this.page.getByTestId('ticket-activity-row')).toBeVisible();
    await expect(
      this.page.getByRole('heading', { name: 'Ticket Activity Timeline' })
    ).toBeVisible();
  }

  private ticketRow(ticketNumber: string) {
    return this.page.getByTestId('ticket-row').filter({ hasText: ticketNumber });
  }
}
