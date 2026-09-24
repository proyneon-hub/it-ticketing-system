import { expect, test } from '@playwright/test';
import { liveSmokeDisabledReason, liveSmokeEnabled } from './live-smoke';

test.skip(!liveSmokeEnabled, liveSmokeDisabledReason);

test(
  'LIVE-DOCS-001 interactive API docs render under the Content-Security-Policy',
  { tag: ['@smoke'] },
  async ({ page }) => {
    const cspViolations: string[] = [];
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) cspViolations.push(message.text());
    });

    // Without a trailing slash: that is the URL the README links to, and on Vercel
    // the only form that reaches the function.
    await page.goto('/api/docs');

    await expect(page).toHaveURL(/\/api\/docs$/);
    await expect(page.getByRole('heading', { name: /IT Ticketing System API/ })).toBeVisible();
    await expect(page.getByText('List tickets', { exact: true })).toBeVisible();
    expect(cspViolations).toEqual([]);
  }
);
