import { expect, type Page } from '@playwright/test';

// The trends page: headline numbers and the opened/resolved chart.
export class TrendsPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Trends' })
      .click();
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Trends' })).toBeVisible();
    await expect(this.page.getByTestId('trend-stats')).toBeVisible();
    await expect(this.chart()).toBeVisible();
  }

  private chart() {
    return this.page.getByRole('group', { name: /Tickets opened and resolved per day/ });
  }

  async chooseRange(days: 7 | 30 | 90): Promise<void> {
    await this.page.getByRole('button', { name: `Last ${days} days` }).click();
  }

  async expectRange(days: 7 | 30 | 90): Promise<void> {
    await expect(this.page.getByRole('button', { name: `Last ${days} days` })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  }

  async expectStat(label: string, value: string): Promise<void> {
    const card = this.page.getByTestId('trend-stats').locator('article', { hasText: label });
    await expect(card).toContainText(value);
  }

  async showTable(): Promise<void> {
    await this.page.getByRole('button', { name: 'Show as table' }).click();
  }

  async expectTableRows(count: number): Promise<void> {
    await expect(this.page.getByRole('table').locator('tbody tr')).toHaveCount(count);
  }

  // Focus the chart and step to the previous day, as a keyboard user would.
  async readDayFromKeyboard(): Promise<void> {
    await this.chart().focus();
    await this.page.keyboard.press('ArrowLeft');
  }

  async expectReadout(): Promise<void> {
    await expect(this.page.getByRole('status').filter({ hasText: 'opened' })).toBeVisible();
  }
}
