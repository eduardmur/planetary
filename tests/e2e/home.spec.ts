// The home page: a moving schematic whose bodies are links. Pointing at one names it and stops the
// clock; a click, a tap or Enter opens its page; on a phone a tap among several opens a chooser.

import { devices, expect, test, type Page } from '@playwright/test';

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
        within(x: number, y: number): string[];
      };
    };
  };
};

/** The nine bodies that have a symbol, in NASA's order. */
const PLANETS = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];

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

/** The links that points of a body's symbol open, where no other symbol covers them. */
const symbolHits = (page: Page, id: string) =>
  page.evaluate((id) => {
    const o = (window as unknown as Hooks).__pb.views.orrery;
    const box = document.getElementById('orrery')!.getBoundingClientRect();
    const pos = o.positions(),
      rad = o.glyphRadii();
    const hits = new Set<string | undefined>();
    for (const f of [0.3, 0.6, 0.9])
      for (let k = 0; k < 16; k++) {
        const t = (k / 16) * 2 * Math.PI;
        const x = pos[id]![0] + Math.cos(t) * f * rad[id]!,
          y = pos[id]![1] + Math.sin(t) * f * rad[id]!;
        const covered = Object.keys(pos).some(
          (j) => j !== id && Math.hypot(x - pos[j]![0], y - pos[j]![1]) < rad[j]! + 0.5,
        );
        if (covered) continue;
        const a = document.elementFromPoint(box.x + x, box.y + y)?.closest<HTMLElement>('a');
        hits.add(a?.dataset.body);
      }
    return [...hits];
  }, id);

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

test('every point of a symbol opens its own body; no two links overlap or shrink under 24 px', async ({
  page,
  isMobile,
}) => {
  await page.goto('?capture&date=2026-10-18');
  // Venus and the Earth close (2026-10-18), Mercury over Venus (2027-04-04), Mercury and the Earth
  // close (2027-06-24), and other dates.
  for (const date of [
    '2026-10-18',
    '2027-04-04',
    '2027-06-24',
    '2030-03-01',
    '2035-07-15',
    '2041-01-01',
    '2052-09-30',
  ]) {
    const r = await page.evaluate((date) => {
      const o = (window as unknown as Hooks).__pb.views.orrery;
      o.setDate(date);
      const box = document.getElementById('orrery')!.getBoundingClientRect();
      const pos = o.positions(),
        rad = o.glyphRadii();
      const ids = Object.keys(pos);
      const wrong: string[] = [];
      let shared = 0;
      for (const id of ids)
        for (const f of [0.3, 0.6, 0.9])
          for (let k = 0; k < 16; k++) {
            const t = (k / 16) * 2 * Math.PI;
            const x = pos[id]![0] + Math.cos(t) * f * rad[id]!,
              y = pos[id]![1] + Math.sin(t) * f * rad[id]!;
            // A point that two symbols cover may go to either.
            if (
              ids.some(
                (j) => j !== id && Math.hypot(x - pos[j]![0], y - pos[j]![1]) < rad[j]! + 0.5,
              )
            )
              continue;
            const els = document.elementsFromPoint(box.x + x, box.y + y);
            if (els[0]?.closest('.corner, button.info')) continue;
            const links = els.map((e) => e.closest<HTMLElement>('a[data-body]')?.dataset.body);
            if (new Set(links.filter((b) => b && b !== 'moon')).size > 1) shared++;
            if (links[0] !== id) wrong.push(`${id} at ${f} r, ${k * 22.5}°: ${links[0]}`);
          }
      const sizes = [
        ...document.querySelectorAll<HTMLElement>('nav.bodies a:not([data-body="moon"])'),
      ].flatMap((a) => [a.offsetWidth, a.offsetHeight]);
      return { wrong, shared, smallest: Math.min(...sizes) };
    }, date);
    expect(r.wrong, date).toEqual([]);
    expect(r.shared, date).toBe(0);
    expect(r.smallest, date).toBeGreaterThanOrEqual(24);
  }
  if (isMobile) return;
  // 1440×900: a click just outside the Earth's symbol, toward the Moon's ring, is still the Earth.
  await page.evaluate(() => (window as unknown as Hooks).__pb.views.orrery.setDate('2026-10-18'));
  const e = await at(page, 'earth');
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x + 11, y)?.closest<HTMLElement>('a[data-body]')?.dataset.body,
      e,
    ),
  ).toBe('earth');
});

