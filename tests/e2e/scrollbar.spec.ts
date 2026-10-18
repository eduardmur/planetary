// With a classic scrollbar (Windows, most Linux setups), opening "?" stops the page scrolling but
// keeps the scrollbar's gutter: nothing behind the dialog moves.

import { expect, test } from '@playwright/test';

// Chromium with classic scrollbars that take their width, as on Windows.
test.use({
  launchOptions: {
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-features=OverlayScrollbar'],
  },
});

test('opening "?" moves nothing behind the dialog', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'classic scrollbars: desktop Chromium');
  await page.setViewportSize({ width: 1366, height: 625 });
  await page.goto('saturn/');
  await expect.poll(() => page.locator('#view-a path[d]:not([d=""])').count()).toBeGreaterThan(8);
  await page.waitForTimeout(300);
  const state = () =>
    page.evaluate(() => ({
      table: document.querySelector('table.main')!.getBoundingClientRect().left,
      views: document.querySelector('.views')!.getBoundingClientRect().right,
      viewBox: document.getElementById('view-a')!.getAttribute('viewBox'),
      bar: innerWidth - document.documentElement.clientWidth,
    }));
  const before = await state();
  expect(before.bar).toBeGreaterThan(0);
  await page.locator('button.info').click();
  await expect(page.locator('dialog#info')).toBeVisible();
  await page.waitForTimeout(300);
  const after = await state();
  expect(Math.abs(after.table - before.table)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.views - before.views)).toBeLessThanOrEqual(0.5);
  expect(after.viewBox).toBe(before.viewBox);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog#info')).toBeHidden();
});
