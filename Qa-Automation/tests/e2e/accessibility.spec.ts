import { AxeBuilder } from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';

async function expectNoCriticalA11yViolations(pageName: string, page: Page) {
  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
  const critical = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact || '')
  );
  expect(critical, `${pageName} has serious accessibility violations`).toEqual([]);
}

test('login page has no serious accessibility violations', async ({ page }) => {
  const login = new LoginPage(page);

  await login.goto();
  await expectNoCriticalA11yViolations('Login page', page);
});

test('dashboard page has no serious accessibility violations', async ({ page }) => {
  const login = new LoginPage(page);

  await login.loginWithDemoRole('admin');
  await expectNoCriticalA11yViolations('Dashboard page', page);
});