test('a link cut where it meets another shows its whole focus ring, under its neighbours', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(isMobile, 'keyboard');
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  // 1440×900 on 2026-10-18: the Earth's link is cut where it meets Venus's.
  await page.goto('?capture&date=2026-10-18');
  const earth = page.locator('a[data-body="earth"]');
  expect(await earth.evaluate((a) => a.style.clipPath)).toMatch(/^polygon/);
  await page.locator('a[data-body="venus"]').focus();
  await page.keyboard.press(tab);
  await expect(earth).toBeFocused();
  expect(await earth.evaluate((a) => getComputedStyle(a).clipPath)).toBe('none');
  // Venus keeps its symbol, and the Moon's link stays under the Earth's.
  expect(await symbolHits(page, 'venus')).toEqual(['venus']);
  expect(await symbolHits(page, 'earth')).toEqual(['earth']);
  // 1280×720 on 2027-04-04, Mercury in front of Venus: with Venus focused, Mercury keeps its symbol.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('?capture&date=2027-04-04');
  await page.locator('a[data-body="mercury"]').focus();
  await page.keyboard.press(tab);
  await expect(page.locator('a[data-body="venus"]')).toBeFocused();
  expect(await symbolHits(page, 'mercury')).toEqual(['mercury']);
});

test('at 2060 the clock goes back to today, fading the bodies out and in', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('');
  const faded = await page.evaluate(async () => {
    const glyphs = document.querySelector('#orrery g.glyphs')!;
    (window as unknown as Hooks).__pb.views.orrery.setDate('2059-12-31');
    for (const t0 = performance.now(); performance.now() - t0 < 2000;) {
      await new Promise(requestAnimationFrame);
      if (glyphs.getAnimations().length) return true;
    }
    return false;
  });
  expect(faded).toBe(true);
  await expect.poll(() => simDate(page), { timeout: 2000 }).toMatch(/^20[2-5]/);
  // Back at today's date, and running from it.
  const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const since = days(today, await simDate(page));
  expect(since).toBeGreaterThanOrEqual(0);
  expect(since).toBeLessThan(10);
  expect(errors).toEqual([]);
});

test('with reduced motion the clock goes back at 2060 at once, without a fade', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('');
  await page.locator('#pause').click(); // Play
  const faded = await page.evaluate(async () => {
    const glyphs = document.querySelector('#orrery g.glyphs')!;
    (window as unknown as Hooks).__pb.views.orrery.setDate('2059-12-31');
    let seen = false;
    for (const t0 = performance.now(); performance.now() - t0 < 600;) {
      await new Promise(requestAnimationFrame);
      seen ||= glyphs.getAnimations().length > 0;
    }
    return seen;
  });
  expect(faded).toBe(false);
  await expect.poll(() => simDate(page), { timeout: 2000 }).toMatch(/^20[2-5]/);
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
  // Stopped at once, so the body stays under the pointer.
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

test('a still mouse keeps a fast body it points at, and the click opens it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'mouse');
  // Mercury at its fastest on screen: 1920×1080, 2026-11-10. Its way, from a day later.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('');
  const setDate = (iso: string) =>
    page.evaluate((iso) => (window as unknown as Hooks).__pb.views.orrery.setDate(iso), iso);
  await setDate('2026-11-11');
  const b = await at(page, 'mercury');
  await setDate('2026-11-10');
  const a = await at(page, 'mercury');
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  expect(len).toBeGreaterThan(5);
  // 7 px behind its centre, 5 px inside the trailing edge of its 12 px link.
  const c = await at(page, 'mercury');
  await page.mouse.move(c.x - ((b.x - a.x) / len) * 7, c.y - ((b.y - a.y) / len) * 7);
  await page.waitForTimeout(600);
  await expect(page.locator('#orrery')).toHaveAttribute('data-active', 'mercury');
  await page.mouse.down();
  await page.mouse.up();
  await expect(page).toHaveURL(/\/mercury\/$/);
});

