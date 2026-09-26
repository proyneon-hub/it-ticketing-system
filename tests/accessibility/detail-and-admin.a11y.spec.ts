import { PROPOSAL_TICKET_ID, REPLY } from '../e2e-mocked/agentSupport';
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

test(
  'the agent’s drafted reply panel has no serious or critical Axe violations',
  { tag: ['@a11y'] },
  async ({ page, loginPage, detailPage, agentApi: _agentApi, agentPage }) => {
    await loginPage.loginAs('technician');
    await page.goto(`/tickets/${PROPOSAL_TICKET_ID}`);
    await detailPage.expectLoaded('TKT-0003');
    await agentPage.expectProposalShown(REPLY);

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);

test(
  'the panel has no serious or critical Axe violations while a rejection is being written, and after a decision',
  { tag: ['@a11y'] },
  async ({ page, loginPage, detailPage, agentApi: _agentApi, agentPage }) => {
    await loginPage.loginAs('technician');
    await page.goto(`/tickets/${PROPOSAL_TICKET_ID}`);
    await detailPage.expectLoaded('TKT-0003');

    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByLabel(/Why\?/)).toBeVisible();
    expect(await scanForSeriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await agentPage.approve();
    await agentPage.expectAiComment(REPLY);
    expect(await scanForSeriousViolations(page)).toEqual([]);
  }
);

test(
  'the agent admin page has no serious or critical Axe violations, with a run open',
  { tag: ['@a11y'] },
  async ({ page, loginPage, dashboardPage, agentApi: _agentApi, agentPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectLoaded();
    await agentPage.gotoAdmin();
    await page.getByRole('button', { name: 'Details of the run for TKT-0003' }).click();
    await expect(page.getByRole('region', { name: 'Run details' })).toBeVisible();

    const violations = await scanForSeriousViolations(page);

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
);
