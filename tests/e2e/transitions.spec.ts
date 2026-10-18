// Pages crossfade into each other: the opt-in sits in each page's <head>, so every in-app navigation
// runs a view transition, and none throws. Back and Forward skip it, so that a tap right after them
// is not lost on the picture of the old page.

import { expect, test } from '@playwright/test';

test('every link between pages crossfades, Back does not, without errors', async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== 'chromium' || isMobile, 'cross-document view transitions: Chromium');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    // Each reveal: its page, and whether its transition ran, was skipped or there was none.
    const write = (i: number, entry: string) => {
      const log = JSON.parse(sessionStorage.getItem('reveals') ?? '[]') as string[];
      log[i] = entry;
      sessionStorage.setItem('reveals', JSON.stringify(log));
    };
    addEventListener('pagereveal', (e) => {
      const vt = (e as Event & { viewTransition?: ViewTransition | null }).viewTransition;
      const i = (JSON.parse(sessionStorage.getItem('reveals') ?? '[]') as string[]).length;
      const at = location.pathname;
      write(i, `${at} ${vt ? 'pending' : 'none'}`);
      vt?.ready.then(
        () => write(i, `${at} ran`),
        () => write(i, `${at} skipped`),
      );
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
  // The first load is no transition; then home (a link), Back to Saturn, Mars and Saturn (links).
  expect(reveals[0]).toBe('/planetary/saturn/ none');
  expect(reveals.slice(1)).toEqual(
    Array(4)
      .fill([
        '/planetary/ ran',
        '/planetary/saturn/ skipped',
        '/planetary/mars/ ran',
        '/planetary/saturn/ ran',
      ])
      .flat(),
  );
  expect(errors).toEqual([]);
});
