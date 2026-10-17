#!/usr/bin/env node
// Renders the images that show the project, from the built site itself, with a fixed clock:
//   public/og/<sheet>.png   Open Graph cards, 1200×630 (committed; the pages link to them)
//   docs/media/*            the README's images and GIFs (committed)
//   media/*                 stills and posters for social posts (not committed)
//
//   npm run build && npm run media
import { spawn } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const root = resolve(import.meta.dirname, '..');
const port = 4179;
const base = `http://localhost:${port}/planetary/`;
const SHEETS = [
  'ga',
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
const url = (id, q = '') => `${base}${id === 'ga' ? '' : `${id}/`}${q}`;
const only = process.argv.slice(2);
const want = (what) => !only.length || only.includes(what);

for (const d of ['public/og', 'docs/media', 'media'])
  mkdirSync(resolve(root, d), { recursive: true });

const server = spawn(
  'npx',
  ['vite', 'preview', '--configLoader', 'runner', '--port', String(port), '--strictPort'],
  {
    cwd: root,
    stdio: 'ignore',
  },
);
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100) throw new Error('preview server did not start');
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
const size = (f) => `${(statSync(resolve(root, f)).size / 1024).toFixed(0)} kB`;

/** Open a page with the capture flag and wait until its drawings are filled. */
async function open(context, id, q) {
  const page = await context.newPage();
  await page.goto(url(id, q), { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelectorAll('svg.drawing path[d]:not([d=""])').length > 8,
  );
  await page.waitForTimeout(300);
  return page;
}

// ---- Open Graph cards --------------------------------------------------------------------------
if (want('og')) {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const id of SHEETS) {
    const page = await open(ctx, id, '?capture=og&t=2500');
    const file = `public/og/${id}.png`;
    await page.screenshot({ path: resolve(root, file) });
    await page.close();
    console.log(file, size(file));
  }
  await ctx.close();
}

// ---- README stills -----------------------------------------------------------------------------
if (want('stills')) {
  const desk = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  for (const [id, hash, file] of [
    ['uranus', '#magneticField', 'docs/media/sheet-uranus-dipole.png'],
    ['ga', '', 'media/sheet-ga.png'],
    ['saturn', '', 'media/sheet-saturn.png'],
    ['pluto', '#orbitalInclination', 'media/sheet-pluto-inclination.png'],
  ]) {
    const page = await open(desk, id, `?capture&t=2500${hash}`);
    await page.waitForTimeout(1100); // camera turns for the inclination view
    await page.screenshot({ path: resolve(root, file), fullPage: id === 'ga' });
    await page.close();
    console.log(file, size(file));
  }
  await desk.close();
  const phone = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  const page = await open(phone, 'uranus', '?capture&t=2500');
  await page.screenshot({ path: resolve(root, 'media/phone-uranus.png') });
  console.log('media/phone-uranus.png', size('media/phone-uranus.png'));
  await phone.close();
}

// ---- GIFs ----------------------------------------------------------------------------------------

/** Capture `frames` screenshots of `selector`, calling `step(i)` in the page before each. The palette
 *  comes from the frames `paletteAt`, so a highlight that is off in the first frame keeps its colour. */
async function gif(page, selector, frames, fps, step, file, paletteAt = [0]) {
  const el = page.locator(selector);
  const samples = [];
  for (const i of paletteAt) {
    await page.evaluate(step, i);
    await page.waitForTimeout(1500);
    samples.push(PNG.sync.read(await el.screenshot()).data);
  }
  // Paper, white ink and the yellow highlight, with their anti-aliased blends.
  const palette = quantize(Buffer.concat(samples), 32, { format: 'rgb444' });
  await page.evaluate(step, 0);
  await page.waitForTimeout(1500); // let any camera turn settle before the loop starts
  const enc = GIFEncoder();
  for (let i = 0; i < frames; i++) {
    await page.evaluate(step, i);
    await page.waitForTimeout(40);
    const { data, width, height } = PNG.sync.read(await el.screenshot());
    const index = applyPalette(data, palette, 'rgb444');
    enc.writeFrame(index, width, height, { palette, delay: Math.round(1000 / fps), repeat: 0 });
  }
  enc.finish();
  writeFileSync(resolve(root, file), enc.bytes());
  console.log(file, size(file));
}

if (want('gifs')) {
  const ctx = await browser.newContext({
    viewport: { width: 1100, height: 720 },
    deviceScaleFactor: 1,
  });
  // Saturn turning. The 30° graticule repeats every 1/12 turn, so six of them loop seamlessly;
  // the obliquity row lights up for the middle of the loop.
  {
    const page = await open(ctx, 'saturn', '?capture&t=0');
    const turn = 10.7 * 1000; // ms of real time per turn at 1 s = 1 h
    const frames = 64;
    const span = (turn / 12) * 6;
    await gif(
      page,
      '.views',
      frames,
      12,
      (i) => {
        const pb = window.__pb;
        const t = (i / 64) * ((10.7 * 1000) / 2);
        pb.views.a.clock = () => t;
        pb.show(i >= 18 && i < 46 ? 'obliquity' : null);
        pb.views.a.redraw();
      },
      'docs/media/saturn.gif',
      [0, 32],
    );
    void span;
    await page.close();
  }
  // The line-up, all ten turning at 1 s = 1 h.
  {
    const wide = await browser.newContext({
      viewport: { width: 1500, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await open(wide, 'ga', '?capture&t=0');
    await gif(
      page,
      '.lineup-row td',
      72,
      12,
      (i) => {
        const pb = window.__pb;
        const t = (i / 12) * 1000;
        pb.views.lineup.clock = () => t;
        pb.views.lineup.redraw();
      },
      'docs/media/lineup.gif',
    );
    await wide.close();
  }
  await ctx.close();
}

// ---- Social posters (4:5) -----------------------------------------------------------------------
if (want('posters')) {
  const ctx = await browser.newContext({
    viewport: { width: 432, height: 540 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
  });
  for (const id of SHEETS.slice(1)) {
    const page = await open(ctx, id, '?capture=poster&t=2500');
    const file = `media/poster-${id}.png`;
    await page.screenshot({ path: resolve(root, file) });
    await page.close();
    console.log(file, size(file));
  }
  await ctx.close();
}

await browser.close();
stop();
