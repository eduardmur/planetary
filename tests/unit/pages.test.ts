// What every static page has: its sources, working meta tags, the "?" dialog, valid page data, and
// the new name throughout.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHEETS } from '../../src/content/sheets.ts';
import { BODY_IDS } from '../../src/data/types.ts';
import { render404, renderPage } from '../../src/render/page.ts';

const ctx = {
  base: '/planetary/',
  site: 'https://eduardmur.github.io/planetary/',
  issued: '2026-10-18',
  repo: 'https://github.com/eduardmur/planetary',
};

describe('pages', () => {
  it('there are 11 sheets: the home page and the ten bodies, numbered PL-01 to PL-11', () => {
    expect(SHEETS.map((s) => s.id)).toEqual(['home', ...BODY_IDS]);
    expect(SHEETS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(SHEETS.map((s) => s.dwg)).toEqual(
      SHEETS.map((_, i) => `PL-${String(i + 1).padStart(2, '0')}`),
    );
  });

  for (const sheet of SHEETS) {
    it(`${sheet.id}: meta, dialog and page data`, () => {
      const html = renderPage(sheet, ctx);
      expect(html).not.toMatch(/blueprints/i);
      expect(html).toContain('Unofficial');
      expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\.png"/);
      expect(html).toMatch(
        /<link rel="canonical" href="https:\/\/eduardmur\.github\.io\/planetary\//,
      );
      expect(html).toContain('<meta property="og:site_name" content="Planetary" />');
      expect(html).toContain('<dialog id="info"');
      expect(html).toContain('commandfor="info"');
      // The embedded page data is valid JSON.
      const json = html.match(
        /<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/,
      )![1]!;
      expect(JSON.parse(json).sheet).toBe(sheet.id);
    });
  }

  it('public/og has exactly one card per sheet', () => {
    expect(readdirSync('public/og').sort()).toEqual(SHEETS.map((s) => `${s.id}.png`).sort());
  });

  it('every image the README shows exists', () => {
    const shown = [...readFileSync('README.md', 'utf8').matchAll(/\]\((docs\/media\/[^)]+)\)/g)];
    expect(shown.length).toBeGreaterThan(0);
    for (const [, path] of shown) expect(existsSync(path!), path).toBe(true);
  });

  it('the 404 page links home under the new name', () => {
    const html = render404(ctx.base);
    expect(html).toContain('<a href="/planetary/">Planetary</a>');
    expect(html).not.toMatch(/blueprints/i);
  });
});