test('a name is lettered off its own orbit', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse');
  // 1440×900 on 2026-10-18: Pluto's orbit used to run through PLUTO.
  await page.goto('?capture&date=2026-10-18');
  const lettered = () =>
    page.evaluate(
      () => document.querySelector('#orrery > .layer-text-l path')?.getAttribute('d') ?? '',
    );
  for (const id of PLANETS) {
    const before = await lettered();
    const p = await at(page, id);
    await page.mouse.move(p.x, p.y);
    await expect(page.locator('#orrery')).toHaveAttribute('data-active', id);
    // The next frame letters the name.
    await expect.poll(lettered).not.toBe(before);
    await expect.poll(lettered).not.toBe('');
    const through = await page.evaluate((id) => {
      const svg = document.getElementById('orrery')!;
      const name = svg.querySelector<SVGPathElement>(':scope > .layer-text-l path[d]:not([d=""])')!;
      const b = name.getBBox();
      const d = svg.querySelector(`.orbits [data-ref="${id}"]`)!.getAttribute('d')!;
      const pts = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [+m[1]!, +m[2]!]);
      // Length of orbit inside the name's box, px, every 0.5 px along it.
      let inside = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]!,
          [bx, by] = pts[i]!;
        const n = Math.max(1, Math.ceil(Math.hypot(bx! - ax!, by! - ay!) / 0.5));
        for (let k = 0; k < n; k++) {
          const x = ax! + ((bx! - ax!) * k) / n,
            y = ay! + ((by! - ay!) * k) / n;
          if (x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height) inside += 0.5;
        }
      }
      return inside;
    }, id);
    expect(through, id).toBe(0);
  }
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

test('on a phone on its side, a tap on Venus beside the Earth opens Venus, not a chooser', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'touch');
  // 750×342 on 2027-02-04: Venus 27 px from the Earth, clear of the Moon's ring (it took Venus in
  // when the ring was drawn as large as it is for a mouse).
  await page.setViewportSize({ width: 750, height: 342 });
  await page.goto('?capture&date=2027-02-04');
  const venus = await at(page, 'venus');
  await page.touchscreen.tap(venus.x, venus.y);
  await expect(page).toHaveURL(/\/venus\/$/);
});

test('with a mouse, the Moon’s ring lies outside the Earth’s link', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse');
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('?capture&date=2026-10-18');
    // The link that each of 72 points along the ring opens.
    const hits = await page.evaluate(() => {
      const ring = document.querySelector<SVGPathElement>('#orrery [data-ref="moon"]')!;
      const m = ring.getScreenCTM()!;
      const n = ring.getTotalLength();
      return Array.from({ length: 72 }, (_, k) => {
        const p = ring.getPointAtLength((k / 72) * n).matrixTransform(m);
        return document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('a[data-body]')?.dataset
          .body;
      });
    });
    const wh = `${size.width}×${size.height}`;
    // Venus's link lies over part of it on this date; the rest is the Moon's.
    expect(hits.filter((b) => b === 'moon').length, wh).toBeGreaterThan(36);
    expect(hits, wh).not.toContain('earth');
  }
});

