import { expect, type Page } from '@playwright/test';
import type { NewTicketData } from '../test-data/types';

export type { NewTicketData } from '../test-data/types';

export class TicketFormPage {
  constructor(private readonly page: Page) {}

  async createTicket(data: NewTicketData): Promise<void> {
    await this.page.getByTestId('ticket-title').fill(data.title);
    await this.page.getByTestId('ticket-description').fill(data.description);
    await this.page.getByTestId('ticket-priority').selectOption(data.priority);
    await this.page.getByLabel('Category').fill(data.category);
    await this.submit();
  }

  async submit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Create Ticket' }).click();
  }

  async expectValidationError(message: string): Promise<void> {
    await expect(this.page.getByText(message, { exact: true })).toBeVisible();
  }
}
