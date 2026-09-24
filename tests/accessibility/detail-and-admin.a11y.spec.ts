import { expect, test } from '../fixtures/app.fixture';
import { scanForSeriousViolations } from '../utils/accessibility';

test(
  'ticket detail page has no serious or critical Axe violations',
  { tag: ['@a11y'] },
  async ({ page, loginPage, dashboardPage, detailPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await page.getByRole('link', { name: 'TKT-0001' }).click();
    await detailPage.expectLoaded('TKT-0001');

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);

test(
  'admin users page has no serious or critical Axe violations',
  { tag: ['@a11y'] },
  async ({ page, loginPage, dashboardPage, adminPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await adminPage.gotoUsers();
    await adminPage.expectUsersListed(3);

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);

test(
  'audit log page has no serious or critical Axe violations',
  { tag: ['@a11y'] },
  async ({ page, loginPage, dashboardPage, adminPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await adminPage.gotoAuditLog();
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);

test(
  'ticket comments (with an internal note) have no serious or critical Axe violations',
  { tag: ['@a11y'] },
  async ({ page, loginPage, detailPage }) => {
    await loginPage.loginAs('technician');
    await page.goto('/tickets/665f0f40d5d4f541f8ef1001');
    await detailPage.expectLoaded('TKT-0001');
    await detailPage.expectInternalNote('Firmware 4.2 is suspect');

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);

test(
  'trends page has no serious or critical Axe violations, with the table open and a day selected',
  { tag: ['@a11y'] },
  async ({ page, loginPage, dashboardPage, trendsPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await trendsPage.open();
    await trendsPage.expectLoaded();
    await trendsPage.showTable();
    await trendsPage.readDayFromKeyboard();
    await trendsPage.expectReadout();

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);
