import { expect, test } from '../fixtures/app.fixture';
import { testUsers } from '../test-data/users';

test(
  'ROUTE-001 a signed-out visitor is sent to sign in, then to the page they asked for',
  { tag: ['@regression', '@routing', '@auth'] },
  async ({ page, loginPage, dashboardPage, detailPage }) => {
    await page.goto('/tickets/665f0f40d5d4f541f8ef1001');
    await loginPage.expectSignedOut();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByTestId('demo-login-admin').click();

    await expect(page).toHaveURL(/\/tickets\/665f0f40d5d4f541f8ef1001$/);
    await detailPage.expectLoaded('TKT-0001');
    await dashboardPage.expectSuccess('Signed in as Priya Admin.');
  }
);

test(
  'ROUTE-002 filters live in the address, survive a reload, and can be shared',
  { tag: ['@regression', '@routing'] },
  async ({ page, loginPage, dashboardPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectTicketVisible('TKT-0001');

    await dashboardPage.filterByStatus('assigned');

    await expect(page).toHaveURL(/\/tickets\?status=assigned$/);
    await dashboardPage.expectTicketVisible('TKT-0002');
    await dashboardPage.expectTicketHidden('TKT-0001');

    await page.reload();

    await dashboardPage.expectTicketVisible('TKT-0002');
    await dashboardPage.expectTicketHidden('TKT-0001');
    await expect(page.getByLabel('Filter by status')).toHaveValue('assigned');
  }
);

test(
  'ROUTE-003 an address with nonsense filters falls back to the defaults instead of failing',
  { tag: ['@regression', '@routing', '@error'] },
  async ({ page, loginPage, dashboardPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectTicketVisible('TKT-0001');

    await page.goto('/tickets?status=bogus&sortBy=passwordHash&page=-3');

    await dashboardPage.expectTicketVisible('TKT-0001');
    await expect(page.getByLabel('Filter by status')).toHaveValue('');
  }
);

test(
  'ROUTE-004 a ticket opens on its own page, with the same controls, and links back',
  { tag: ['@regression', '@routing', '@ticket'] },
  async ({ page, loginPage, dashboardPage, detailPage }) => {
    await loginPage.loginAs('technician');
    await dashboardPage.expectTicketVisible('TKT-0001');

    await page.getByRole('link', { name: 'TKT-0001' }).click();

    await expect(page).toHaveURL(/\/tickets\/665f0f40d5d4f541f8ef1001$/);
    await detailPage.expectLoaded('TKT-0001');
    await detailPage.expectActivityVisible();

    await detailPage.changeStatus('TKT-0001', 'in-progress');
    await detailPage.expectStatus('TKT-0001', 'in-progress');
    await dashboardPage.expectSuccess('Ticket updated.');

    await detailPage.backToQueue();
    await expect(page).toHaveURL(/\/tickets$/);
    await dashboardPage.expectTicketVisible('TKT-0001');
  }
);

test(
  'ROUTE-005 a ticket that does not exist says so, with a way back',
  { tag: ['@regression', '@routing', '@error'] },
  async ({ page, loginPage, dashboardPage, detailPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectTicketVisible('TKT-0001');

    await page.goto('/tickets/000000000000000000000000');

    await detailPage.expectNotFound();
  }
);

test(
  'ROUTE-006 a status change appears at once and goes back if the server refuses it',
  { tag: ['@regression', '@routing', '@ticket', '@error'] },
  async ({ page, loginPage, dashboardPage }) => {
    await loginPage.loginAs('technician');
    await dashboardPage.expectTicketVisible('TKT-0001');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Hold the server's answer so the screen can be seen in between.
    await page.route('**/api/tickets/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await held;
      return route.fulfill({
        status: 409,
        json: {
          message: 'This ticket changed since you loaded it. Reload it and try again.',
          code: 'VERSION_CONFLICT',
        },
      });
    });
    const status = page.getByLabel('Status for TKT-0001');

    await status.selectOption('in-progress');
    await expect(status).toHaveValue('in-progress'); // Shown before the server has answered.

    release();

    await dashboardPage.expectError(
      'This ticket changed since you loaded it. Reload it and try again.'
    );
    await expect(status).toHaveValue('open'); // Rolled back to what the server has.
  }
);

test(
  'ROUTE-007 the admin pages are not shown to, or open for, staff who are not admins',
  { tag: ['@regression', '@routing', '@technician'] },
  async ({ page, loginPage, dashboardPage, adminPage }) => {
    await loginPage.loginAs('technician');
    await dashboardPage.expectTicketVisible('TKT-0001');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);

    await page.goto('/admin/users');

    await adminPage.expectAccessDenied();
  }
);

test(
  'ROUTE-008 an admin manages roles, and cannot demote the last admin',
  { tag: ['@regression', '@routing', '@admin'] },
  async ({ loginPage, dashboardPage, adminPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectTicketVisible('TKT-0001');

    await adminPage.gotoUsers();
    await adminPage.expectUsersListed(3);

    await adminPage.changeRole(testUsers.technician.email, 'admin');
    await adminPage.expectMessage('tech@demo.local is now Admin.');
    await adminPage.expectRole(testUsers.technician.email, 'admin');

    // Two admins now; demote one, and the last one is then protected.
    await adminPage.changeRole(testUsers.admin.email, 'technician');
    await adminPage.expectMessage('admin@demo.local is now Technician.');
    await adminPage.changeRole(testUsers.technician.email, 'user');
    await adminPage.expectMessage('There must always be at least one admin.');
    await adminPage.expectRole(testUsers.technician.email, 'admin');
  }
);

test(
  'ROUTE-009 an admin reads the audit log and filters it by event type',
  { tag: ['@regression', '@routing', '@admin'] },
  async ({ loginPage, dashboardPage, adminPage }) => {
    await loginPage.loginAs('admin');
    await dashboardPage.expectTicketVisible('TKT-0001');

    await adminPage.gotoAuditLog();
    await adminPage.expectAuditRows(2);

    await adminPage.filterAuditByType('Role Changed');
    await adminPage.expectAuditRows(1);
  }
);
