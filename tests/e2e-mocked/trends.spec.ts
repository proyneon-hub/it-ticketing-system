import { expect, test } from '../fixtures/app.fixture';

test(
  'TREND-001 an admin opens the trends page from the navigation and sees the numbers and chart',
  { tag: ['@regression', '@trends', '@admin'] },
  async ({ loginPage, dashboardPage, trendsPage, page }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();

    await trendsPage.open();

    await expect(page).toHaveURL(/\/trends$/);
    await trendsPage.expectLoaded();
    await trendsPage.expectRange(30);
    await trendsPage.expectStat('Mean time to resolve', '18.5 h');
    await trendsPage.expectStat('SLA met', '50%');
  }
);

test(
  'TREND-002 the date range changes what is shown, and the numbers are also a table',
  { tag: ['@regression', '@trends'] },
  async ({ loginPage, dashboardPage, trendsPage }) => {
    await loginPage.loginAs('technician');
    await dashboardPage.expectLoaded();
    await trendsPage.open();
    await trendsPage.expectLoaded();

    await trendsPage.chooseRange(7);
    await trendsPage.expectRange(7);
    await trendsPage.showTable();
    await trendsPage.expectTableRows(7);

    await trendsPage.chooseRange(90);
    await trendsPage.expectRange(90);
    await trendsPage.expectTableRows(90);
  }
);

test(
  'TREND-003 the chart can be read from the keyboard',
  { tag: ['@regression', '@trends', '@a11y'] },
  async ({ loginPage, dashboardPage, trendsPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await trendsPage.open();
    await trendsPage.expectLoaded();

    await trendsPage.readDayFromKeyboard();

    await trendsPage.expectReadout();
  }
);

test(
  'TREND-004 requesters have no trends link and are told the page is not for them',
  { tag: ['@regression', '@trends', '@requester', '@security'] },
  async ({ loginPage, dashboardPage, page }) => {
    await loginPage.loginAs('user');
    await dashboardPage.expectLoaded();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Trends' })
    ).toHaveCount(0);

    await page.goto('/trends');

    await expect(page.getByText('You do not have access to this page.')).toBeVisible();
  }
);
