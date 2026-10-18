// Body pages: every sheet draws without errors; content changes only on a click, a tap or a key, in a
// popover that floats beside its row and never moves the page; the tabs, the arrow keys and deep
// links carry the selected row from body to body.

import { expect, test, type Locator, type Page } from '@playwright/test';

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

type Rect = { left: number; top: number; right: number; bottom: number };
const rect = (l: Locator): Promise<Rect> =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
const open = (page: Page) => page.locator('.def:popover-open');
const drawn = async (page: Page) =>
  expect.poll(() => page.locator('#view-a path[d]:not([d=""])').count()).toBeGreaterThan(8);
/** The hash without its "#". */
const hash = (page: Page) => page.evaluate(() => location.hash.slice(1));
/** Wait until scrolling has come to rest. */
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
type Hooks = {
  __pb: {
    show(k: string | null): void;
    views: { a: { camera: { yaw: number; pitch: number } } };
  };
};
const camera = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as Hooks).__pb.views.a.camera;
    return { yaw: c.yaw, pitch: c.pitch };
  });
const show = (page: Page, key: string | null) =>
  page.evaluate((k) => (window as unknown as Hooks).__pb.show(k), key);
const caption = (page: Page) => page.locator('.view-a .caption');
const outline = (l: Locator) => l.evaluate((el) => getComputedStyle(el).outlineStyle);

