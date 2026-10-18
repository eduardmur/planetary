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
        // One at a time without the script (the script makes them manual).
        expect(def.getAttribute('popover')).toBe('auto');
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
        // A paragraph each, but lines alike in all but their values share one.
        expect(lines).toHaveLength(
          new Set(ledger.map((d) => `${d.within}|${d.what}|${d.note}`)).size,
        );
        for (const d of ledger) {
          const lead = d.within
            ? `NASA’s ${d.within} disagrees with itself`
            : 'NASA’s pages disagree';
          // A page that disagrees with itself is named once, in the lead.
          const src = (s: string) => (s === d.within ? '' : ` (${s})`);
          const pair = `${d.a}${src(d.aSrc)} vs ${d.b}${src(d.bSrc)}`;
          const line = lines.find(
            (l) => l.startsWith(`${lead} on ${d.what}: `) && l.includes(pair),
          );
          expect(line, `${id} ${p.key}: ${pair}`).toBeDefined();
          expect(line!.split(': '), line).toHaveLength(2);
          if (d.note) expect(line).toContain(d.note);
        }
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

    it(`${id}: the dialog's title line breaks only after a "·", and the dialog links home`, () => {
      const info = root.querySelector('dialog#info')!;
      const line = info.querySelector('.title-line')!;
      const items = line.childNodes.filter((n) => n.nodeType === 1) as HTMLElement[];
      expect(items.map((s) => s.getAttribute('class'))).toEqual(Array(6).fill('nowrap'));
      expect(items.map(text)[0]).toBe(sheet.dwg);
      expect(items.map(text).at(-1)).toBe('SPIN 1 s = 1 h');
      expect(line.innerHTML.split('</span>&nbsp;· <span')).toHaveLength(6);
      expect(info.querySelector('#epoch') !== null).toBe(!!keyPlanModel(id).j2000);
      // Focus goes to the heading when the dialog opens (the script adds autofocus), not on load.
      expect(info.querySelector('[autofocus]')).toBeNull();
      const home = info.querySelector('.info-body p a')!;
      expect(home.getAttribute('href')).toBe(ctx.base);
      expect(text(home)).toBe('☉ Planetary');
    });

    it(`${id}: the dialog's reading notes follow the input and the script`, () => {
      const list = root.querySelectorAll('dialog#info .info-body ul')[0]!;
      const lines = list.querySelectorAll('li');
      // Double-click or double tap; ← → and ↑ ↓ only with keys; ‹ › for every input, above the
      // table or in the definition (body.css shows the one the layout has).
      const reset = lines.find((l) => text(l).includes('to reset'))!;
      expect(reset.querySelector('.pointer')!.text).toBe('double-click');
      expect(reset.querySelector('.touch')!.text).toBe('double-tap');
      const tabsLine = lines.find((l) => text(l).startsWith('Tabs'))!;
      expect(tabsLine.querySelector('.pointer')!.text).toContain('← →');
      const steps = lines.find((l) => text(l).includes('‹ ›'))!;
      expect(steps.classList.contains('pointer')).toBe(false);
      expect(steps.querySelector('.pointer')!.text).toBe('↑ ↓ or ');
      expect(steps.querySelector('.steps-above')!.text).toBe('above the table');
      expect(steps.querySelector('.steps-in')!.text).toBe('in the definition');
      // What needs the script is .js-only; without it, a row still opens its definition.
      for (const l of lines.filter((l) => /drawing|Drag|Tabs|‹ ›/.test(text(l))))
        expect(l.classList.contains('js-only'), text(l)).toBe(true);
      expect(text(lines.find((l) => l.classList.contains('nojs-only'))!)).toContain(
        'row’s name for NASA’s definition',
      );
      expect(text(list)).toContain('☉');
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
    // Every row of NASA's ring sheet is drawn or named: inside the drawn rings, then beyond them.
    expect(text(rings)).toContain(
      'Not drawn: D outer edge 74,510 · Titan ringlet 77,871 · Maxwell gap/ringlet 87,491 · Keeler gap 136,487. Not drawn at this scale: G inner edge 166,000',
    );
    expect(text(rings)).toContain('Wide = opaque rings, narrow = fainter, phantom');
    // Neptune: NASA's names, so its note's "*" has something to refer to; the arcs are named.
    const neptune = popover('neptune', 'ringSystem');
    expect(neptune.querySelectorAll('dl.edges dt').map(text)).toEqual([
      'Galle (1989N3R)',
      'LeVerrier (1989N2R)',
      'Arago (1989N4R*)',
      'Adams (1989N1R)',
    ]);
    expect(text(neptune)).toContain(
      'Not drawn: Lassell (1989N4R*) ~53,200 · Unnamed (indistinct) 61,953 · Arcs in Adams Ring (Courage, Liberté, Egalité 1, Egalité 2, Fraternité) 62,933: NASA gives no longitudes.',
    );
    expect(text(neptune)).toContain('(*Lassell and Arago were originally identified as one ring');
    expect(text(neptune)).not.toContain('at this scale');
    // Jupiter and Uranus draw every row inside their outermost drawn edge.
    for (const id of ['jupiter', 'uranus'] as const) {
      expect(text(popover(id, 'ringSystem'))).not.toContain('Not drawn:');
      expect(text(popover(id, 'ringSystem'))).toContain('Not drawn at this scale: ');
    }
    // The lists break only after a "·", each entry kept whole; Adams's arcs, too many for one line,
    // only after a comma or the colon, so that every name keeps its number.
    const lists = (id: BodyId) => popover(id, 'ringSystem').querySelector('.also dl.edges + p')!;
    expect(lists('saturn').querySelectorAll('.nowrap').map(text)).toEqual([
      'D outer edge 74,510',
      'Titan ringlet 77,871',
      'Maxwell gap/ringlet 87,491',
      'Keeler gap 136,487',
      'G inner edge 166,000',
      'G outer edge 173,000',
      'E inner edge 180,000',
      'E outer edge 480,000',
    ]);
    expect(lists('neptune').querySelectorAll('.nowrap').map(text)).toEqual([
      'Lassell (1989N4R*) ~53,200',
      'Unnamed (indistinct) 61,953',
      'Arcs in Adams Ring (Courage,',
      'Liberté,',
      'Egalité 1,',
      'Egalité 2,',
      'Fraternité) 62,933:',
      'NASA gives no longitudes',
    ]);
    for (const id of ['jupiter', 'saturn', 'uranus', 'neptune'] as const)
      expect(lists(id).innerHTML, id).not.toMatch(/ ·/);
    // NASA's notes: sentences run on in one paragraph; Neptune's parenthesis keeps one of its own.
    const notes = (id: BodyId) => popover(id, 'ringSystem').querySelectorAll('.also p.n').map(text);
    expect(notes('saturn')).toHaveLength(1);
    expect(notes('neptune')).toEqual([
      '(*Lassell and Arago were originally identified as one ring, designated 1989N4R)',
      'For more details on the rings of Neptune, see the PDS Rings Node Vital Statistics.',
    ]);

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

  it('each popover has ‹ › before ×, with none before the first row or after the last', () => {
    for (const [id] of dom)
      for (const [i, p] of PARAMS.entries()) {
        const header = popover(id, p.key).querySelector('header')!;
        const buttons = header.querySelectorAll('button');
        expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
          'Previous row',
          'Next row',
          'Close',
        ]);
        expect(buttons.map((b) => b.getAttribute('aria-disabled') ?? '')).toEqual([
          i === 0 ? 'true' : '',
          i === PARAMS.length - 1 ? 'true' : '',
          '',
        ]);
      }
  });

  it('Orbital Velocity says what lights up, since no line is sized by it', () => {
    for (const [id] of dom) {
      const def = popover(id, 'orbitalVelocity');
      if (id === 'moon') {
        expect(def.querySelector('.not-drawn')).not.toBeNull();
        expect(text(def)).not.toContain('direction of motion');
      } else
        expect(text(def.querySelector('p.n'))).toBe(
          'Drawn: today’s position and the direction of motion. The arrow is a symbol; its length is not the speed.',
        );
    }
    expect(text(dom.get('saturn')!.querySelector('dialog#info'))).toContain(
      'KEY PLAN: SUN, BODY AND MOTION ARROW ARE SYMBOLS, NOT TO SCALE.',
    );
  });

  it('View A and the key plan carry each caption they show', () => {
    for (const [id, root] of dom) {
      const [long, short] = root.querySelectorAll('.view-a .caption > span');
      expect(long!.getAttribute('data-edge-on')).toBe('Orbit plane edge-on');
      // Phones take the short form, which fits a 320 px screen.
      expect(['data-plan', 'data-tilt', 'data-edge-on'].map((a) => short!.getAttribute(a))).toEqual(
        ['20° above orbit', 'Tilt true size', 'Orbit edge-on'],
      );
      // Square on and edge-on, both in place so that the plan keeps its size as it turns.
      const plan = root.querySelectorAll('.key-plan .caption > span').map(text);
      expect(plan, id).toHaveLength(2);
      expect(plan[1]).toContain('edge-on');
    }
  });

  it('no × Earth where NASA’s ratio is "Unknown" (the giants’ surface pressure)', () => {
    for (const id of ['jupiter', 'saturn', 'uranus', 'neptune'] as const) {
      const def = popover(id, 'surfacePressure');
      expect(def.querySelector('.ratio'), id).toBeNull();
      expect(text(def.querySelector('.value'))).toBe('Unknown*');
    }
    // A real ratio stays: Venus's 92 bar is 92 × Earth.
    expect(text(popover('venus', 'surfacePressure').querySelector('.ratio'))).toContain('× Earth');
  });

  it('the row stepper sits outside the table, which keeps its caption as its name', () => {
    for (const [, root] of dom) {
      const steps = root.querySelector('.schedule > .steps')!;
      expect(steps.getAttribute('role')).toBe('group');
      expect(
        steps.querySelectorAll('button.step').map((b) => b.getAttribute('aria-label')),
      ).toEqual(['Previous row', 'Next row']);
      expect(root.querySelector('table.main caption')!.querySelector('button')).toBeNull();
    }
  });

  it('15 popovers carry the 18 conflicts, in 16 paragraphs', () => {
    let popovers = 0,
      lines = 0;
    for (const root of dom.values())
      for (const def of root.querySelectorAll('.def')) {
        const n = def.querySelectorAll('.conflict').length;
        popovers += n ? 1 : 0;
        lines += n;
      }
    expect(popovers).toBe(15);
    expect(lines).toBe(16);
  });

  it('conflict lines say whether two pages disagree or one page disagrees with itself', () => {
    const lines = (id: BodyId, key: string) =>
      popover(id, key).querySelectorAll('.conflict').map(text);
    expect(lines('mercury', 'diameter')).toEqual([
      'NASA’s pages disagree on diameter vs 2 × equatorial radius (km): 4879 (main table) vs 2 × 2440.5 = 4881 (mercuryfact.html).',
    ]);
    expect(lines('moon', 'diameter')).toEqual([
      'NASA’s pages disagree on diameter vs 2 × equatorial radius (km): 3475 (main table) vs 2 × 1738.1 = 3476.2 (moonfact.html).',
    ]);
    expect(lines('pluto', 'orbitalEccentricity')).toEqual([
      'NASA’s main table disagrees with itself on eccentricity vs perihelion and aphelion: 0.244 vs (7375.9 − 4436.8)/(7375.9 + 4436.8) = 0.2488. Planetary draws the ellipse from the perihelion and aphelion, and lists the eccentricity as NASA prints it.',
    ]);
    expect(lines('pluto', 'meanTemperature')).toEqual([
      'NASA’s pages disagree on mean temperature vs “Surface temperature” (°C): -225 (main table) vs 24 - 38 K (-247 - -233 C) (plutofact.html).',
      'NASA’s plutofact.html disagrees with itself on “Surface temperature”: 24 - 38 K printed as -247 to -233 C vs -249.15 to -235.15 C (K − 273.15).',
    ]);
    // Uranus's three ring ratios read as one paragraph, with the note once.
    expect(lines('uranus', 'ringSystem')).toEqual([
      'NASA’s uranringfact.html disagrees with itself on the Radius/Eq. radius column: Eta 1.834 vs 47,176 ÷ 25,559 = 1.846; Delta 1.900 vs 48,300 ÷ 25,559 = 1.890; Epsilon 2.006 vs 51,149 ÷ 25,559 = 2.001. Planetary draws the rings from the km column.',
    ]);
  });

  it('sets every ☉ in a span of its own, for the symbol font: the page’s font has none', () => {
    for (const [id, html] of pages) {
      // The header's, and the two in the dialog.
      expect(html.match(/☉/g), id).toHaveLength(3);
      expect(html.match(/<span class="sun"[^>]*>☉<\/span>/g), id).toHaveLength(3);
    }
  });
});
