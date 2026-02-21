import { expect, test } from '@playwright/test';

test('web app shell loads', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.locator('body')).toBeVisible();
});
