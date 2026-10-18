// Pages crossfade into each other: the opt-in sits in each page's <head>, so every in-app navigation
// runs a view transition, and none throws. Back and Forward skip it, so that a tap right after them
// is not lost on the picture of the old page, and that throws nothing either.

import { expect, test } from '@playwright/test';

test('every link between pages crossfades, Back does not, without errors', async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== 'chromium' || isMobile, 'cross-document view transitions: Chromium');
  // Seventeen pages, each waited out.
  test.slow();
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
  // Each page is done with before the next step: its reveal is written down and its crossfade is
  // over, since a click made while it runs lands on the picture of the old page and is lost.
  const done = (url: RegExp) =>
    page.waitForURL(url).then(() =>
      page.waitForFunction(() => {
        const last = (JSON.parse(sessionStorage.getItem('reveals') ?? '[]') as string[]).at(-1);
        return (
          !!last?.startsWith(`${location.pathname} `) &&
          !last.endsWith(' pending') &&
          document
            .getAnimations()
            .every(
              (a) =>
                !(a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
                  '::view-transition',
                ),
            )
        );
      }),
    );
  await page.goto('saturn/');
  await done(/\/saturn\/$/);
  for (let i = 0; i < 4; i++) {
    await page.locator('.tabs a.home').click();
    await done(/\/planetary\/$/);
    await page.goBack();
    await done(/\/saturn\/$/);
    await page.locator('.tabs a[data-body="mars"]').click();
    await done(/\/mars\/$/);
    await page.locator('.tabs a[data-body="saturn"]').click();
    await done(/\/saturn\/$/);
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

// The test above settles each transition's promises itself; here nothing does but the page.
test('Back and Forward skip it without an error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('saturn/');
  for (let i = 0; i < 2; i++) {
    await page.locator('.tabs a[data-body="mars"]').click();
    await page.waitForURL(/\/mars\/$/);
    await page.goBack();
    await page.waitForURL(/\/saturn\/$/);
    await page.goForward();
    await page.waitForURL(/\/mars\/$/);
    await page.goBack();
    await page.waitForURL(/\/saturn\/$/);
  }
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