for (const id of BODIES) {
  test(`/${id}/ draws, lists NASA's 20 rows and its tabs, and fits the width`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`${id}/`);
    await drawn(page);
    await expect(page.locator('table.main tbody tr[data-key]')).toHaveCount(20);
    await expect(page.locator('.tabs .strip a')).toHaveCount(10);
    await expect(page.locator('.tabs [aria-current="page"]')).toHaveCount(1);
    await expect(page.locator(`.tabs a[data-body="${id}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('.notes, .title-block, #definition')).toHaveCount(0);
    const [sw, iw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(sw).toBeLessThanOrEqual(iw);
    expect(errors).toEqual([]);
  });
}

test('hovering a row changes nothing', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no hover on touch screens');
  await page.goto('saturn/');
  await drawn(page);
  await page.locator('#b-obliquity').hover();
  await page.waitForTimeout(300);
  await expect(page.locator('tr.hot')).toHaveCount(0);
  await expect(open(page)).toHaveCount(0);
  await expect(page.locator('#view-a .hot')).toHaveCount(0);
  expect(await hash(page)).toBe('');
});

test('a click opens the row popover beside the row, without moving anything', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'phones dock the popover at the bottom (see below)');
  await page.goto('saturn/');
  await drawn(page);
  const row = page.locator('tr[data-key="obliquity"]');
  const views = page.locator('.views');
  const before = [await rect(row), await rect(views)];
  await page.locator('#b-obliquity').click();
  const def = page.locator('#def-obliquity');
  await expect(def).toBeVisible();
  await expect(open(page)).toHaveCount(1);
  const after = [await rect(row), await rect(views)];
  for (const [i, r] of after.entries())
    for (const k of ['left', 'top', 'right', 'bottom'] as const)
      expect(Math.abs(r[k] - before[i]![k])).toBeLessThanOrEqual(0.5);
  // Under the row or over it, within the table's column, never over the drawings.
  await page.waitForTimeout(200);
  const [p, r, t, v] = [
    await rect(def),
    await rect(row),
    await rect(page.locator('table.main')),
    after[1]!,
  ];
  expect(Math.min(Math.abs(p.top - r.bottom), Math.abs(p.bottom - r.top))).toBeLessThanOrEqual(6);
  expect(p.left).toBeGreaterThanOrEqual(t.left - 0.5);
  expect(p.right).toBeLessThanOrEqual(t.right + 0.5);
  const overlaps = p.left < v.right && p.right > v.left && p.top < v.bottom && p.bottom > v.top;
  expect(overlaps).toBe(false);
  await expect(row).toHaveClass(/hot/);
  await expect(page.locator('#view-a [data-ref~="obliquity"].hot').first()).toBeAttached();
  expect(await hash(page)).toBe('obliquity');
  await expect(page.locator('#b-obliquity')).toHaveAttribute('aria-expanded', 'true');
});

test("the popover holds NASA's definition, the ratio to Earth and the notes link", async ({
  page,
}) => {
  await page.goto('saturn/#obliquity');
  const def = page.locator('#def-obliquity');
  await expect(def).toBeVisible();
  await expect(def).toContainText('right hand rule');
  await expect(def).toContainText('1.14');
  await expect(def.locator('a[href$="#orbo"]')).toHaveCount(1);
});

test('×, Esc, a second click and blank paper each close it', async ({ page }) => {
  await page.goto('saturn/');
  await drawn(page);
  const button = page.locator('#b-obliquity');
  const closed = async () => {
    await expect(open(page)).toHaveCount(0);
    await expect(page.locator('tr.hot')).toHaveCount(0);
    await expect.poll(() => hash(page)).toBe('');
  };

  await button.click();
  await page.locator('#def-obliquity .close').click();
  await closed();
  await expect(button).toBeFocused();

  await button.click();
  await expect(open(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await closed();
  await expect(button).toBeFocused();

  await button.click();
  await expect(open(page)).toHaveCount(1);
  await button.click();
  await closed();

  await button.click();
  await expect(open(page)).toHaveCount(1);
  const a = await rect(page.locator('#view-a'));
  await page.mouse.click(a.left + 12, a.top + 12);
  await closed();
});

test('Pause and the "?" dialog leave the selection alone', async ({ page }) => {
  await page.goto('saturn/#obliquity');
  await expect(page.locator('#def-obliquity')).toBeVisible();
  await page.locator('#pause').click();
  await page.locator('button.info').click();
  await expect(page.locator('dialog#info')).toBeVisible();
  // Esc closes the dialog only.
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog#info')).toBeHidden();
  await expect(page.locator('#def-obliquity')).toBeVisible();
  expect(await hash(page)).toBe('obliquity');
});

test('dragging View A keeps the selection; its caption says where the view is', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'mouse drag');
  await page.goto('saturn/#obliquity');
  await drawn(page);
  await expect(caption(page)).toHaveText('Tilt true size · orbit plane edge-on');
  const view = page.locator('#view-a');
  const a = await rect(view);
  const y = (a.top + a.bottom) / 2;
  await page.mouse.move(a.left + 120, y);
  await page.mouse.down();
  await page.mouse.move(a.left + 200, y, { steps: 8 });
  await page.mouse.up();
  // No focus ring after a drag; only the keyboard shows one.
  expect(await outline(view)).toBe('none');
  await expect(page.locator('#def-obliquity')).toBeVisible();
  expect(await hash(page)).toBe('obliquity');
  // Turned away from the axis plane: still in the orbit plane, the tilt no longer true size.
  await expect(caption(page)).toHaveText('Orbit plane edge-on');
  const dragged = (await camera(page)).yaw;
  expect(Math.abs(dragged)).toBeGreaterThan(0.1);
  // Home goes back to the view that shows the tilt at true size, as a double-click does.
  await view.focus();
  await page.keyboard.press('Home');
  await expect(caption(page)).toHaveText('Tilt true size · orbit plane edge-on');
  await expect.poll(async () => Math.abs((await camera(page)).yaw)).toBeLessThan(1e-6);
  // ← turns it again; Esc lets go of the row and keeps the reader's turn, back above the plane.
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowLeft');
  await expect(caption(page)).toHaveText('Orbit plane edge-on');
  await page.keyboard.press('Escape');
  await expect(open(page)).toHaveCount(0);
  await expect(caption(page)).toHaveText('20° above the orbit plane');
  await expect.poll(async () => (await camera(page)).pitch).toBeCloseTo((20 * Math.PI) / 180, 3);
  const turned = await camera(page);
  expect(turned.yaw).toBeCloseTo(Math.PI / 4, 1);
  // A drag, then a click on the row's name: the view keeps the dragged turn.
  await page.locator('#b-obliquity').click();
  await expect.poll(async () => (await camera(page)).pitch).toBeCloseTo(0, 3);
  await page.mouse.move(a.left + 120, y);
  await page.mouse.down();
  await page.mouse.move(a.left + 60, y, { steps: 6 });
  await page.mouse.up();
  const yaw = (await camera(page)).yaw;
  await page.locator('#b-obliquity').click();
  await expect(open(page)).toHaveCount(0);
  await expect.poll(async () => (await camera(page)).yaw).toBeCloseTo(yaw, 3);
});

test('a double-click on View A resets it and keeps the open row', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse');
  await page.goto('saturn/');
  await drawn(page);
  await page.locator('#b-diameter').click();
  await expect(page.locator('#def-diameter')).toBeVisible();
  const a = await rect(page.locator('#view-a'));
  const y = (a.top + a.bottom) / 2;
  await page.mouse.move(a.left + 120, y);
  await page.mouse.down();
  await page.mouse.move(a.left + 220, y, { steps: 8 });
  await page.mouse.up();
  expect(Math.abs((await camera(page)).yaw)).toBeGreaterThan(0.1);
  // Blank paper near the corner.
  await page.mouse.dblclick(a.left + 14, a.top + 14);
  await page.waitForTimeout(500);
  await expect(page.locator('#def-diameter')).toBeVisible();
  expect(await hash(page)).toBe('diameter');
  await expect.poll(async () => Math.abs((await camera(page)).yaw)).toBeLessThan(1e-6);
  // A single click on blank paper still lets go of the row.
  await page.mouse.click(a.left + 14, a.top + 14);
  await expect(open(page)).toHaveCount(0);
});

test('phones: a double tap on View A resets it and keeps the open row', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'touch');
  await page.goto('saturn/');
  await drawn(page);
  await page.locator('#b-diameter').tap();
  await expect(page.locator('#def-diameter')).toBeVisible();
  await settled(page);
  // Turned, as a sideways drag leaves it.
  await page.evaluate(() => {
    const a = (window as unknown as Hooks).__pb.views.a as unknown as {
      camera: { orbit(y: number, p: number): void };
      redraw(): void;
    };
    a.camera.orbit(0.6, 0);
    a.redraw();
  });
  const a = await rect(page.locator('#view-a'));
  await page.touchscreen.tap(a.left + 14, a.top + 14);
  await page.touchscreen.tap(a.left + 14, a.top + 14);
  await page.waitForTimeout(500);
  await expect(page.locator('#def-diameter')).toBeVisible();
  expect(await hash(page)).toBe('diameter');
  await expect.poll(async () => Math.abs((await camera(page)).yaw)).toBeLessThan(1e-6);
  // One tap on blank paper still lets go of the row.
  await page.touchscreen.tap(a.left + 14, a.top + 14);
  await expect(open(page)).toHaveCount(0);
});

test('keyboard focus on View A shows the dashed yellow ring', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  await page.goto('saturn/');
  await drawn(page);
  await page.locator('button.info').focus();
  await page.keyboard.press('Tab');
  const view = page.locator('#view-a');
  await expect(view).toBeFocused();
  const ring = await view.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.outlineStyle, s.outlineColor];
  });
  expect(ring).toEqual(['dashed', 'rgb(255, 213, 74)']);
});

test('a click on a drawn line selects its row', async ({ page }) => {
  // Mars: the Ø dimension crosses no other line. View A captures the pointer, so the click reaches
  // the <svg> and the line is found under it.
  await page.goto('mars/');
  await drawn(page);
  const at = await page.locator('#view-a .layer-dim path[data-ref="diameter"]').evaluate((el) => {
    const p = el as SVGPathElement;
    const q = p.getPointAtLength(p.getTotalLength() * 0.45);
    const m = p.getScreenCTM()!;
    return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#def-diameter')).toBeVisible();
  expect(await hash(page)).toBe('diameter');
  // Chromium rings a clicked <svg>: only keyboard focus may show one.
  expect(await outline(page.locator('#view-a'))).toBe('none');
  // The same line again lets go of it.
  await page.mouse.click(at.x, at.y);
  await expect(open(page)).toHaveCount(0);
});

test('details drawn on demand, and what the popovers add', async ({ page }) => {
  const polar = page.locator('#view-a path[data-ref~="polarRadius"]:not([d=""])');
  await page.goto('saturn/');
  await drawn(page);
  await expect(polar).toHaveCount(0);
  await page.locator('#b-diameter').click();
  await expect.poll(() => polar.count()).toBeGreaterThan(0);
  await expect(page.locator('#def-diameter')).toContainText('54,364');

  await page.locator('#b-ringSystem').click();
  await expect(page.locator('#def-ringSystem dl.edges > div')).toHaveCount(8);
  await expect(page.locator('#def-ringSystem')).toContainText('2022-04-19');

  await page.goto('uranus/#magneticField');
  const mag = page.locator('#def-magneticField');
  await expect(mag).toContainText('58.6 degrees');
  await expect(mag).toContainText('Tilt of the dipole axis to the axis of rotation in degrees.');
  await expect(mag).toContainText(
    'The offset distance of the dipole center to the planet center in units of planet radius.',
  );
  await expect(
    page.locator('#view-a [data-ref~="magneticField"]:not([d=""])').first(),
  ).toBeAttached();

  await page.goto('pluto/#orbitalEccentricity');
  await expect(page.locator('#def-orbitalEccentricity .conflict')).toContainText('0.2488');
});

test('keyboard: the table is one Tab stop; arrows move, Enter opens, Esc closes', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(isMobile, 'keyboard');
  await page.goto('saturn/');
  await drawn(page);
  const buttons = page.locator('table.main th button');
  await expect(buttons.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
  await expect(page.locator('table.main th button[tabindex="-1"]')).toHaveCount(19);
  if (browserName === 'chromium') {
    // Tab from Pause enters the table on its first row.
    await page.locator('#pause').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#b-mass')).toBeFocused();
  } else await page.locator('#b-mass').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#b-diameter')).toBeFocused();
  await expect(open(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('#def-diameter')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#def-density')).toBeVisible();
  await expect(page.locator('#b-density')).toBeFocused();
  await expect(open(page)).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(page.locator('#def-magneticField')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(open(page)).toHaveCount(0);
  await expect(page.locator('#b-magneticField')).toBeFocused();
  await expect(page.locator('#b-magneticField')).toHaveAttribute('tabindex', '0');
});

test('deep links: keys, older keys, unknown keys and hash changes', async ({ page }) => {
  await page.goto('uranus/#magneticField');
  await expect(page.locator('#def-magneticField')).toBeVisible();
  await expect(page.locator('tr[data-key="magneticField"]')).toHaveClass(/hot/);

  await page.goto('saturn/#polarRadius');
  await expect(page.locator('#def-diameter')).toBeVisible();
  await expect.poll(() => hash(page)).toBe('diameter');

  // A fresh page: from saturn/ itself this would only change the hash.
  await page.goto('mars/#nothing');
  await drawn(page);
  await expect(open(page)).toHaveCount(0);
  expect(await hash(page)).toBe('nothing');

  await page.evaluate(() => (location.hash = 'aphelion'));
  await expect(page.locator('#def-aphelion')).toBeVisible();
  await expect(open(page)).toHaveCount(1);
  // The script keeps the one selection itself: the popovers are manual once it runs.
  await expect(page.locator('#def-mass[popover="manual"]')).toHaveCount(1);

  // A fragment that is not a row (the skip link's) leaves the open row's key in the address.
  await page.evaluate(() => (location.hash = 'schedule'));
  await expect.poll(() => hash(page)).toBe('aphelion');
  await expect(page.locator('#def-aphelion')).toBeVisible();
  // An older key of the open row is rewritten to its row's key.
  await page.evaluate(() => (location.hash = 'diameter'));
  await expect(page.locator('#def-diameter')).toBeVisible();
  await page.evaluate(() => (location.hash = 'polarRadius'));
  await expect.poll(() => hash(page)).toBe('diameter');
  await expect(page.locator('#def-diameter')).toBeVisible();
});

test('the skip link goes to the table and keeps #key', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  await page.goto('saturn/#obliquity');
  await expect(page.locator('#def-obliquity')).toBeVisible();
  await page.locator('a.skip').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => hash(page)).toBe('obliquity');
  await expect(page.locator('#def-obliquity')).toBeVisible();
  await expect(page.locator('.tabs a[data-body="uranus"]')).toHaveAttribute(
    'href',
    /\/uranus\/#obliquity$/,
  );
});

test('tabs and ← → keep the selected row', async ({ page, isMobile, browserName }) => {
  await page.goto('saturn/#obliquity');
  await expect(page.locator('#def-obliquity')).toBeVisible();
  await expect(page.locator('.tabs a[data-body="uranus"]')).toHaveAttribute(
    'href',
    /\/uranus\/#obliquity$/,
  );
  await page.locator('.tabs a[data-body="uranus"]').click();
  await expect(page).toHaveURL(/\/uranus\/#obliquity$/);
  await expect(page.locator('#def-obliquity')).toBeVisible();
  // The camera is already in the orbit plane: no turn on arrival.
  const pitch = await page.evaluate(
    () =>
      (window as unknown as { __pb: { views: { a: { camera: { pitch: number } } } } }).__pb.views.a
        .camera.pitch,
  );
  expect(Math.abs(pitch)).toBeLessThan(1e-6);
  if (isMobile) return;
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/neptune\/#obliquity$/);
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/\/uranus\/#obliquity$/);
  // Arrows turn View A while it has focus.
  await page.locator('#view-a').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/uranus\/#obliquity$/);
  // From the last body, → wraps to the first.
  await page.goto('pluto/');
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/mercury\/$/);

  // After a click on a row (which leaves focus on its button), → still switches bodies.
  await page.goto('saturn/');
  await drawn(page);
  await page.locator('#b-obliquity').click();
  await expect(page.locator('#def-obliquity')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/uranus\/#obliquity$/);
  await expect(page.locator('#def-obliquity')).toBeVisible();
  // In the popover, arrows stay there.
  await page.locator('#def-obliquity .close').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/uranus\/#obliquity$/);

  // On a tab the keyboard is on, → moves along the strip from that tab; Enter opens it.
  await page.goto('pluto/');
  await drawn(page);
  await page.locator('.tabs a[data-body="moon"]').focus();
  // Safari moves between links with ⌥ Tab.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.locator('.tabs a[data-body="mars"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tabs a[data-body="jupiter"]')).toBeFocused();
  await expect(page).toHaveURL(/\/pluto\/$/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/jupiter\/$/);
});

test('the "?" dialog: notes, sources with dates, the title block', async ({ page }) => {
  await page.goto('saturn/');
  const info = page.locator('button.info');
  await info.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('dialog#info');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#info-title')).toBeFocused();
  await expect(dialog).toContainText('General notes');
  await expect(dialog).toContainText('Sources');
  await expect(dialog).toContainText('2025-03-18');
  await expect(dialog).toContainText('2022-04-19');
  await expect(dialog).toContainText('PL-08 · SHEET 8 / 11');
  await expect(dialog).toContainText('Unofficial');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(info).toBeFocused();
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('View A starts paused and turns at once; Play still works', async ({ page }) => {
    await page.goto('saturn/');
    await drawn(page);
    const pause = page.locator('#pause');
    await expect(pause).toHaveAttribute('data-paused', 'true');
    await page.locator('#b-obliquity').click();
    const pitch = await page.evaluate(
      () =>
        (window as unknown as { __pb: { views: { a: { camera: { pitch: number } } } } }).__pb.views
          .a.camera.pitch,
    );
    expect(Math.abs(pitch)).toBeLessThan(1e-6);
    await pause.click();
    await expect(pause).toHaveAttribute('data-paused', 'false');
  });
});

test.describe('at 1280 × 720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test('all 20 rows fit without scrolling, inside the frame', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop size');
    await page.goto('saturn/');
    await drawn(page);
    const [sh, ih] = await page.evaluate(() => [
      document.documentElement.scrollHeight,
      window.innerHeight,
    ]);
    expect(sh).toBeLessThanOrEqual(ih);
    const last = await rect(page.locator('tr[data-key="magneticField"]'));
    const frame = await rect(page.locator('main.sheet'));
    expect(last.bottom).toBeLessThanOrEqual(frame.bottom);
    // The last row's popover opens above it.
    await page.locator('#b-magneticField').click();
    const p = await rect(page.locator('#def-magneticField'));
    expect(p.bottom).toBeLessThanOrEqual(last.top + 0.5);
  });

  test("a popover that scrolls keeps NASA's link in sight, inside the frame", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop size');
    for (const id of BODIES) {
      await page.goto(`${id}/`);
      await drawn(page);
      for (const key of ['orbitalPeriod', 'ringSystem']) {
        if (!(await page.locator(`#b-${key}`).count())) continue;
        await show(page, key);
        const def = page.locator(`#def-${key}`);
        await expect(def).toBeVisible();
        const [d, a, f] = [
          await rect(def),
          await rect(def.locator('.src a')),
          await rect(page.locator('main.sheet')),
        ];
        expect(a.top, `${id} ${key}`).toBeGreaterThanOrEqual(d.top - 0.5);
        expect(a.bottom, `${id} ${key}`).toBeLessThanOrEqual(d.bottom + 0.5);
        expect(d.bottom, `${id} ${key}`).toBeLessThanOrEqual(f.bottom - 2.5);
      }
    }
    // A popover under its row ends inside the frame.
    await page.goto('pluto/#perihelion');
    await expect(page.locator('#def-perihelion')).toBeVisible();
    const d = await rect(page.locator('#def-perihelion'));
    expect(d.bottom).toBeLessThanOrEqual((await rect(page.locator('main.sheet'))).bottom - 2.5);
  });
});

