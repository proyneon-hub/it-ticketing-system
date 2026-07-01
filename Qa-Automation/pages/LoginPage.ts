import { expect, Locator, Page } from '@playwright/test';
import { users, UserRole } from '../fixtures/users';

export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.getByTestId('login-email');
    this.passwordInput = page.getByTestId('login-password');
    this.submitButton = page.getByTestId('login-submit');
  }

  async goto() {
    const initialAuthCheck = this.page
      .waitForResponse((response) => response.url().includes('/api/auth/me'), { timeout: 5_000 })
      .catch(() => null);
    await this.page.goto('/');
    await initialAuthCheck;
  }

  async loginWithDemoRole(role: UserRole) {
    await this.goto();
    await this.page.getByTestId(`demo-login-${role}`).click();
    await expect(this.page.getByText(`Signed in as ${users[role].name}.`)).toBeVisible();
  }

  async loginWithCredentials(email: string, password: string) {
    await this.goto();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectLoginFormVisible() {
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }
}