test('a pointer that changes without a resize changes the Moon’s ring', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    isMobile || browserName !== 'chromium',
    'touch is turned on through the DevTools protocol',
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('?capture&date=2026-10-18');
  const width = () =>
    page
      .locator('#orrery [data-ref="moon"]')
      .evaluate((p: SVGGraphicsElement) => p.getBBox().width);
  const mouse = await width();
  const earth = await page.evaluate(
    () => (window as unknown as Hooks).__pb.views.orrery.glyphRadii().earth!,
  );
  // A finger's ring: its radius is the Earth's symbol's diameter and 6 px.
  const finger = 2 * (2 * earth + 6);
  expect(mouse).toBeGreaterThan(finger + 1);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await expect.poll(width).toBeCloseTo(finger, 0);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await expect.poll(width).toBeCloseTo(mouse, 0);
});

test('a finger held on a body sees its name clear of the fingertip', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(!isMobile, 'touch');
  await page.goto('?capture&date=2026-10-18');
  const name = page.locator('#orrery > .layer-text-l path[d]:not([d=""])');
  // A real held touch where the browser allows one: Pluto, whose name used to fall under the finger.
  if (browserName === 'chromium') {
    const p = await at(page, 'pluto');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: p.x, y: p.y }],
    });
    await expect(page.locator('#orrery')).toHaveAttribute('data-active', 'pluto');
    expect((await name.boundingBox())!.y + (await name.boundingBox())!.height).toBeLessThanOrEqual(
      p.y - 30,
    );
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(page.locator('#orrery')).not.toHaveAttribute('data-active');
  }
  // Every body alone within reach, pressed at its centre (the same pointerdown, from script): the
  // name stays out of the 56 px square round the contact point.
  const near = await page.evaluate(async () => {
    const o = (window as unknown as Hooks).__pb.views.orrery;
    const svg = document.getElementById('orrery')!;
    const box = svg.getBoundingClientRect();
    const lettered = () =>
      svg.querySelector<SVGPathElement>(':scope > .layer-text-l path[d]:not([d=""])');
    /** The name once the next frames have lettered it (or cleared it), within 2 s. */
    const settle = async (want: boolean) => {
      for (const t0 = performance.now(); performance.now() - t0 < 2000;) {
        await new Promise(requestAnimationFrame);
        if (!!lettered() === want) break;
      }
      return lettered();
    };
    const out: Record<string, number> = {};
    for (const [id, [x, y]] of Object.entries(o.positions())) {
      if (o.within(x, y).length !== 1) continue;
      const press = (type: string) =>
        svg.closest('.orrery')!.dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'touch',
            clientX: box.x + x,
            clientY: box.y + y,
            bubbles: true,
          }),
        );
      press('pointerdown');
      const r = (await settle(true))!.getBBox();
      out[id] = Math.max(r.x - x, x - (r.x + r.width), r.y - y, y - (r.y + r.height));
      press('pointercancel');
      await settle(false);
    }
    return out;
  });
  expect(Object.keys(near).length).toBeGreaterThan(4);
  for (const [id, d] of Object.entries(near)) expect(d, id).toBeGreaterThanOrEqual(28);
});

test('a name beside a finger, along its own orbit, interrupts the orbit', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'touch');
  // 664×390 on 2033-06-23: Uranus at the top, nothing above the finger is clear, and its orbit runs
  // beside the finger, where the name goes.
  await page.setViewportSize({ width: 664, height: 390 });
  await page.goto('?capture&date=2033-06-23');
  const { named, masked } = await page.evaluate(async () => {
    const svg = document.getElementById('orrery')!;
    const box = svg.getBoundingClientRect();
    const [x, y] = (window as unknown as Hooks).__pb.views.orrery.positions().uranus!;
    svg.closest('.orrery')!.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        clientX: box.x + x,
        clientY: box.y + y,
        bubbles: true,
      }),
    );
    const at = (layer: string) =>
      svg.querySelector<SVGPathElement>(`:scope > .layer-${layer} path[d]:not([d=""])`)?.getBBox();
    for (let i = 0; i < 60 && !at('text-l'); i++) await new Promise(requestAnimationFrame);
    const name = at('text-l'),
      mask = at('mask');
    return {
      named: !!name,
      // The orbit gives way all round the letters.
      masked:
        !!name &&
        !!mask &&
        mask.x < name.x &&
        mask.y < name.y &&
        mask.x + mask.width > name.x + name.width &&
        mask.y + mask.height > name.y + name.height,
    };
  });
  expect(named).toBe(true);
  expect(masked).toBe(true);
});

