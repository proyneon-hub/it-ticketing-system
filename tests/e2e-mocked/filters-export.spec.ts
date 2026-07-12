import { expect, test } from '../fixtures/app.fixture';
import { readDownloadText } from '../utils/downloads';

test(
  'FILTER-001 search returns a matching ticket and FILTER-002 shows an empty state',
  { tag: ['@regression', '@ticket'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.search('Wi-Fi');
    await dashboardPage.expectTicketVisible('TKT-0001');

    await dashboardPage.search('does-not-exist');
    await dashboardPage.expectEmptyState();
  }
);

test(
  'FILTER-003 status filter shows only matching tickets',
  { tag: ['@regression', '@ticket'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.filterByStatus('assigned');

    await dashboardPage.expectTicketVisible('TKT-0002');
    await dashboardPage.expectTicketHidden('TKT-0001');
  }
);

test(
  'FILTER-004 priority filter shows only matching tickets',
  { tag: ['@regression', '@ticket'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.filterByPriority('urgent');

    await dashboardPage.expectTicketVisible('TKT-0002');
    await dashboardPage.expectTicketHidden('TKT-0001');
  }
);

test(
  'EXPORT-002 requester export contains only visible records',
  { tag: ['@regression', '@requester', '@export'] },
  async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAs('user');
    const download = await dashboardPage.exportCsv();
    const content = await readDownloadText(download);

    expect(content).toContain('TKT-0002');
    expect(content).not.toContain('TKT-0001');
  }
);
