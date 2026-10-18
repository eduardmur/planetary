// Back to the home page from a body's page through the back-forward cache: nothing is pointed at, the
// chooser is closed and the clock runs. Chrome replays pointerenter where the mouse clicked, without a
// pointermove, though the mouse has moved on.

import { expect, test, type Page } from '@playwright/test';

type Hooks = {
  __pb: {
    views: {
      orrery: {
        simDate: string;
        setDate(iso: string): void;
        positions(): Record<string, [number, number]>;
      };
    };
  };
  __restored?: number;
};

const simDate = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__pb.views.orrery.simDate);

/** A body's position in the window, px. */
const at = (page: Page, id: string) =>
  page.evaluate((id) => {
    const r = document.getElementById('orrery')!.getBoundingClientRect();
    const [x, y] = (window as unknown as Hooks).__pb.views.orrery.positions()[id]!;
    return { x: r.left + x, y: r.top + y };
  }, id);

// Playwright turns the cache off, and its headless shell never restores from it: run the full
// Chromium build with the switch dropped. (WebKit does not restore under Playwright.) A restore fires
// no load event, so Back waits only for the commit.
test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium restores from the cache');
test.use({
  channel: 'chromium',
  launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
});

test('back from a body’s page, nothing is pointed at and the clock runs', async ({
  page,
  isMobile,
}) => {
  await page.goto('');
  await page.evaluate(() => ((window as unknown as Hooks).__restored = 1));
  if (isMobile) {
    await page.evaluate(() => (window as unknown as Hooks).__pb.views.orrery.setDate('2026-10-18'));
    const earth = await at(page, 'earth');
    await page.touchscreen.tap(earth.x, earth.y);
    await page.locator('.chooser a', { hasText: 'Earth' }).tap();
    await expect(page).toHaveURL(/\/earth\/$/);
  } else {
    const p = await at(page, 'jupiter');
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await expect(page).toHaveURL(/\/jupiter\/$/);
    // Away from every body of the home page.
    await page.mouse.move(5, 450, { steps: 5 });
  }
  await page.goBack({ waitUntil: 'commit' });
  // The same document, so it came back from the cache.
  expect(await page.evaluate(() => (window as unknown as Hooks).__restored)).toBe(1);
  await page.waitForTimeout(600);
  await expect(page.locator('#orrery')).not.toHaveAttribute('data-active');
  await expect(page.locator('#orrery [data-ref].hot')).toHaveCount(0);
  await expect(page.locator(':popover-open')).toHaveCount(0);
  const a = await simDate(page);
  await page.waitForTimeout(800);
  expect(await simDate(page)).not.toBe(a);
  if (isMobile) return;
  // The mouse is pointing again as soon as it moves.
  const p = await at(page, 'saturn');
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await expect(page.locator('#orrery')).toHaveAttribute('data-active', 'saturn');
});
