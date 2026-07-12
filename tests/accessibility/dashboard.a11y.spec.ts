import { expect, test } from '../fixtures/app.fixture';
import { scanForSeriousViolations } from '../utils/accessibility';

test(
  'dashboard has no serious or critical Axe violations',
  { tag: ['@a11y'] },
  async ({ page, loginPage, dashboardPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);