test.describe('at 1536 × 864', () => {
  test.use({ viewport: { width: 1536, height: 864 } });
  test('popovers end inside the frame, 4 px from their row, and cut no line of text', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop size');
    await page.goto('saturn/');
    await drawn(page);
    await show(page, 'orbitalPeriod');
    const d = await rect(page.locator('#def-orbitalPeriod'));
    expect(d.bottom).toBeLessThanOrEqual((await rect(page.locator('main.sheet'))).bottom - 2.5);
    await show(page, 'mass');
    const m = await rect(page.locator('#def-mass'));
    expect(Math.abs(m.top - (await rect(page.locator('tr[data-key="mass"]'))).bottom)).toBeLessThan(
      6,
    );
    // The far edge of each popover lies on a row's rule (or at the caption, the last row, the
    // legend), never through a line of text.
    for (const key of ['escapeVelocity', 'magneticField', 'meanTemperature', 'diameter']) {
      await show(page, key);
      await page.waitForTimeout(100);
      const off = await page.evaluate((k) => {
        const def = document.getElementById(`def-${k}`)!;
        const d = def.getBoundingClientRect();
        if (def.scrollHeight > def.clientHeight + 1) return 0;
        const far = def.dataset.side === 'above' ? d.top : d.bottom;
        const rows = [...document.querySelectorAll('tr[data-key]')].map((r) =>
          r.getBoundingClientRect(),
        );
        const stops = [
          document.querySelector('table.main caption')!.getBoundingClientRect().top - 3,
          document.querySelector('.steps')!.getBoundingClientRect().bottom,
          ...rows.map((r) => r.top),
          rows.at(-1)!.bottom,
          document.querySelector('.legend')!.getBoundingClientRect().bottom + 3,
        ];
        // Past the legend there is no text left to cut.
        if (far > stops.at(-1)!) return 0;
        return Math.min(...stops.map((s) => Math.abs(s - far)));
      }, key);
      expect(off, key).toBeLessThanOrEqual(0.5);
    }
  });
});