test('turning the phone closes the chooser', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch');
  await page.goto('');
  await page.evaluate(() => (window as unknown as Hooks).__pb.views.orrery.setDate('2026-10-18'));
  const earth = await at(page, 'earth');
  await page.touchscreen.tap(earth.x, earth.y);
  const chooser = page.locator('.chooser:popover-open');
  await expect(chooser).toBeVisible();
  await page.setViewportSize({ width: 664, height: 390 });
  await expect(chooser).toHaveCount(0);
  // The candidates go dark and the clock runs again.
  await expect(page.locator('#orrery [data-ref].hot')).toHaveCount(0);
  const a = await simDate(page);
  await page.waitForTimeout(800);
  expect(days(a, await simDate(page))).toBeGreaterThan(0);
});

test('on a touch screen wider than 860 px, a tap just above Pause still toggles it', async ({
  browser,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, 'once per engine, in a tablet of its own');
  const {
    viewport,
    deviceScaleFactor,
    isMobile: mobile,
    hasTouch,
    userAgent,
  } = devices['iPad Mini landscape'];
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    isMobile: mobile,
    hasTouch,
    userAgent,
    baseURL: testInfo.project.use.baseURL,
  });
  const page = await context.newPage();
  await page.goto('');
  const pause = page.locator('#pause');
  await expect(pause).toHaveAttribute('data-paused', 'false');
  const b = (await pause.boundingBox())!;
  await page.touchscreen.tap(b.x + b.width / 2, b.y - 6);
  await expect(pause).toHaveAttribute('data-paused', 'true');
  await context.close();
});

test('in a contrast theme the Pause icon keeps its bars and its triangle', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    !isMobile || browserName !== 'chromium',
    'the icon is for phones; forced colours: Chromium',
  );
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('');
  const icon = () =>
    page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('pause')!, '::before');
      return {
        left: `${s.borderLeftStyle} ${s.borderLeftWidth}`,
        right: `${s.borderRightStyle} ${s.borderRightWidth}`,
        size: `${s.width} ${s.height}`,
        fill: s.backgroundColor,
        clip: s.clipPath,
      };
    });
  // Two 3 px bars: the borders either side of a 3 px gap.
  expect(await icon()).toMatchObject({ left: 'solid 3px', right: 'solid 3px', size: '3px 12px' });
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveAttribute('data-paused', 'true');
  // A filled triangle.
  const play = await icon();
  expect(play).toMatchObject({ left: 'none 0px', size: '11px 14px' });
  expect(play.clip).toMatch(/^polygon/);
  expect(play.fill).not.toMatch(/^rgba\(.*, 0\)$/);
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

test('the dialog’s data links break only after a "·", and the long one before its count', async ({
  page,
}) => {
  await page.goto('');
  await page.locator('button.info').click();
  await expect(page.locator('dialog#info')).toBeVisible();
  for (const width of [320, 360, 390, 414, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    // How each line of the paragraph but the last ends.
    const ends = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#info h3')].find(
        (h) => h.textContent === 'Data and code',
      )!;
      const range = document.createRange();
      const out: string[] = [];
      let line = '';
      let mid = -Infinity;
      const walker = document.createTreeWalker(h.nextElementSibling!, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          const r = range.getBoundingClientRect();
          if (r.height && !/\s/.test(text[i]!)) {
            const m = (r.top + r.bottom) / 2;
            if (m > mid + 6 && line) {
              out.push(line.trim());
              line = '';
            }
            mid = m;
          }
          line += text[i];
        }
      }
      return out;
    });
    for (const end of ends) expect(end, `${width}`).toMatch(/(·|disagree)$/);
  }
});
