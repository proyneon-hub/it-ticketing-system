import { expect, test } from '../fixtures/app.fixture';

test.describe('the agent’s admin page', () => {
  test('shows the agent as running, what it has spent, and its runs', async ({
    page,
    loginPage,
    dashboardPage,
    agentPage,
    agentApi,
  }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await agentPage.gotoAdmin();

    await expect(page.getByText('The agent is running.')).toBeVisible();
    await expect(page.getByText('On in this deployment, using claude-sonnet-5.')).toBeVisible();
    await expect(page.getByText('$0.0234')).toBeVisible();
    await expect(page.getByTestId('agent-run-row')).toHaveCount(2);
    await expect(page.getByText('Requester Rate Limited')).toBeVisible();
    expect(agentApi.requests).toEqual([]);
  });

  test('the kill switch stops the agent at once, and resumes it', async ({
    page,
    loginPage,
    dashboardPage,
    agentPage,
    agentApi,
  }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await agentPage.gotoAdmin();

    await page.getByRole('button', { name: 'Stop the agent' }).click();
    await expect(page.getByText('The agent is stopped.', { exact: true })).toBeVisible();
    expect(agentApi.settings.killSwitch).toBe(true);

    await page.getByRole('button', { name: 'Resume the agent' }).click();
    await expect(page.getByText('The agent is running.')).toBeVisible();
    expect(agentApi.settings.killSwitch).toBe(false);
  });

  test('changes the mode, a category, and the limits, and says they were saved', async ({
    page,
    loginPage,
    dashboardPage,
    agentPage,
    agentApi,
  }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await agentPage.gotoAdmin();

    await page.getByLabel('Default mode').selectOption('shadow');
    await page.getByLabel('Mode for Security').selectOption('off');
    await page.getByLabel('Daily cost cap (US dollars)').fill('0.5');
    await page.getByLabel('Runs per requester per hour').fill('2');
    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect(page.getByText('Agent settings saved.')).toBeVisible();
    expect(agentApi.settings).toMatchObject({
      defaultMode: 'shadow',
      modeByCategory: { Security: 'off' },
      dailyCostCapUsd: 0.5,
      perRequesterHourlyLimit: 2,
    });
  });

  test('opens a run to show its reply and steps, and filters by outcome', async ({
    page,
    loginPage,
    dashboardPage,
    agentPage,
    agentApi: _agentApi,
  }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await agentPage.gotoAdmin();

    await page.getByRole('button', { name: 'Details of the run for TKT-0003' }).click();
    const details = page.getByRole('region', { name: 'Run details' });
    await expect(details.getByText('search_kb')).toBeVisible();
    await expect(details.getByText('cites KB-006; confidence high')).toBeVisible();
    await details.getByRole('button', { name: 'Close' }).click();
    await expect(details).toHaveCount(0);

    await page.getByLabel('Filter runs by outcome').selectOption('aborted');
    await expect(page.getByTestId('agent-run-row')).toHaveCount(1);
  });

  test('is not for a technician: no link, and the address is refused', async ({
    page,
    loginPage,
    dashboardPage,
    adminPage,
  }) => {
    await loginPage.loginAs('technician');
    await dashboardPage.expectLoaded();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Agent' })
    ).toHaveCount(0);

    await page.goto('/admin/agent');
    await adminPage.expectAccessDenied();
  });
});