test('phones: a tapped row sits between the sticky drawing and the docked popover', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phones');
  await page.goto('uranus/');
  await drawn(page);
  const vh = await page.evaluate(() => innerHeight);
  // The strip scrolls so that this body's tab is in sight.
  const strip = await rect(page.locator('.tabs .strip'));
  const tab = await rect(page.locator('.tabs a[data-body="uranus"]'));
  expect(tab.left).toBeGreaterThanOrEqual(strip.left);
  expect(tab.right).toBeLessThanOrEqual(strip.right);
  // The first screen says that a row opens NASA's definition.
  expect((await rect(page.locator('.legend'))).bottom).toBeLessThanOrEqual(vh);
  // Nothing open: the table ends at the foot of the screen, with no blank half-screen.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await settled(page);
  expect(vh - (await rect(page.locator('tr[data-key="magneticField"]'))).bottom).toBeLessThan(24);
  await page.evaluate(() => scrollTo(0, 0));
  await settled(page);

  await page.locator('#b-obliquity').tap();
  const sheet = page.locator('#def-obliquity');
  await expect(sheet).toBeVisible();
  await settled(page);
  const row = await rect(page.locator('tr[data-key="obliquity"]'));
  const views = await rect(page.locator('.views'));
  const s = await rect(sheet);
  expect(row.top).toBeGreaterThanOrEqual(views.bottom - 1);
  expect(row.bottom).toBeLessThanOrEqual(s.top);
  // Flush with the foot of the screen: no table shows under it.
  expect(vh - s.bottom).toBeLessThanOrEqual(0.5);
  const foot = await page.evaluate(() => {
    const at = document.elementFromPoint(innerWidth / 2, innerHeight - 2);
    return !!at?.closest('.def');
  });
  expect(foot).toBe(true);
  // The yellow geometry is not covered.
  expect(s.top).toBeGreaterThanOrEqual(views.bottom);
  await expect(page.locator('#view-a [data-ref~="obliquity"].hot').first()).toBeAttached();

  // The last row comes up above its sheet too; closing it moves nothing, and the page then scrolls
  // with the finger.
  await page.locator('#def-obliquity .close').tap();
  await page.locator('#b-magneticField').tap();
  const last = page.locator('tr[data-key="magneticField"]');
  await expect(page.locator('#def-magneticField')).toBeVisible();
  await settled(page);
  const l = await rect(last);
  expect(l.top).toBeGreaterThanOrEqual((await rect(page.locator('.views'))).bottom - 1);
  expect(l.bottom).toBeLessThanOrEqual((await rect(page.locator('#def-magneticField'))).top);
  await page.locator('#def-magneticField .close').tap();
  await expect(open(page)).toHaveCount(0);
  expect(Math.abs((await rect(last)).top - l.top)).toBeLessThanOrEqual(1);
  await page.evaluate(() => scrollBy(0, -40));
  await settled(page);
  expect(Math.abs((await rect(last)).top - l.top - 40)).toBeLessThanOrEqual(1);
});

