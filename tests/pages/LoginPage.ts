import { expect, type Page } from '@playwright/test';
import type { UserRole } from '../test-data/types';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }

  async loginAs(role: UserRole): Promise<void> {
    await this.goto();
    await this.page.getByTestId(`demo-login-${role}`).click();
  }

  async logout(): Promise<void> {
    await this.page.getByRole('button', { name: 'Sign out' }).click();
  }

  async expectSignedInUser(name: string): Promise<void> {
    await expect(this.page.locator('.session-card strong')).toHaveText(name);
  }

  async expectLoginError(message: string): Promise<void> {
    await expect(this.page.getByText(message, { exact: true })).toBeVisible();
  }

  async expectSignedOut(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: 'Sign in to open the service desk.' })
    ).toBeVisible();
  }
}
