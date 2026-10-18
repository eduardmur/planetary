// The drawings in the browsers: no line runs through a lettered value, in any state a row can give a
// drawing; every line that lights up belongs to a row; turned any way, View A stays inside its frame
// and off the key plan, and no line runs through its lettering; and the unit sweeps draw them at the
// sizes the built pages give them.

import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

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

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );

/**
 * In the page: for each lettered label in a drawing, the ink of other lines that runs through the
 * label's glyphs (inside the convex hull of its strokes), in px of line. Lines a mask interrupts do
 * not count, nor a value's own dimension line and leader.
 */
function throughLettering(sel: string) {
  const svg = document.querySelector<SVGSVGElement>(sel);
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  type P = [number, number];
  const CAP: Record<string, number> = { 'text-s': 6.6, 'text-m': 8, 'text-l': 10, 'text-xl': 20 };
  const LINES = [
    'grid',
    'hidden',
    'hidden-dash',
    'phantom',
    'center',
    'thin',
    'dim',
    'wide',
    'mark',
  ];
  const parse = (d: string): P[][] => {
    const out: P[][] = [];
    const tok = d.match(/[MLZa]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    let cur: P[] = [];
    let x = 0,
      y = 0;
    for (let i = 0; i < tok.length;) {
      const t = tok[i++]!;
      if (t === 'M' || t === 'L') {
        x = +tok[i++]!;
        y = +tok[i++]!;
        if (t === 'M') out.push((cur = []));
        cur.push([x, y]);
      } else if (t === 'a') {
        // A dot: its circle.
        const rr = +tok[i++]!;
        i += 4;
        const dx = +tok[i++]!,
          dy = +tok[i++]!;
        if (cur.length === 1) {
          const c: P = [x + dx / 2, y + dy / 2];
          cur.length = 0;
          for (let k = 0; k <= 12; k++)
            cur.push([
              c[0] + Math.cos((k / 12) * 2 * Math.PI) * rr,
              c[1] + Math.sin((k / 12) * 2 * Math.PI) * rr,
            ]);
        }
        x += dx;
        y += dy;
      } else if (t === 'Z' && cur.length) cur.push(cur[0]!);
    }
    return out;
  };
  const inside = (q: P, poly: P[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!,
        [xj, yj] = poly[j]!;
      if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const hull = (pts: P[]) => {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo: P[] = [],
      up: P[] = [];
    for (const q of p) {
      while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
      lo.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i]!;
      while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
      up.push(q);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  };
  const paths = [...svg.querySelectorAll<SVGPathElement>('.layer path')]
    .map((el) => ({
      layer: [...el.parentElement!.classList].find((c) => c.startsWith('layer-'))!.slice(6),
      ref: el.getAttribute('data-ref') ?? '',
      subs: parse(el.getAttribute('d') ?? ''),
    }))
    .filter((p) => p.subs.length);
  const masks = paths.filter((p) => p.layer === 'mask').flatMap((p) => p.subs);
  // Labels: a text path holds its labels' strokes in the order they were lettered; a jump of more
  // than a letter's height starts the next label.
  const labels: { ref: string; text: P[] }[] = [];
  for (const p of paths.filter((q) => q.layer in CAP)) {
    const cap = CAP[p.layer]!;
    let last: P | null = null;
    for (const s of p.subs) {
      const near = last && s.some((q) => Math.hypot(q[0] - last![0], q[1] - last![1]) < cap * 1.2);
      if (!near) labels.push({ ref: p.ref, text: [] });
      labels[labels.length - 1]!.text.push(...s);
      last = s[s.length - 1]!;
    }
  }
  const out: string[] = [];
  for (const lab of labels) {
    const H = hull(lab.text);
    if (H.length < 3) continue;
    for (const p of paths) {
      if (!LINES.includes(p.layer)) continue;
      if (p.layer === 'dim' && lab.ref && p.ref === lab.ref) continue;
      let n = 0;
      for (const s of p.subs)
        for (let i = 1; i < s.length; i++) {
          const a = s[i - 1]!,
            b = s[i]!;
          const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
          for (let k = 0; k <= m; k++) {
            const q: P = [a[0] + ((b[0] - a[0]) * k) / m, a[1] + ((b[1] - a[1]) * k) / m];
            if (inside(q, H) && !masks.some((mk) => inside(q, mk))) n++;
          }
        }
      if (n > 1) out.push(`${lab.ref || '-'} × ${p.layer}|${p.ref}: ${(n * 0.5).toFixed(1)} px`);
    }
  }
  return out;
}

for (const id of BODIES)
  test(`/${id}/: no line runs through a lettered value, in any state`, async ({ page }) => {
    await page.goto(`${id}/?capture&t=2500&date=2026-10-18`);
    await expect.poll(() => page.locator('#view-a path[d]:not([d=""])').count()).toBeGreaterThan(8);
    const keys = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('tr[data-shape]')].map((r) => r.dataset.key!),
    );
    const out: string[] = [];
    for (const key of [null, ...keys]) {
      await page.evaluate(
        (k) => (window as unknown as { __pb: { show(k: string | null): void } }).__pb.show(k),
        key,
      );
      await frames(page);
      await page.waitForTimeout(50);
      for (const sel of ['#view-a', '#key-plan']) {
        const hits = await page.evaluate(throughLettering, sel);
        for (const h of hits ?? []) out.push(`${key ?? 'idle'} ${sel}: ${h}`);
      }
    }
    expect(out).toEqual([]);
  });

test('every line that lights up belongs to a row', async ({ page, isMobile }) => {
  test.skip(isMobile, 'both drawings at once');
  for (const id of BODIES) {
    await page.goto(`${id}/`);
    await expect.poll(() => page.locator('#view-a path[d]:not([d=""])').count()).toBeGreaterThan(8);
    const bad = await page.evaluate(async () => {
      const pb = (window as unknown as { __pb: { show(k: string | null): void } }).__pb;
      const rows = [...document.querySelectorAll<HTMLElement>('tr[data-key]')].map(
        (r) => r.dataset.key!,
      );
      const ok = new Set([...rows, 'polarRadius', 'coreRadius', 'dipoleTilt', 'dipoleOffset']);
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

test("Earth's orbit in a key plan is a reference: no pointer, nothing to click", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'a pointer');
  await page.goto('mercury/');
  await expect.poll(() => page.locator('#key-plan path[d]:not([d=""])').count()).toBeGreaterThan(4);
  const at = await page.evaluate(() => {
    // Earth's orbit: the phantom circle that belongs to no row; its leftmost point.
    const path = document.querySelector<SVGPathElement>(
      '#key-plan .layer-phantom path:not([data-ref])',
    )!;
    const xs = [...path.getAttribute('d')!.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    const left = xs.reduce((a, b) => (b[0] < a[0] ? b : a));
    const r = path.ownerSVGElement!.getBoundingClientRect();
    return { x: r.left + left[0], y: r.top + left[1] };
  });
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)!;
    return {
      cursor: getComputedStyle(el).cursor,
      ref: el.closest('[data-ref]')?.getAttribute('data-ref') ?? null,
      earth: document.querySelectorAll('[data-ref~="earthOrbit"]').length,
    };
  }, at);
  expect(hit).toEqual({ cursor: 'default', ref: null, earth: 0 });
});

for (const [w, h] of [
  [1440, 900],
  [1180, 820],
] as const)
  test(`turned any way at ${w}×${h}, View A stays inside its frame, off the key plan and its lettering clear`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the key plan is an inset on desktop');
    await page.setViewportSize({ width: w, height: h });
    for (const [id, hash] of [
      ['uranus', ''],
      ['neptune', ''],
      ['saturn', ''],
      ['uranus', '#obliquity'],
    ]) {
      await page.goto(`${id}/${hash}`);
      await expect
        .poll(() => page.locator('#view-a path[d]:not([d=""])').count())
        .toBeGreaterThan(8);
      await page.locator('#view-a').focus();
      const out: string[] = [];
      // Every 15° (three presses of 5°).
      for (let turn = 0; turn < 72; turn += 3) {
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
        await frames(page);
        const bad = await page.evaluate(() => {
          const svg = document.getElementById('view-a')!;
          const a = svg.getBoundingClientRect();
          const kp = document.querySelector('.key-plan')!.getBoundingClientRect();
          let outside = 0,
            onPlan = 0;
          for (const el of svg.querySelectorAll<SVGPathElement>('path[d]:not([d=""])')) {
            if (el.closest('.layer-hit, .layer-paper')) continue;
            for (const m of el.getAttribute('d')!.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
              const x = Number(m[1]),
                y = Number(m[2]);
              if (x < -0.5 || y < -0.5 || x > a.width + 0.5 || y > a.height + 0.5) outside++;
              const px = a.left + x,
                py = a.top + y;
              if (px > kp.left && px < kp.right && py > kp.top && py < kp.bottom) onPlan++;
            }
          }
          return outside || onPlan ? `${outside} outside, ${onPlan} on the key plan` : '';
        });
        const at = `${id}${hash} turned ${(turn + 3) * 5}°`;
        if (bad) out.push(`${at}: ${bad}`);
        for (const hit of (await page.evaluate(throughLettering, '#view-a')) ?? [])
          out.push(`${at}: ${hit}`);
      }
      expect(out).toEqual([]);
    }
  });

type Sizes = {
  touch: boolean;
  a: { w: number; h: number; inset: { x0: number; y0: number; x1: number; y1: number } | null };
  p: { w: number; h: number };
};

/** In the page: View A's size, the key-plan inset in its pixels, and the key plan's size, as the
 *  views measure them. */
function drawingSizes(): Omit<Sizes, 'touch'> {
  type V = {
    w: number;
    h: number;
    clearInset?: boolean;
    inset?: Sizes['a']['inset'];
    measure(): void;
  };
  const { a, p } = (window as unknown as { __pb: { views: { a: V; p: V } } }).__pb.views;
  a.measure();
  const view = { w: a.w, h: a.h, inset: a.clearInset ? a.inset! : null };
  // A phone shows one drawing at a time: the key plan, to measure it.
  document.querySelector('.views')!.classList.add('show-plan');
  p.measure();
  return { a: view, p: { w: p.w, h: p.h } };
}

// The unit sweeps (tests/unit/drawings-*.test.ts) draw both views at the sizes these windows give
// them, kept in tests/fixtures/drawing-sizes.json: a change of layout that moves them fails here.
// UPDATE_SIZES=1 measures them anew and writes the file.
test("the unit sweep draws at the built pages' own sizes", async ({ browser, isMobile }, info) => {
  test.skip(isMobile, 'each window opens its own screen');
  const file = new URL('../fixtures/drawing-sizes.json', import.meta.url);
  const want = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Sizes>;
  const got: Record<string, Sizes> = {};
  for (const [name, { touch }] of Object.entries(want)) {
    const [width, height] = name.split('x').map(Number) as [number, number];
    const ctx = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: { width, height },
      ...(touch ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await ctx.newPage();
    await page.goto('saturn/');
    await expect.poll(() => page.locator('#view-a path[d]:not([d=""])').count()).toBeGreaterThan(8);
    got[name] = { touch, ...(await page.evaluate(drawingSizes)) };
    await ctx.close();
  }
  if (process.env.UPDATE_SIZES) {
    writeFileSync(file, JSON.stringify(got, null, 2) + '\n');
    return;
  }
  const off: string[] = [];
  for (const [name, s] of Object.entries(want)) {
    const g = got[name]!;
    const pairs: [string, number, number][] = [
      ['View A width', g.a.w, s.a.w],
      ['View A height', g.a.h, s.a.h],
      ['key plan width', g.p.w, s.p.w],
      ['key plan height', g.p.h, s.p.h],
      ...(['x0', 'y0', 'x1', 'y1'] as const).map((k): [string, number, number] => [
        `inset ${k}`,
        g.a.inset?.[k] ?? 0,
        s.a.inset?.[k] ?? 0,
      ]),
    ];
    for (const [what, x, y] of pairs)
      if (Math.abs(x - y) > 0.5) off.push(`${name}: ${what} ${x}, not ${y}`);
  }
  expect(off).toEqual([]);
});