test('phones: the notes speak of taps, not of a mouse or keys', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phones');
  await page.goto('saturn/');
  await page.locator('button.info').tap();
  const list = page.locator('dialog#info .info-body ul').first();
  await expect(list).toBeVisible();
  const text = await list.evaluate((el) => (el as HTMLElement).innerText);
  expect(text).toContain('double-tap');
  expect(text).not.toContain('double-click');
  expect(text).not.toContain('←');
  expect(text).toContain('Tap a row');
});

test('phones: turning the phone brings the tab and the selected row back into sight', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phones');
  const portrait = { width: 390, height: 664 },
    landscape = { width: 750, height: 342 };
  const tabInStrip = async () => {
    const [s, t] = [
      await rect(page.locator('.tabs .strip')),
      await rect(page.locator('.tabs [aria-current="page"]')),
    ];
    return t.left >= s.left - 0.5 && t.right <= s.right + 0.5;
  };
  const between = async (key: string) => {
    await settled(page);
    const [r, v, s] = [
      await rect(page.locator(`tr[data-key="${key}"]`)),
      await rect(page.locator('.views')),
      await rect(page.locator(`#def-${key}`)),
    ];
    expect(r.top, key).toBeGreaterThanOrEqual(v.bottom - 1);
    expect(r.bottom, key).toBeLessThanOrEqual(s.top + 1);
  };
  await page.setViewportSize(landscape);
  await page.goto('pluto/');
  await drawn(page);
  await page.setViewportSize(portrait);
  await expect.poll(tabInStrip).toBe(true);

  await page.goto('saturn/#obliquity');
  await drawn(page);
  await between('obliquity');
  await page.setViewportSize(landscape);
  await page.waitForTimeout(300);
  await page.setViewportSize(portrait);
  await page.waitForTimeout(300);
  await between('obliquity');

  await page.setViewportSize(landscape);
  await page.goto('saturn/');
  await drawn(page);
  await page.locator('#b-magneticField').tap();
  await expect(page.locator('#def-magneticField')).toBeVisible();
  await settled(page);
  await page.setViewportSize(portrait);
  await page.waitForTimeout(300);
  await between('magneticField');
});

