import { expect, type Page } from '@playwright/test';
import type { TicketPriority, TicketStatus } from '../test-data/types';

// One ticket on its own page (/tickets/:id).
export class TicketDetailPage {
  constructor(private readonly page: Page) {}

  async expectLoaded(ticketNumber: string): Promise<void> {
    await expect(this.page.getByText(ticketNumber, { exact: true }).first()).toBeVisible();
    await expect(this.page.getByRole('link', { name: /Back to the queue/ })).toBeVisible();
  }

  async expectNotFound(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Ticket not found.' })).toBeVisible();
  }

  async changeStatus(ticketNumber: string, status: TicketStatus): Promise<void> {
    await this.page.getByLabel(`Status for ${ticketNumber}`).selectOption(status);
  }

  async changePriority(ticketNumber: string, priority: TicketPriority): Promise<void> {
    await this.page.getByLabel(`Priority for ${ticketNumber}`).selectOption(priority);
  }

  async expectStatus(ticketNumber: string, status: TicketStatus): Promise<void> {
    await expect(this.page.getByLabel(`Status for ${ticketNumber}`)).toHaveValue(status);
  }

  async expectActivityVisible(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: 'Ticket Activity Timeline' })
    ).toBeVisible();
  }

  private comments() {
    return this.page.getByTestId('comment');
  }

  async expectCommentCount(count: number): Promise<void> {
    await expect(this.comments()).toHaveCount(count);
  }

  async expectComment(text: string): Promise<void> {
    await expect(this.comments().filter({ hasText: text })).toBeVisible();
  }

  async expectNoComment(text: string): Promise<void> {
    await expect(this.comments().filter({ hasText: text })).toHaveCount(0);
  }

  async expectInternalNote(text: string): Promise<void> {
    await expect(this.comments().filter({ hasText: text })).toContainText('Internal note');
  }

  // A requester's form has no visibility choice at all.
  async expectNoInternalOption(): Promise<void> {
    await expect(this.page.getByLabel('Internal note (staff only)')).toHaveCount(0);
  }

  async postComment(text: string, { internal = false } = {}): Promise<void> {
    await this.page.getByTestId('comment-body').fill(text);
    if (internal) await this.page.getByLabel('Internal note (staff only)').check();
    await this.page.getByRole('button', { name: internal ? 'Add note' : 'Post comment' }).click();
  }

  async backToQueue(): Promise<void> {
    await this.page.getByRole('link', { name: /Back to the queue/ }).click();
  }
}
