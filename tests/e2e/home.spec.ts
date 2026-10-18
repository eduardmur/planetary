// The home page: a moving schematic whose bodies are links. Pointing at one names it and stops the
// clock; a click, a tap or Enter opens its page; on a phone a tap among several opens a chooser.

import { expect, test, type Page } from '@playwright/test';

/** The hooks the view exposes as window.__pb.views.orrery. */
type Hooks = {
  __pb: {
    views: {
      orrery: {
        simDate: string;
        active: string | null;
        setDate(iso: string): void;
        positions(): Record<string, [number, number]>;
        glyphRadii(): Record<string, number>;
      };
    };
  };
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

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

test('the home page draws the schematic and nothing else', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('');
  await expect.poll(() => page.locator('#orrery path[d]:not([d=""])').count()).toBeGreaterThan(8);
  await expect(page.locator('#orrery g.body')).toHaveCount(9);
  await expect(page.locator('#orrery [data-ref="moon"]')).toHaveCount(1);
  await expect(page.locator('nav.bodies a[data-body]')).toHaveCount(10);
  await expect(page.locator('tr[data-key], table')).toHaveCount(0);
  // No name is lettered until a body is pointed at.
  await expect(page.locator('#orrery .layer-text-l path[d]:not([d=""])')).toHaveCount(0);
  await expect(page.locator('#clock')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  const radii = await page.evaluate(() =>
    Object.values((window as unknown as Hooks).__pb.views.orrery.glyphRadii()),
  );
  expect(radii).toHaveLength(9);
  for (const r of radii) expect(r).toBeGreaterThanOrEqual(3);
  const [sw, iw, sh, ih] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
    document.documentElement.scrollHeight,
    window.innerHeight,
  ]);
  expect(sw).toBeLessThanOrEqual(iw);
  expect(sh).toBeLessThanOrEqual(ih);
  expect(errors).toEqual([]);
});

test('the clock runs at 1 minute = 1 year', async ({ page }) => {
  await page.goto('');
  await page.waitForTimeout(600);
  const a = await simDate(page);
  await page.waitForTimeout(1000);
  const b = await simDate(page);
  // 365.25 days a minute is 6.09 days a second (frames are not exactly on time).
  expect(days(a, b)).toBeGreaterThan(3);
  expect(days(a, b)).toBeLessThan(9);
});

test('the links over the bodies never overlap', async ({ page }) => {
  await page.goto('');
  for (const date of ['2026-10-18', '2030-03-01', '2035-07-15', '2041-01-01', '2052-09-30']) {
    const circles = await page.evaluate((date) => {
      (window as unknown as Hooks).__pb.views.orrery.setDate(date);
      return [
        ...document.querySelectorAll<HTMLElement>('nav.bodies a:not([data-body="moon"])'),
      ].map((a) => {
        const r = a.getBoundingClientRect();
        return { id: a.dataset.body, x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 };
      });
    }, date);
    for (const a of circles)
      for (const b of circles)
        if (a.id !== b.id)
          expect(
            Math.hypot(a.x - b.x, a.y - b.y),
            `${a.id}/${b.id} ${date}`,
          ).toBeGreaterThanOrEqual(a.r + b.r - 0.5);
  }
});

test('pointing at a body names it and stops the clock until the mouse leaves', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'mouse');
  await page.goto('');
  const p = await at(page, 'jupiter');
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('#orrery')).toHaveAttribute('data-active', 'jupiter');
  expect(await page.evaluate(() => (window as unknown as Hooks).__pb.views.orrery.active)).toBe(
    'jupiter',
  );
  await expect(page.locator('#orrery [data-ref="jupiter"].hot').first()).toBeAttached();
  await expect
    .poll(() => page.locator('#orrery .layer-text-l path[d]:not([d=""])').count())
    .toBeGreaterThan(0);
  await expect(page.locator(':popover-open, dialog[open]')).toHaveCount(0);
  // Stopped (it eases to a stop in 250 ms).
  await page.waitForTimeout(400);
  const a = await simDate(page);
  await page.waitForTimeout(500);
  expect(await simDate(page)).toBe(a);
  // Going again once the mouse leaves.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(800);
  expect(days(a, await simDate(page))).toBeGreaterThan(0);
  await expect(page.locator('#orrery')).not.toHaveAttribute('data-active');
  await expect(page.locator('#orrery [data-ref].hot')).toHaveCount(0);
  await expect(page.locator('#orrery .layer-text-l path[d]:not([d=""])')).toHaveCount(0);
});