test('the row stepper walks the rows without moving the pointer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse');
  await page.goto('saturn/');
  await drawn(page);
  const steps = page.locator('.steps');
  await expect(steps).toBeHidden();
  const before = await rect(page.locator('tr[data-key="mass"]'));
  await page.locator('#b-mass').click();
  await expect(steps).toBeVisible();
  // Showing it moves nothing.
  expect(await rect(page.locator('tr[data-key="mass"]'))).toEqual(before);
  await expect(page.locator('.step[data-step="-1"]')).toHaveAttribute('aria-disabled', 'true');
  const next = page.locator('.step[data-step="1"]');
  await next.hover();
  for (let i = 0; i < 19; i++) await page.mouse.down().then(() => page.mouse.up());
  await expect(page.locator('#def-magneticField')).toBeVisible();
  await expect(open(page)).toHaveCount(1);
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  // The address follows within a beat (writes are spaced out for the browsers' rate limits).
  await expect.poll(() => hash(page)).toBe('magneticField');
  // A popover over its row leaves the stepper's line free.
  const [d, s] = [await rect(page.locator('#def-magneticField')), await rect(steps)];
  expect(d.top).toBeGreaterThanOrEqual(s.bottom - 0.5);
  await page.locator('.step[data-step="-1"]').click();
  await expect(page.locator('#def-ringSystem')).toBeVisible();
});

