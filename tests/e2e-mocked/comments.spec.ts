import { expect, test } from '../fixtures/app.fixture';

const TICKET = '/tickets/665f0f40d5d4f541f8ef1001';
const NOTE = 'Firmware 4.2 is suspect; do not tell the user yet.';

test(
  'COMMENT-001 staff read the whole thread and can post a reply and an internal note',
  { tag: ['@regression', '@comments', '@technician'] },
  async ({ page, loginPage, detailPage }) => {
    await loginPage.loginAs('technician');
    await page.goto(TICKET);
    await detailPage.expectLoaded('TKT-0001');

    await detailPage.expectCommentCount(2);
    await detailPage.expectInternalNote(NOTE);

    await detailPage.postComment('Replacing the access point on Friday.');
    await detailPage.expectComment('Replacing the access point on Friday.');

    await detailPage.postComment('Vendor confirmed the bug.', { internal: true });
    await detailPage.expectInternalNote('Vendor confirmed the bug.');
    await detailPage.expectCommentCount(4);
  }
);

test(
  'COMMENT-002 a requester never sees an internal note, and cannot write one',
  { tag: ['@regression', '@comments', '@requester', '@security'] },
  async ({ page, loginPage, dashboardPage, detailPage }) => {
    // TKT-0002 is the requester's own ticket; the server has an internal note on it too.
    await loginPage.loginAs('user');
    await dashboardPage.expectLoaded();
    await page.getByRole('link', { name: 'TKT-0002' }).click();
    await detailPage.expectLoaded('TKT-0002');

    await detailPage.expectComment('Your account is unlocked; please try again.');
    await detailPage.expectNoComment('stale VPN session');
    await detailPage.expectCommentCount(1);
    await detailPage.expectNoInternalOption();

    await detailPage.postComment('Thanks, it works now.');
    await detailPage.expectComment('Thanks, it works now.');
    await detailPage.expectCommentCount(2);
    await expect(page.getByText('Internal note')).toHaveCount(0);
  }
);

test(
  'COMMENT-003 staff see the internal note on that same ticket',
  { tag: ['@regression', '@comments', '@technician'] },
  async ({ page, loginPage, detailPage }) => {
    await loginPage.loginAs('technician');
    await page.goto('/tickets/665f0f40d5d4f541f8ef1002');
    await detailPage.expectLoaded('TKT-0002');

    await detailPage.expectCommentCount(2);
    await detailPage.expectInternalNote('stale VPN session');
  }
);

test(
  'COMMENT-004 a requester asking for someone else’s ticket gets not found',
  { tag: ['@regression', '@comments', '@security'] },
  async ({ page, loginPage, detailPage }) => {
    await loginPage.loginAs('user');
    await page.goto(TICKET);
    await detailPage.expectNotFound();
  }
);
