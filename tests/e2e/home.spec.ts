// The home page: loads without errors, links every body, never scrolls sideways.

import { expect, test } from '@playwright/test';

test('the home page loads and links the ten bodies', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('');
  await expect(page.locator('nav.bodies a[data-body]')).toHaveCount(10);
  const [sw, iw] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(sw).toBeLessThanOrEqual(iw);
  expect(errors).toEqual([]);
});
