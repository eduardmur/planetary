// Body pages on screens the four projects do not cover: big phones on their side, small phones and
// zoomed windows in landscape, and tablets. Each runs once per engine, from that engine's desktop
// project, with the device's own screen.

import { devices, expect, test, type Page, type TestInfo } from '@playwright/test';

const BODIES = [
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];
type Rect = { left: number; top: number; right: number; bottom: number; height: number };
const rect = (page: Page, sel: string): Promise<Rect> =>
  page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height };
  });
const drawn = (page: Page) =>
  expect.poll(() => page.locator('#view-a path[d]:not([d=""])').count()).toBeGreaterThan(8);
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let last = -1;
        const check = () => {
          if (scrollY === last) return done();
          last = scrollY;
          setTimeout(check, 150);
        };
        check();
      }),
  );
const show = (page: Page, key: string | null) =>
  page.evaluate(
    (k) => (window as unknown as { __pb: { show(k: string | null): void } }).__pb.show(k),
    key,
  );
/** The screen of a device, without its browser (which the project sets). */
const screen = (name: string) => {
  const d = devices[name]!;
  return {
    viewport: d.viewport,
    deviceScaleFactor: d.deviceScaleFactor,
    isMobile: d.isMobile,
    hasTouch: d.hasTouch,
    userAgent: d.userAgent,
  };
};
const only = (info: TestInfo, engine: 'chromium' | 'webkit') =>
  test.skip(
    info.project.name !== (engine === 'chromium' ? 'desktop' : 'desktop-webkit'),
    `once, in ${engine}`,
  );

/** Big phones on their side are wider than 860 px but short: the phone layout, all of it on screen. */
const onTheirSide = async (page: Page) => {
  await page.goto('uranus/');
  await drawn(page);
  const vh = await page.evaluate(() => innerHeight);
  expect((await rect(page, '.views')).bottom).toBeLessThanOrEqual(vh);
  const pause = await rect(page, '#pause');
  expect(pause.top).toBeGreaterThanOrEqual(0);
  expect(pause.bottom).toBeLessThanOrEqual(vh);
  // An orbit row shows the key plan (alone: View A waits off screen), lit, with the way back.
  await page.goto('earth/#perihelion');
  await expect(page.locator('.views')).toHaveClass(/show-plan/);
  await expect(page.locator('#key-plan .ln.hot').first()).toBeInViewport();
  await expect(page.locator('.swap[data-show="a"]')).toBeVisible();
  // A row in the middle of the screen goes to an edge, and its popover gets that whole side.
  await page.goto('uranus/');
  await drawn(page);
  await page.evaluate(() => {
    const r = document.querySelector('tr[data-key="obliquity"]')!.getBoundingClientRect();
    scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
  });
  await show(page, 'obliquity');
  await expect(page.locator('#def-obliquity')).toBeVisible();
  await page.waitForTimeout(200);
  await settled(page);
  const d = page.locator('#def-obliquity');
  const fits = await d.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  if (!fits) expect((await rect(page, '#def-obliquity')).height).toBeGreaterThanOrEqual(240);
};

test.describe('Pixel 7 on its side', () => {
  test.use(screen('Pixel 7 landscape'));
  test('takes the phone layout, and a popover gets a whole side', async ({ page }, info) => {
    only(info, 'chromium');
    await onTheirSide(page);
  });
});

