// Pages crossfade into each other: the opt-in sits in each page's <head>, so every in-app navigation
// runs a view transition, and none throws.

import { expect, test } from '@playwright/test';

test('every navigation between pages crossfades, without errors', async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== 'chromium' || isMobile, 'cross-document view transitions: Chromium');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    addEventListener('pagereveal', (e) => {
      const log = JSON.parse(sessionStorage.getItem('reveals') ?? '[]') as string[];
      const vt = !!(e as Event & { viewTransition?: unknown }).viewTransition;
      log.push(`${location.pathname} ${vt}`);
      sessionStorage.setItem('reveals', JSON.stringify(log));
    });
  });
  await page.goto('saturn/');
  for (let i = 0; i < 4; i++) {
    await page.locator('.tabs a.home').click();
    await page.waitForURL(/\/planetary\/$/);
    await page.goBack();
    await page.waitForURL(/\/saturn\/$/);
    await page.locator('.tabs a[data-body="mars"]').click();
    await page.waitForURL(/\/mars\/$/);
    await page.locator('.tabs a[data-body="saturn"]').click();
    await page.waitForURL(/\/saturn\/$/);
  }
  await page.waitForTimeout(300);
  const reveals = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('reveals') ?? '[]') as string[],
  );
  // The first load is no transition; every navigation after it is.
  expect(reveals.length).toBeGreaterThan(8);
  expect(reveals.slice(1).filter((r) => !r.endsWith(' true'))).toEqual([]);
  expect(errors).toEqual([]);
});
