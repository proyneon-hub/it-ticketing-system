import { expect, Locator, Page } from '@playwright/test';
import { users, UserRole } from '../fixtures/users';

export class DashboardPage {
  readonly ticketRows: Locator;
  readonly createButton: Locator;
  readonly exportButton: Locator;
  readonly deleteButtons: Locator;
  readonly statusSelects: Locator;
  readonly activityButtons: Locator;

  constructor(private readonly page: Page) {
    this.ticketRows = page.getByTestId('ticket-row');
    this.createButton = page.getByTestId('ticket-create-submit');
    this.exportButton = page.getByTestId('ticket-export-button');
    this.deleteButtons = page.getByTestId('ticket-delete-button');
    this.statusSelects = page.getByTestId('ticket-status-select');
    this.activityButtons = page.getByTestId('ticket-activity-toggle');
  }

  async expectSignedInAs(role: UserRole) {
    const session = this.page.locator('.session-card');
    await expect(session.getByText(users[role].name, { exact: true })).toBeVisible();
    await expect(session.getByText(users[role].email, { exact: true })).toBeVisible();
  }

  async expectDashboardLoaded() {
    await expect(this.page.getByRole('heading', { name: 'Ticket Dashboard' })).toBeVisible();
    await expect(this.page.getByText('Total Tickets')).toBeVisible();
  }

  async expectTicketRowsVisible() {
    await expect(this.ticketRows.first()).toBeVisible();
  }

  async expectAdminControlsVisible() {
    await expect(this.deleteButtons.first()).toBeVisible();
  }

  async expectDeleteControlsHidden() {
    await expect(this.deleteButtons).toHaveCount(0);
  }

  async expectWorkflowControlsDisabled() {
    await expect(this.statusSelects.first()).toBeDisabled();
  }

  async expectWorkflowControlsEnabled() {
    await expect(this.statusSelects.first()).toBeEnabled();
  }

  async search(term: string) {
    await this.page.getByTestId('ticket-search').fill(term);
  }

  async openFirstActivityTimeline() {
    await this.activityButtons.first().click();
    await expect(this.page.getByTestId('ticket-activity-row')).toBeVisible();
  }

  async signOut() {
    await this.page.getByTestId('logout-button').click();
  }
}