test('a burst of ↓ ↑ keeps the address, the tabs and the popover right', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('saturn/');
  await drawn(page);
  await page.locator('#b-mass').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#def-mass')).toBeVisible();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
  }
  await page.keyboard.press('End');
  await expect(page.locator('#def-magneticField')).toBeVisible();
  await expect.poll(() => hash(page)).toBe('magneticField');
  await expect(page.locator('.tabs a[data-body="uranus"]')).toHaveAttribute(
    'href',
    /\/uranus\/#magneticField$/,
  );
  const [d, r] = [
    await rect(page.locator('#def-magneticField')),
    await rect(page.locator('tr[data-key="magneticField"]')),
  ];
  expect(d.bottom).toBeLessThanOrEqual(r.top + 0.5);
  expect(errors).toEqual([]);
});

test('the tab strip scrolls with the wheel and shows where it hides tabs', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'mouse');
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto('saturn/');
  await drawn(page);
  const nav = page.locator('.tabs nav');
  await expect(nav).toHaveAttribute('data-more', /left|both/);
  await expect(page.locator('.tabs .more[data-dir="-1"]')).toBeVisible();
  const strip = page.locator('.tabs .strip');
  const box = (await strip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => strip.evaluate((s) => s.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(nav).toHaveAttribute('data-more', 'right');
  await expect(page.locator('.tabs a[data-body="mercury"]')).toBeInViewport();
});

