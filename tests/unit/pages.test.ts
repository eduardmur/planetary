// The static pages: every sheet carries NASA's 20 rows verbatim, its sources, and working meta tags.

import { describe, expect, it } from 'vitest';
import { mainRow, mainVal } from '../../src/data/index.ts';
import { PARAMS } from '../../src/content/params.ts';
import { SHEETS } from '../../src/content/sheets.ts';
import { BODY_IDS } from '../../src/data/types.ts';
import { renderPage } from '../../src/render/page.ts';

const ctx = {
  base: '/planetary-blueprints/',
  site: 'https://eduardmur.github.io/planetary-blueprints/',
  issued: '2026-10-17',
  repo: 'https://github.com/eduardmur/planetary-blueprints',
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('pages', () => {
  it('there are 11 sheets: the general arrangement and the ten bodies', () => {
    expect(SHEETS.map((s) => s.id)).toEqual(['ga', ...BODY_IDS]);
    expect(SHEETS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  for (const sheet of SHEETS) {
    it(`${sheet.id}: rows, sources and meta`, () => {
      const html = renderPage(sheet, ctx);
      const ids = sheet.id === 'ga' ? BODY_IDS : [sheet.id];
      for (const p of PARAMS) {
        expect(html).toContain(`data-key="${p.key}"`);
        for (const id of ids) expect(html).toContain(`<td>${esc(mainVal(id, p.key).text)}`);
      }
      expect(html).toContain(esc(mainRow('mass').label.split(' (')[0]!));
      expect(html).toContain('UNOFFICIAL — NOT A NASA PRODUCT');
      expect(html).toContain('https://nssdc.gsfc.nasa.gov/planetary/factsheet/');
      expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\.png"/);
      expect(html).toMatch(
        /<link rel="canonical" href="https:\/\/eduardmur\.github\.io\/planetary-blueprints\//,
      );
      expect(html).toContain(`${sheet.number} / 11`);
      // The embedded page data is valid JSON.
      const json = html.match(
        /<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/,
      )![1]!;
      const data = JSON.parse(json);
      expect(data.sheet).toBe(sheet.id);
    });
  }
});
