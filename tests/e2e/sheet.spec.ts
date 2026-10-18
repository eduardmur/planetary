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

test('dragging View A keeps the selection', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse drag');
  await page.goto('saturn/#obliquity');
  await drawn(page);
  const a = await rect(page.locator('#view-a'));
  const y = (a.top + a.bottom) / 2;
  await page.mouse.move(a.left + 120, y);
  await page.mouse.down();
  await page.mouse.move(a.left + 200, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#def-obliquity')).toBeVisible();
  expect(await hash(page)).toBe('obliquity');
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
});

test('tabs and ← → keep the selected row', async ({ page, isMobile }) => {
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
});

test('phones: a tapped row sits between the sticky drawing and the docked popover', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phones');
  await page.goto('uranus/');
  await drawn(page);
  // The strip scrolls so that this body's tab is in sight.
  const strip = await rect(page.locator('.tabs .strip'));
  const tab = await rect(page.locator('.tabs a[data-body="uranus"]'));
  expect(tab.left).toBeGreaterThanOrEqual(strip.left);
  expect(tab.right).toBeLessThanOrEqual(strip.right);

  await page.locator('#b-obliquity').tap();
  const sheet = page.locator('#def-obliquity');
  await expect(sheet).toBeVisible();
  await settled(page);
  const row = await rect(page.locator('tr[data-key="obliquity"]'));
  const views = await rect(page.locator('.views'));
  const s = await rect(sheet);
  const vh = await page.evaluate(() => innerHeight);
  expect(row.top).toBeGreaterThanOrEqual(views.bottom - 1);
  expect(row.bottom).toBeLessThanOrEqual(s.top);
  expect(vh - s.bottom).toBeLessThanOrEqual(8);
  // The yellow geometry is not covered.
  expect(s.top).toBeGreaterThanOrEqual(views.bottom);
  await expect(page.locator('#view-a [data-ref~="obliquity"].hot').first()).toBeAttached();
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

test('every line belongs to a row (or is Earth’s orbit)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'both drawings at once');
  for (const id of BODIES) {
    await page.goto(`${id}/`);
    await drawn(page);
    const bad = await page.evaluate(async () => {
      const pb = (window as unknown as { __pb: { show(k: string | null): void } }).__pb;
      const rows = [...document.querySelectorAll<HTMLElement>('tr[data-key]')].map(
        (r) => r.dataset.key!,
      );
      const aliases = ['polarRadius', 'coreRadius', 'dipoleTilt', 'dipoleOffset'];
      const ok = new Set([...rows, ...aliases, 'earthOrbit']);
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const out = new Set<string>();
      for (const key of rows) {
        pb.show(key);
        await frame();
        for (const el of document.querySelectorAll('#view-a [data-ref], #key-plan [data-ref]'))
          for (const t of el.getAttribute('data-ref')!.split(' ')) if (!ok.has(t)) out.add(t);
      }
      return [...out];
    });
    expect(bad, id).toEqual([]);
  }
});