test.describe('iPhone Pro Max on its side', () => {
  test.use({
    viewport: { width: 932, height: 380 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  test('takes the phone layout, and a popover gets a whole side', async ({ page }, info) => {
    only(info, 'webkit');
    await onTheirSide(page);
  });
});

test.describe('iPhone 13 on its side', () => {
  test.use(screen('iPhone 13 landscape'));
  test('a popover gets a whole side', async ({ page }, info) => {
    only(info, 'webkit');
    await page.goto('uranus/');
    await drawn(page);
    await page.evaluate(() => {
      const r = document.querySelector('tr[data-key="obliquity"]')!.getBoundingClientRect();
      scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
    });
    await show(page, 'obliquity');
    await page.waitForTimeout(200);
    await settled(page);
    expect((await rect(page, '#def-obliquity')).height).toBeGreaterThanOrEqual(240);
  });

  test('a popover goes under the header with its row, never over the tabs', async ({
    page,
  }, info) => {
    only(info, 'webkit');
    await page.goto('uranus/');
    await drawn(page);
    await page.locator('#b-mass').tap();
    await expect(page.locator('#def-mass')).toBeVisible();
    await settled(page);
    // A drag scrolls the page (the drawings let vertical swipes through).
    await page.evaluate(() => scrollBy(0, 180));
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const def = document.getElementById('def-mass')!;
      const d = def.getBoundingClientRect();
      const m = /inset\(([\d.]+)px/.exec(getComputedStyle(def).clipPath);
      const head = document.querySelector('.tabs')!.getBoundingClientRect().bottom;
      const over = (el: Element) => {
        const r = el.getBoundingClientRect();
        return def.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      };
      return {
        top: d.top + (m ? parseFloat(m[1]!) : 0),
        head,
        tabs: [...document.querySelectorAll('.tabs a, .tabs button')].some(over),
      };
    });
    expect(res.top).toBeGreaterThanOrEqual(res.head - 0.5);
    expect(res.tabs).toBe(false);
    await page.locator('.tabs a[data-body="neptune"]').tap();
    await expect(page).toHaveURL(/\/neptune\/#mass$/);
  });
});

// Too narrow for the table beside the drawings: the drawings go above it, and nothing scrolls
// sideways (WCAG 1.4.10).
for (const [name, opts] of [
  ['iPhone SE on its side', screen('iPhone SE landscape')],
  ['a window zoomed to 400 %', { viewport: { width: 320, height: 256 } }],
] as const) {
  test.describe(name, () => {
    test.use(opts);
    for (const engine of ['chromium', 'webkit'] as const)
      test(`no page scrolls sideways (${engine})`, async ({ page }, info) => {
        only(info, engine);
        for (const id of BODIES) {
          await page.goto(`${id}/`);
          await drawn(page);
          const fits = () =>
            page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
          expect(await fits(), id).toBe(true);
          await show(page, 'obliquity');
          await expect(page.locator('#def-obliquity')).toBeVisible();
          await page.waitForTimeout(150);
          expect(await page.evaluate(() => scrollX), id).toBe(0);
          expect(await fits(), id).toBe(true);
        }
      });
  });
}

test.describe('iPad mini held upright', () => {
  test.use(screen('iPad Mini'));
  test('the sheet and the dialog keep to a readable width', async ({ page }, info) => {
    only(info, 'webkit');
    await page.goto('uranus/');
    await drawn(page);
    await page.locator('#b-obliquity').tap();
    await expect(page.locator('#def-obliquity')).toBeVisible();
    const d = await rect(page, '#def-obliquity');
    expect(d.right - d.left).toBeLessThanOrEqual(440.5);
    await page.locator('#def-obliquity .close').tap();
    await page.locator('button.info').tap();
    const dialog = await rect(page, 'dialog#info');
    expect(dialog.right - dialog.left).toBeLessThanOrEqual(560.5);
  });
});

test.describe('iPad Pro 11 held upright', () => {
  test.use(screen('iPad Pro 11'));
  test('the docked sheet opens just under its row', async ({ page }, info) => {
    only(info, 'webkit');
    await page.goto('uranus/');
    await drawn(page);
    await page.locator('#b-obliquity').tap();
    await expect(page.locator('#def-obliquity')).toBeVisible();
    await settled(page);
    const [r, s] = [
      await rect(page, 'tr[data-key="obliquity"]'),
      await rect(page, '#def-obliquity'),
    ];
    expect(s.top - r.bottom).toBeGreaterThanOrEqual(0);
    expect(s.top - r.bottom).toBeLessThanOrEqual(12);
  });
});

test.describe('iPad mini on its side', () => {
  test.use(screen('iPad Mini landscape'));
  test('a tap just off Pause still finds it, and keeps the popover', async ({ page }, info) => {
    only(info, 'webkit');
    await page.goto('uranus/');
    await drawn(page);
    await page.locator('#b-obliquity').tap();
    await expect(page.locator('#def-obliquity')).toBeVisible();
    const pause = page.locator('#pause');
    const before = await pause.getAttribute('data-paused');
    const p = await rect(page, '#pause');
    await page.touchscreen.tap((p.left + p.right) / 2, p.top - 6);
    await expect(pause).not.toHaveAttribute('data-paused', before!);
    await expect(page.locator('#def-obliquity')).toBeVisible();
  });
});
