import { expect, type Page } from '@playwright/test';
import type { UserRole } from '../test-data/types';

// The admin-only pages: user roles and the audit log.
export class AdminPage {
  constructor(private readonly page: Page) {}

  async gotoUsers(): Promise<void> {
    await this.page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Users' })
      .click();
  }

  async gotoAuditLog(): Promise<void> {
    await this.page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Audit log' })
      .click();
  }

  async expectUsersListed(count: number): Promise<void> {
    await expect(this.page.getByTestId('user-row')).toHaveCount(count);
  }

  async changeRole(email: string, role: UserRole): Promise<void> {
    await this.page.getByLabel(`Role for ${email}`).selectOption(role);
  }

  async expectRole(email: string, role: UserRole): Promise<void> {
    await expect(this.page.getByLabel(`Role for ${email}`)).toHaveValue(role);
  }

  async expectMessage(message: string): Promise<void> {
    await expect(this.page.getByText(message, { exact: true })).toBeVisible();
  }

  async filterAuditByType(label: string): Promise<void> {
    await this.page.getByLabel('Filter by event type').selectOption({ label });
  }

  async expectAuditRows(count: number): Promise<void> {
    await expect(this.page.getByTestId('audit-row')).toHaveCount(count);
  }

  async expectAccessDenied(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: 'You do not have access to this page.' })
    ).toBeVisible();
  }
}
