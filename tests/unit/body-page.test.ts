// A body's page: NASA's 20 rows verbatim, each with a popover holding NASA's definition, the ratio to
// Earth where NASA gives one, the values its drawing takes from the body's own page and the places
// where NASA's pages disagree; ten tabs; and a "?" dialog that dates every source.

import { parse, type HTMLElement } from 'node-html-parser';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { BODY_SHEETS } from '../../src/content/sheets.ts';
import {
  DISCREPANCIES,
  FACTS,
  body,
  mainRow,
  mainVal,
  ratioVal,
  type BodyId,
} from '../../src/data/index.ts';
import { keyPlanModel } from '../../src/data/model.ts';
import { NOTES_MAIN, NOTES_RATIO, NOTES_SHEET, isoDate } from '../../src/render/common.ts';
import { renderPage } from '../../src/render/page.ts';

const ctx = {
  base: '/planetary/',
  site: 'https://eduardmur.github.io/planetary/',
  issued: '2026-10-18',
  repo: 'https://github.com/eduardmur/planetary',
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pages = new Map(BODY_SHEETS.map((s) => [s.id, renderPage(s, ctx)] as [BodyId, string]));
const dom = new Map([...pages].map(([id, html]) => [id, parse(html)]));
const popover = (id: BodyId, key: string) => dom.get(id)!.querySelector(`#def-${key}`)!;
/** Text as read, blocks apart, with runs of white space as one space. */
const text = (el: HTMLElement | null) => (el?.structuredText ?? '').replace(/\s+/g, ' ').trim();

describe('body pages', () => {
  for (const sheet of BODY_SHEETS) {
    const id = sheet.id;
    const html = pages.get(id)!;
    const root = dom.get(id)!;

    it(`${id}: NASA's 20 rows, each a button for its popover`, () => {
      expect(root.querySelectorAll('table.main tbody tr[data-key]')).toHaveLength(20);
      for (const p of PARAMS) {
        expect(html).toContain(`<td>${esc(mainVal(id, p.key).text)}`);
        const row = root.querySelector(`tr[data-key="${p.key}"]`)!;
        expect(row.getAttribute('tabindex')).toBeUndefined();
        const button = row.querySelector('th button')!;
        expect(button.getAttribute('popovertarget')).toBe(`def-${p.key}`);
        const def = popover(id, p.key);
        expect(def.getAttribute('popover')).toBe('manual');
        expect(def.getAttribute('aria-labelledby')).toBe(`t-${p.key}`);
        expect(text(def.querySelector('.text'))).toBe(FACTS.definitions.main[p.key]!.text);
        const notes = def.querySelector('.src a')!.getAttribute('href');
        expect(notes).toBe(`${FACTS.source}planetfact_notes.html#${mainRow(p.key).anchor}`);
      }
    });

    it(`${id}: × Earth exactly where NASA's ratio table gives a ratio`, () => {
      for (const p of PARAMS) {
        const ratio = id === 'earth' ? undefined : ratioVal(id, p.key);
        const shown = popover(id, p.key).querySelector('.ratio');
        if (ratio?.text) expect(text(shown)).toBe(`× Earth ${ratio.text}${ratio.note ?? ''}`);
        else expect(shown).toBeNull();
      }
    });

    it(`${id}: NASA's conflicts in the popovers they concern`, () => {
      for (const p of PARAMS) {
        const lines = popover(id, p.key).querySelectorAll('.conflict').map(text);
        const ledger = DISCREPANCIES.filter((d) => d.body === id && d.key === p.key);
        expect(lines).toHaveLength(ledger.length);
        ledger.forEach((d, i) => {
          for (const s of [d.what, d.a, d.aSrc, d.b, d.bSrc]) expect(lines[i]).toContain(s);
        });
      }
    });

    it(`${id}: ten tabs, this one current`, () => {
      const tabs = root.querySelectorAll('.tabs nav[aria-label="Bodies"] a');
      expect(tabs.map((a) => a.getAttribute('data-body'))).toEqual(BODY_SHEETS.map((s) => s.id));
      expect(
        root.querySelectorAll('[aria-current]').map((a) => a.getAttribute('data-body')),
      ).toEqual([id]);
      expect(root.querySelector('.tabs a.home')!.getAttribute('href')).toBe(ctx.base);
    });

    it(`${id}: the dialog dates every source and holds the title block`, () => {
      const info = root.querySelector('dialog#info')!;
      const b = body(id);
      const sources: [string, string][] = [
        [b.url, b.lastUpdated],
        [FACTS.main.url, FACTS.main.lastUpdated],
        [FACTS.ratio.url, FACTS.ratio.lastUpdated],
      ];
      if (b.rings) sources.push([b.rings.url, b.rings.lastUpdated]);
      if (keyPlanModel(id).earth) sources.push([body('earth').url, body('earth').lastUpdated]);
      for (const [url, date] of sources) {
        const link = info.querySelectorAll('a').find((a) => a.getAttribute('href') === url);
        expect(link, url).toBeTruthy();
        expect(link!.parentNode.innerHTML).toContain(isoDate(date));
      }
      for (const notes of [NOTES_MAIN, NOTES_RATIO, NOTES_SHEET])
        expect(info.querySelectorAll(`a[href="${notes}"]`)).toHaveLength(1);
      expect(text(info)).toContain(`${sheet.dwg} · SHEET ${sheet.number} / 11 · DETAIL DRAWING`);
      expect(text(info)).toContain('General notes');
      expect(text(info)).toContain('not affiliated with or endorsed by NASA');
    });

    it(`${id}: no notes, title block or definition box on the sheet itself`, () => {
      const main = root.querySelector('main')!;
      expect(
        main.querySelectorAll('.notes, .title-block, #definition, #drawn-values'),
      ).toHaveLength(0);
      expect(root.querySelector('#view-a')!.getAttribute('aria-describedby')).toBeUndefined();
      expect(html).not.toMatch(/drawn to scale|one true scale/i);
    });
  }

  it('the popovers add what each drawing takes from the body’s own page', () => {
    const also = (id: BodyId, key: string) => text(popover(id, key).querySelector('.also'));
    expect(also('saturn', 'diameter')).toContain('Polar radius (1 bar level) (km) 54,364');
    expect(also('mars', 'diameter')).toContain('Core radius (km) 1830**');
    expect(also('mars', 'diameter')).toContain(
      '** Recent results indicate the radius of the core of Mars may only be 1650 - 1675 km.',
    );
    expect(also('earth', 'diameter')).toContain('Core radius (km) 3485');
    // Only the flattened giants have their polar radius drawn.
    expect(also('venus', 'diameter')).toBe('');

    const magnetic = popover('uranus', 'magneticField');
    const items = magnetic.querySelectorAll('.also dl > div').map(text);
    const tilt = FACTS.definitions.sheet.dipoleTilt!.text;
    const offset = FACTS.definitions.sheet.dipoleOffset!.text;
    expect(items[0]).toContain('Dipole tilt to rotational axis 58.6 degrees');
    expect(items[0]).toContain(tilt);
    expect(items[1]).toContain('Dipole offset 0.352 Ru · direction not given');
    expect(items[1]).toContain(offset);
    expect(items[1]).not.toContain(tilt);
    expect(text(magnetic)).toContain('Ru denotes Uranian model radius');
    expect(also('earth', 'magneticField')).toContain('(9.35°) = 90° − 80.65°');
    expect(also('earth', 'magneticField')).toContain('Geocentric Dipole 80.65 N, 72.68 W');
    expect(also('saturn', 'magneticField')).toContain('quadrapole and octapole');

    const rings = popover('saturn', 'ringSystem');
    expect(rings.querySelectorAll('dl.edges > div')).toHaveLength(8);
    expect(text(rings)).toContain('2022-04-19');
    expect(text(rings)).toContain('Not drawn at this scale: G inner edge 166,000');
    expect(text(rings)).toContain('Wide = opaque rings, narrow = fainter, phantom');

    expect(also('mars', 'perihelion')).toContain('Longitude of perihelion (deg) 336.04084');
    expect(also('mars', 'orbitalInclination')).toContain('Longitude of ascending node (deg)');
    expect(also('mars', 'orbitalPeriod')).toContain('Sidereal orbit period (days) 686.980');
    // NASA gives no orbital elements for the Moon.
    expect(also('moon', 'perihelion')).toBe('');
  });

  it('“Not drawn.” on the rows without ⊢⊣', () => {
    for (const [id, root] of dom)
      for (const p of PARAMS) {
        const drawn = root.querySelector(`tr[data-key="${p.key}"]`)!.hasAttribute('data-shape');
        expect(!!popover(id, p.key).querySelector('.not-drawn'), `${id} ${p.key}`).toBe(!drawn);
      }
    expect(
      dom.get('moon')!.querySelector('tr[data-key="orbitalPeriod"]')!.hasAttribute('data-shape'),
    ).toBe(false);
    expect(
      dom.get('venus')!.querySelector('tr[data-key="magneticField"]')!.hasAttribute('data-shape'),
    ).toBe(false);
  });

  it('15 popovers carry the 19 conflicts', () => {
    let popovers = 0,
      lines = 0;
    for (const root of dom.values())
      for (const def of root.querySelectorAll('.def')) {
        const n = def.querySelectorAll('.conflict').length;
        popovers += n ? 1 : 0;
        lines += n;
      }
    expect(popovers).toBe(15);
    expect(lines).toBe(19);
  });
});