test('a click on a planet or on the Moon’s ring opens its page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse');
  await page.goto('');
  const p = await at(page, 'jupiter');
  await page.mouse.click(p.x, p.y);
  await expect(page).toHaveURL(/\/jupiter\/$/);

  await page.goto('?capture&date=2026-10-18');
  // A point of the Moon's ring that no planet's link covers.
  const ring = await page.evaluate(() => {
    const moon = document.querySelector('a[data-body="moon"]')!;
    const b = moon.getBoundingClientRect();
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * 2 * Math.PI;
      const x = b.x + b.width / 2 + Math.cos(t) * b.width * 0.4,
        y = b.y + b.height / 2 + Math.sin(t) * b.height * 0.4;
      if (document.elementFromPoint(x, y)?.closest('a') === moon) return { x, y };
    }
    return null;
  });
  expect(ring).not.toBeNull();
  await page.mouse.move(ring!.x, ring!.y);
  await expect(page.locator('#orrery')).toHaveAttribute('data-active', 'moon');
  await expect(page.locator('#orrery [data-ref="moon"]')).toHaveClass(/hot/);
  await page.mouse.click(ring!.x, ring!.y);
  await expect(page).toHaveURL(/\/moon\/$/);
});

test('the keyboard reaches "?", the ten bodies and Pause, in that order', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(isMobile, 'keyboard');
  await page.goto('');
  // Safari moves to links with Option-Tab.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(tab);
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return el.dataset.body || el.id || el.className;
      }),
    );
  }
  expect(order).toEqual([
    'info',
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
    'pause',
  ]);
  // Focus names a body; Enter opens it.
  await page.locator('a[data-body="earth"]').focus();
  await page.keyboard.press('Shift+' + tab);
  await page.keyboard.press(tab);
  await expect(page.locator('#orrery')).toHaveAttribute('data-active', 'earth');
  await expect
    .poll(() => page.locator('#orrery .layer-text-l path[d]:not([d=""])').count())
    .toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/earth\/$/);
});

test('a tap among several bodies opens a chooser; a tap on one opens its page', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'touch');
  await page.goto('');
  await page.evaluate(() => (window as unknown as Hooks).__pb.views.orrery.setDate('2026-10-18'));
  const chooser = page.locator('.chooser:popover-open');
  // A tap that reaches no body does nothing.
  const box = (await page.locator('#orrery').boundingBox())!;
  await page.touchscreen.tap(box.x + 4, box.y + 4);
  await page.waitForTimeout(300);
  await expect(chooser).toHaveCount(0);
  await expect(page).toHaveURL(/\/planetary\/$/);
  const earth = await at(page, 'earth');
  await page.touchscreen.tap(earth.x, earth.y);
  await expect(chooser).toBeVisible();
  const links = chooser.locator('a');
  expect(await links.count()).toBeGreaterThanOrEqual(2);
  await expect(links.filter({ hasText: 'Earth' })).toHaveCount(1);
  await expect(links.filter({ hasText: 'Moon' })).toHaveCount(1);
  for (const a of await links.all())
    expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The candidates light up and the clock stands while it is open.
  await expect(page.locator('#orrery [data-ref="earth"].hot').first()).toBeAttached();
  await expect(page.locator('#orrery [data-ref="moon"].hot')).toHaveCount(1);
  await page.waitForTimeout(400);
  const a = await simDate(page);
  await page.waitForTimeout(400);
  expect(await simDate(page)).toBe(a);
  await links.filter({ hasText: 'Earth' }).tap();
  await expect(page).toHaveURL(/\/earth\/$/);

  await page.goto('');
  await page.evaluate(() => (window as unknown as Hooks).__pb.views.orrery.setDate('2026-10-18'));
  const jupiter = await at(page, 'jupiter');
  await page.touchscreen.tap(jupiter.x, jupiter.y);
  await expect(page).toHaveURL(/\/jupiter\/$/);
});

test('with reduced motion the clock starts paused at today; Play and Pause work', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('');
  const pause = page.locator('#pause');
  await expect(pause).toHaveText('Play');
  await expect(pause).toHaveAttribute('data-paused', 'true');
  const today = new Date().toISOString().slice(0, 10);
  expect(await simDate(page)).toBe(`${today}T00:00:00.000Z`);
  await page.waitForTimeout(500);
  expect(await simDate(page)).toBe(`${today}T00:00:00.000Z`);
  await pause.click();
  await expect(pause).toHaveText('Pause');
  await page.waitForTimeout(700);
  const a = await simDate(page);
  expect(days(`${today}T00:00:00.000Z`, a)).toBeGreaterThan(0);
  // Pause stops it at once.
  await pause.click();
  await expect(pause).toHaveText('Play');
  const b = await simDate(page);
  await page.waitForTimeout(500);
  expect(await simDate(page)).toBe(b);
});

test('?capture&date= holds the drawing at that date', async ({ page }) => {
  await page.goto('?capture&date=2026-10-18');
  await expect(page.locator('#clock')).toHaveText('2026-10-18');
  await page.waitForTimeout(400);
  expect(await simDate(page)).toBe('2026-10-18T00:00:00.000Z');
});

test('"?" opens the notes; Esc and a click outside close them', async ({ page, isMobile }) => {
  await page.goto('');
  const info = page.locator('button.info');
  const dialog = page.locator('dialog#info');
  // From the keyboard, so that focus has somewhere to return to (Safari does not focus a clicked
  // button).
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#info-title')).toBeFocused();
  await expect(dialog).toContainText('Unofficial');
  await expect(dialog).toContainText('(r / 7375.9)^0.4');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(info).toBeFocused();
  if (isMobile) return; // full screen on phones: there is no outside
  await info.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
});