test('captions of View A and the key plan share one baseline', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout');
  await page.goto('saturn/');
  await drawn(page);
  const [a, p] = await page.evaluate(() =>
    ['.view-a .caption', '.key-plan .caption'].map((s) => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector(s)!);
      return r.getClientRects()[0]!.bottom;
    }),
  );
  expect(Math.abs(a! - p!)).toBeLessThanOrEqual(0.5);
});

test.describe('in a short window', () => {
  test.use({ viewport: { width: 1280, height: 450 } });
  test('a popover whose row scrolls under the header goes under it too', async ({ page }, info) => {
    test.skip(info.project.name.startsWith('phone'), 'window size');
    await page.goto('saturn/#obliquity');
    await expect(page.locator('#def-obliquity')).toBeVisible();
    await page.waitForTimeout(300);
    await page.evaluate(() => scrollBy(0, 200));
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => {
      const def = document.getElementById('def-obliquity')!;
      const d = def.getBoundingClientRect();
      const m = /inset\(([\d.]+)px/.exec(getComputedStyle(def).clipPath);
      const top = d.top + (m ? parseFloat(m[1]!) : 0);
      const head = document.querySelector('.tabs')!.getBoundingClientRect().bottom;
      const at = (el: Element) => {
        const r = el.getBoundingClientRect();
        return def.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      };
      return {
        top,
        head,
        overInfo: at(document.querySelector('button.info')!),
        overTab: at(document.querySelector('.tabs a[data-body="uranus"]')!),
      };
    });
    expect(res.top).toBeGreaterThanOrEqual(res.head - 0.5);
    expect(res.overInfo).toBe(false);
    expect(res.overTab).toBe(false);
  });
});

test.describe('with forced colours', () => {
  test('the drawings, the selected row, the current tab and the marks stay', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium has forced colours');
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
    await page.goto('saturn/#obliquity');
    await drawn(page);
    const s = await page.evaluate(() => {
      const cs = (q: string) => getComputedStyle(document.querySelector(q)!);
      return {
        paper: cs('html').backgroundColor,
        line: cs('#view-a .ln').stroke,
        row: cs('tr.hot').outlineStyle,
        tab: cs('.tabs [aria-current="page"]').borderBottomStyle,
        mark: cs('.legend .mark').borderLeftStyle,
      };
    });
    expect(s.line).not.toBe(s.paper);
    expect(s.row).toBe('solid');
    expect(s.tab).toBe('solid');
    expect(s.mark).toBe('solid');
  });
});

test('ring radii stay clear of the key plan', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the key plan is not an inset on phones');
  for (const id of ['saturn', 'neptune', 'uranus', 'jupiter']) {
    await page.goto(`${id}/#ringSystem`);
    await expect(page.locator('#view-a [data-ref~="ringSystem"].hot').first()).toBeAttached();
    const overlaps = await page.evaluate(() => {
      const kp = document.querySelector('.key-plan')!.getBoundingClientRect();
      const svg = document.getElementById('view-a')!;
      const at = svg.getBoundingClientRect();
      const out: string[] = [];
      for (const el of svg.querySelectorAll<SVGPathElement>('[class*="layer-text"] path[d]')) {
        if (!el.getAttribute('d')) continue;
        const b = el.getBBox();
        const x0 = at.left + b.x,
          y0 = at.top + b.y;
        if (
          x0 + b.width > kp.left + 1 &&
          y0 + b.height > kp.top + 1 &&
          x0 < kp.right &&
          y0 < kp.bottom
        )
          out.push(el.getAttribute('data-ref') ?? '');
      }
      return out;
    });
    expect(overlaps, id).toEqual([]);
  }
});
