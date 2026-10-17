// A body's page carries NASA's 20 rows verbatim.

import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { BODY_SHEETS } from '../../src/content/sheets.ts';
import { mainRow, mainVal } from '../../src/data/index.ts';
import { renderPage } from '../../src/render/page.ts';

const ctx = {
  base: '/planetary/',
  site: 'https://eduardmur.github.io/planetary/',
  issued: '2026-10-18',
  repo: 'https://github.com/eduardmur/planetary',
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('body pages', () => {
  for (const sheet of BODY_SHEETS) {
    it(`${sheet.id}: NASA's rows and sources`, () => {
      const html = renderPage(sheet, ctx);
      for (const p of PARAMS) {
        expect(html).toContain(`data-key="${p.key}"`);
        expect(html).toContain(`<td>${esc(mainVal(sheet.id, p.key).text)}`);
      }
      expect(html).toContain(esc(mainRow('mass').label.split(' (')[0]!));
      expect(html).toContain('https://nssdc.gsfc.nasa.gov/planetary/factsheet/');
      expect(html).toContain(`${sheet.number} / 11`);
    });
  }
});
