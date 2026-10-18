// @vitest-environment node
//
// Checks src/data/factsheet.json against the NASA snapshot it was parsed from (data/raw/):
// structure, that every printed string really is on its page, ~100 values read off the pages by
// hand, and that every number is the number its text states.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import factsheetJson from '../../src/data/factsheet.json';
import { BODY_IDS } from '../../src/data/types.ts';
import type { BodyId, BodySheet, FactSheet, Gas, Row, Val } from '../../src/data/types.ts';
import {
  BODY_PAGES,
  CSV_OUT,
  JSON_OUT,
  PAGES,
  RAW_DIR,
  RING_PAGES,
  buildFactSheet,
  mainCsv,
  normalizeText,
  parseVal,
  renderJson,
  rowKey,
} from '../../scripts/parse-nasa.ts';

const data = factsheetJson as unknown as FactSheet;

type Block =
  'bulk' | 'orbital' | 'observational' | 'elements' | 'pole' | 'magnetosphere' | 'atmosphere';
const BLOCKS: Block[] = [
  'bulk',
  'orbital',
  'observational',
  'elements',
  'pole',
  'magnetosphere',
  'atmosphere',
];
const GIANTS: BodyId[] = ['jupiter', 'saturn', 'uranus', 'neptune'];

const body = (id: BodyId): BodySheet => data.bodies[id];
const keys = (rows: Row[] | undefined): string[] => (rows ?? []).map((r) => r.key);
function row(id: BodyId, block: Block, key: string): Row {
  const r = body(id)[block]?.find((x) => x.key === key);
  if (!r) throw new Error(`${id}.${block}.${key} is missing`);
  return r;
}
const val = (id: BodyId, block: Block, key: string): Val => row(id, block, key).body;
const main = (key: string, id: BodyId): Val | undefined =>
  data.main.rows.find((r) => r.key === key)?.values[id];
const ring = (id: BodyId, name: string) => body(id).rings?.rings.find((r) => r.name === name);
const gasList = (id: BodyId) =>
  (body(id).composition?.gases ?? []).map((g: Gas) => [
    g.group,
    g.name,
    g.formula ?? null,
    g.amount.text,
    g.unit,
    g.uncertainty ?? null,
  ]);

// ---------------------------------------------------------------------------------------------------

describe('normalisation and values', () => {
  it.each([
    ['10<sup>24</sup>', '10²⁴'],
    ['km<sup>3</sup>', 'km³'],
    ['x 10<sup>-6</sup>', 'x 10⁻⁶'],
    ['H<sub>2</sub>O', 'H₂O'],
    ['Rh<span><sup>3</sup></span>', 'Rh³'],
    ['C<span><sub>2</sub></span>H<span><sub>x</sub></span>', 'C₂Hₓ'],
    ['(<span><sup>4</sup></span>He)', '(⁴He)'],
    ['1830<sup>**</sup>', '1830**'],
    ['&nbsp;&nbsp;Libert&eacute;&nbsp;', 'Liberté'],
    ['&lt;~5 x 10<span><sup>-15</sup></span> bar', '<~5 x 10⁻¹⁵ bar'],
    ['Radius/<br />Eq. radius', 'Radius/Eq. radius'],
    ['Ratio<br />(Mars/Earth)', 'Ratio (Mars/Earth)'],
    // fact_notes.html types its powers with a caret: text, kept as printed.
    ['in 10^6 kilometers^3/seconds^2', 'in 10^6 kilometers^3/seconds^2'],
    ['kg m^-1 s^-2', 'kg m^-1 s^-2'],
    // A subscript word Unicode cannot write reads as a subscript, not as "Requator".
    ['{2(R<sub>equator</sub>^2) + R<sub>polar</sub>^2}/3', '{2(R_equator^2) + R_polar^2}/3'],
    ['<b><a href="x">Mass</a> (10<sup>24</sup>kg)</b>', 'Mass (10²⁴kg)'],
    ['line\r\nbreaks\rand   tabs\t', 'line breaks and tabs'],
  ])('%s → %s', (html, text) => expect(normalizeText(html)).toBe(text));

  it('fails loudly instead of guessing', () => {
    expect(() => normalizeText('&bogus;')).toThrow(/entity/);
    expect(() => normalizeText('x<sup>q</sup>')).toThrow(/Unicode/);
    expect(() => normalizeText('x<sub>q</sub>')).toThrow(/Unicode/);
    expect(() => normalizeText('R<sup>polar</sup>')).toThrow(/Unicode/); // only subscripts get "_"
  });

  it.each<[string, Val]>([
    ['0.64169', { text: '0.64169', value: 0.64169 }],
    ['1,898.13', { text: '1,898.13', value: 1898.13 }],
    ['16,298.', { text: '16,298.', value: 16298 }],
    ['0.', { text: '0.', value: 0 }],
    ['-5832.6', { text: '-5832.6', value: -5832.6 }],
    ['-11.26064', { text: '-11.26064', value: -11.26064 }],
    ['92 bars', { text: '92 bars', value: 92 }],
    ['0.306 Gauss-Re³', { text: '0.306 Gauss-Re³', value: 0.306 }],
    ['~65. kg/m³', { text: '~65. kg/m³', value: 65, qualifier: '~' }],
    ['>>1000 bars', { text: '>>1000 bars', value: 1000, qualifier: '>>' }],
    ['< 100', { text: '< 100', value: 100, qualifier: '<' }],
    ['<<0.01', { text: '<<0.01', value: 0.01, qualifier: '<<' }],
    ['0.384*', { text: '0.384', value: 0.384, note: '*' }],
    ['Unknown*', { text: 'Unknown', value: null, note: '*' }],
    ['18.28 - 28.58', { text: '18.28 - 28.58', value: null, range: [18.28, 28.58] }],
    ['12,000-200,000', { text: '12,000-200,000', value: null, range: [12000, 200000] }],
    [
      '0.3 to 1.0 m/s (surface)',
      { text: '0.3 to 1.0 m/s (surface)', value: null, range: [0.3, 1] },
    ],
    [
      '~0.1 - 1.0 Gauss',
      { text: '~0.1 - 1.0 Gauss', value: null, qualifier: '~', range: [0.1, 1] },
    ],
    // A power of ten states one number (Saturn's and Jupiter's rings, atmosphere masses).
    ['10⁻⁵', { text: '10⁻⁵', value: 1e-5 }],
    ['10⁵', { text: '10⁵', value: 1e5 }],
    ['3 x 10⁻⁶', { text: '3 x 10⁻⁶', value: 3e-6 }],
    ['~2.5 x 10¹⁶ kg', { text: '~2.5 x 10¹⁶ kg', value: 2.5e16, qualifier: '~' }],
    ['1.4 x 10²¹ kg', { text: '1.4 x 10²¹ kg', value: 1.4e21 }],
    // A trailing sign (Uranus's rings) stays in the text; a leading "+" is the number's own.
    ['~0.4-', { text: '~0.4-', value: 0.4, qualifier: '~' }],
    ['~0.3+', { text: '~0.3+', value: 0.3, qualifier: '~' }],
    ['+11.8', { text: '+11.8', value: 11.8 }],
    // Not a single number: dimensions, a second number in the unit.
    ['48.4 x 33.8 x 31.4', { text: '48.4 x 33.8 x 31.4', value: null }],
    ['19 x 10 x 9', { text: '19 x 10 x 9', value: null }],
    ['3 x 10⁻¹⁵ bar (2 x 10⁻¹² torr)', { text: '3 x 10⁻¹⁵ bar (2 x 10⁻¹² torr)', value: null }],
    [
      '<~5 x 10⁻¹⁵ bar (0.005 picobar)',
      { text: '<~5 x 10⁻¹⁵ bar (0.005 picobar)', value: null, qualifier: '<~' },
    ],
    [
      '440 K (167 C) (590-725 K, sunward side)',
      { text: '440 K (167 C) (590-725 K, sunward side)', value: null },
    ],
    ['24 - 38 K (-247 - -233 C)', { text: '24 - 38 K (-247 - -233 C)', value: null }],
    [
      '12:00 UT 1 Jan 2000 (JD 2451545.0)',
      { text: '12:00 UT 1 Jan 2000 (JD 2451545.0)', value: null },
    ],
  ])('parseVal(%j)', (printed, expected) => expect(parseVal(printed)).toEqual(expected));

  it('maps every label variant through ROW_KEYS and throws on an unmapped one', () => {
    expect(rowKey('bulk', 'Surface Gravity (mean) (m/s²)')).toBe('gravity'); // Pluto's capital G
    expect(rowKey('bulk', 'Gravity (mean, 1 bar) (m/s²)')).toBe('gravity');
    expect(rowKey('bulk', 'Surface gravity (m/s²)')).toBe('gravity'); // Moon
    expect(rowKey('bulk', 'Equatorial radius (1 bar level) (km)')).toBe('equatorialRadius');
    expect(rowKey('orbital', 'Tropical orbit period* (days)')).toBe('tropicalPeriod'); // Mars
    // The Moon's orbit is about the Earth: not keyed as the Sun-relative perihelion, aphelion and
    // sidereal period, whose fact_notes.html definitions say "closest to the Sun", "about the Sun".
    expect(rowKey('orbital', 'Perigee (10⁶ km)*')).toBe('perigee');
    expect(rowKey('orbital', 'Apogee (10⁶ km)*')).toBe('apogee');
    expect(rowKey('orbital', 'Revolution period (days)')).toBe('revolutionPeriod');
    expect(rowKey('orbital', 'Inclination to ecliptic (deg)')).toBe('inclination');
    expect(rowKey('elements', 'Mean longitude (deg)')).toBe('meanLongitude'); // Pluto's lower case
    expect(() => rowKey('bulk', 'Mass (10²¹ kg)')).toThrow(/unmapped/);
    expect(() => rowKey('orbital', 'Orbital period (days)')).toThrow(/unmapped/);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('(a) structure', () => {
  it('has the ten bodies in order, each with its own page', () => {
    expect(Object.keys(data.bodies)).toEqual([...BODY_IDS]);
    for (const id of BODY_IDS) {
      expect(body(id).id).toBe(id);
      expect(body(id).url).toBe(
        `https://nssdc.gsfc.nasa.gov/planetary/factsheet/${BODY_PAGES[id]}`,
      );
    }
    expect(BODY_IDS.map((id) => body(id).name)).toEqual([
      'Mercury',
      'Venus',
      'Earth',
      'Moon',
      'Mars',
      'Jupiter',
      'Saturn',
      'Uranus',
      'Neptune',
      'Pluto',
    ]);
  });

  it('has the 20 x 10 main table', () => {
    expect(data.main.rows.map((r) => r.key)).toEqual([
      'mass',
      'diameter',
      'density',
      'gravity',
      'escapeVelocity',
      'rotationPeriod',
      'dayLength',
      'distanceFromSun',
      'perihelion',
      'aphelion',
      'orbitalPeriod',
      'orbitalVelocity',
      'orbitalInclination',
      'orbitalEccentricity',
      'obliquity',
      'meanTemperature',
      'surfacePressure',
      'moons',
      'ringSystem',
      'magneticField',
    ]);
    for (const r of data.main.rows) {
      expect(Object.keys(r.values)).toEqual([...BODY_IDS]);
      for (const id of BODY_IDS) expect(r.values[id].text).not.toBe('');
    }
    expect(data.main.rows.map((r) => r.anchor)).toEqual([
      'mass',
      'diam',
      'dens',
      'grav',
      'escv',
      'rotp',
      'leng',
      'dist',
      'peri',
      'peri',
      'orbp',
      'orbv',
      'orbi',
      'orbe',
      'orbo',
      'temp',
      'surp',
      'sats',
      'ring',
      'magf',
    ]);
  });

  it.each(BODY_IDS)('%s has the core bulk and orbital rows (Moon included)', (id) => {
    const bulk = keys(body(id).bulk);
    const orbital = keys(body(id).orbital);
    for (const k of ['equatorialRadius', 'polarRadius']) expect(bulk).toContain(k);
    const sun = ['perihelion', 'aphelion', 'siderealPeriod'];
    const earth = ['perigee', 'apogee', 'revolutionPeriod']; // the Moon's orbit
    for (const k of [
      'siderealRotation',
      'obliquity',
      'eccentricity',
      'inclination',
      'semimajorAxis',
      ...(id === 'moon' ? earth : sun),
    ]) {
      expect(orbital).toContain(k);
    }
    for (const k of id === 'moon' ? sun : earth) expect(orbital).not.toContain(k);
    for (const block of BLOCKS) {
      const k = keys(body(id)[block]);
      expect(new Set(k).size, `${id}.${block} keys are unique`).toBe(k.length);
    }
  });

  it('has mean orbital elements for every body but the Moon, rings for the four giants', () => {
    for (const id of BODY_IDS) {
      if (id === 'moon') expect(body(id).elements).toBeUndefined();
      else
        expect(keys(body(id).elements)).toEqual([
          'semimajorAxisAU',
          'eccentricity',
          'inclination',
          'ascendingNode',
          'perihelionLongitude',
          'meanLongitude',
        ]);
      expect(Boolean(body(id).rings)).toBe(GIANTS.includes(id));
    }
  });

  it('has the block sizes of each page', () => {
    const sizes = Object.fromEntries(
      BODY_IDS.map((id) => [
        id,
        [
          ...BLOCKS.map((b) => body(id)[b]?.length ?? null),
          body(id).composition?.gases.length ?? null,
          body(id).rings?.rings.length ?? null,
        ],
      ]),
    );
    // bulk, orbital, observational, elements, pole, magnetosphere, atmosphere, gases, rings
    expect(sizes).toEqual({
      mercury: [22, 15, 9, 6, 4, 5, 3, 8, null],
      venus: [22, 15, 9, 6, 3, null, 8, 8, null],
      earth: [23, 14, 0, 6, 4, 6, 9, 9, null],
      moon: [19, 14, 3, null, null, null, 4, 9, null],
      mars: [23, 15, 10, 6, 4, null, 8, 11, null],
      jupiter: [21, 15, 10, 6, 4, 6, 7, 7, 6],
      saturn: [21, 14, 12, 6, 4, 5, 7, 6, 19],
      uranus: [21, 15, 10, 6, 3, 6, 7, 4, 13],
      neptune: [20, 15, 10, 6, 5, 6, 7, 5, 12],
      pluto: [19, 15, 10, 6, 3, null, 4, 3, null],
    });
  });

  it('keeps the moons the Mars and Pluto pages list, block by block', () => {
    const blocks = Object.fromEntries(
      BODY_IDS.map((id) => [
        id,
        body(id).satellites?.map((b) => [
          b.caption,
          b.satellites.map((m) => [m.name, m.rows.length]),
        ]),
      ]),
    );
    expect(blocks).toEqual({
      mars: [
        [
          'Satellites of Mars',
          [
            ['Phobos', 13],
            ['Deimos', 13],
          ],
        ],
      ],
      pluto: [
        ['Charon (P1)', [['Charon (P1)', 13]]],
        [
          'Other Moons of Pluto',
          [
            ['Styx (P5)', 5],
            ['Nix (P2)', 5],
            ['Kerberos (P4)', 5],
            ['Hydra (P3)', 5],
          ],
        ],
      ],
    });
    for (const id of BODY_IDS) {
      for (const b of body(id).satellites ?? []) {
        for (const m of b.satellites) {
          const k = keys(m.rows);
          expect(new Set(k).size, `${m.name} keys are unique`).toBe(k.length);
        }
      }
    }
  });

  it('exposes the magnetosphere keys where printed', () => {
    expect(keys(body('mercury').magnetosphere)).toEqual([
      'model',
      'dipoleFieldStrength',
      'dipoleTilt',
      'dipoleOffset',
      'surfaceField',
    ]);
    for (const id of ['jupiter', 'uranus', 'neptune'] as const) {
      expect(keys(body(id).magnetosphere)).toEqual([
        'model',
        'dipoleFieldStrength',
        'dipoleTilt',
        'tiltLongitude',
        'dipoleOffset',
        'surfaceField',
      ]);
    }
    expect(keys(body('earth').magnetosphere)).toEqual([
      'model',
      'dipoleFieldStrength',
      'dipoleOffset',
      'surfaceField',
      'geocentricDipole',
      'magneticNorthPole',
    ]);
    for (const id of ['venus', 'moon', 'mars', 'pluto'] as const)
      expect(body(id).magnetosphere).toBeUndefined();
  });

  it('records each page date', () => {
    expect(Object.fromEntries(BODY_IDS.map((id) => [id, body(id).lastUpdated]))).toEqual({
      mercury: '11 January 2024',
      venus: '11 January 2024',
      earth: '15 November 2024',
      moon: '11 January 2024',
      mars: '19 May 2025',
      jupiter: '2 October 2024',
      saturn: '18 March 2025',
      uranus: '2 October 2024',
      neptune: '3 October 2024',
      pluto: '11 January 2024',
    });
    expect(data.main.lastUpdated).toBe('18 March 2025');
    expect(body('saturn').rings?.lastUpdated).toBe('19 April 2022');
    // The three notes pages every definition comes from, keyed as the definitions are.
    const notes = (file: string, lastUpdated: string) => ({ url: data.source + file, lastUpdated });
    expect(data.definitions.pages).toEqual({
      main: notes(PAGES.mainNotes, '20 December 2021'),
      ratio: notes(PAGES.ratioNotes, '17 July 2015'),
      sheet: notes(PAGES.sheetNotes, '6 May 2024'),
    });
    expect(data.retrieved).toBe('2026-10-17T18:10:27.703Z');
    expect(data.source).toBe('https://nssdc.gsfc.nasa.gov/planetary/factsheet/');
  });
});

// ---------------------------------------------------------------------------------------------------

describe('(b) every printed string is on its source page', () => {
  const cache = new Map<string, string>();
  const page = (file: string): string => {
    let text = cache.get(file);
    if (text === undefined) {
      text = normalizeText(readFileSync(resolve(RAW_DIR, file), 'utf8'));
      cache.set(file, text);
    }
    return text;
  };
  /** True when `text` is on the page, also with its footnote marker put back where it was printed. */
  const onPage = (file: string, text: string, note?: string): boolean => {
    const hay = page(file);
    if (hay.includes(text)) return true;
    if (!note) return false;
    for (let i = 0; i <= text.length; i++) {
      if (hay.includes(text.slice(0, i) + note + text.slice(i))) return true;
    }
    return false;
  };
  let missing: string[] = [];
  let checked = 0;
  const check = (file: string, where: string, text: string | undefined, note?: string): void => {
    if (text === undefined) return;
    checked++;
    if (!onPage(file, text, note)) missing.push(`${file} ${where}: ${JSON.stringify(text)}`);
  };
  const checkVal = (file: string, where: string, v: Val | undefined): void =>
    check(file, where, v?.text, v?.note);
  beforeEach(() => {
    missing = [];
    checked = 0;
  });

  it('finds what is on the page and nothing else', () => {
    expect(onPage(PAGES.main, 'Mass (10²⁴kg)')).toBe(true);
    expect(onPage(BODY_PAGES.mars, 'Tropical orbit period (days)')).toBe(false);
    expect(onPage(BODY_PAGES.mars, 'Tropical orbit period (days)', '*')).toBe(true);
    expect(onPage(BODY_PAGES.mars, '0.64170')).toBe(false);
  });

  it('body sheets: labels, values, captions, gases, footnotes', () => {
    for (const id of BODY_IDS) {
      const b = body(id);
      const file = BODY_PAGES[id];
      check(file, 'name', b.name);
      for (const block of BLOCKS) {
        for (const r of b[block] ?? []) {
          const where = `${block}.${r.key}`;
          check(file, `${where} label`, r.label, r.note);
          check(file, `${where} group`, r.group);
          checkVal(file, where, r.body);
          checkVal(file, `${where} earth`, r.earth);
          checkVal(file, `${where} ratio`, r.ratio);
        }
      }
      for (const c of [
        b.orbitalCaption,
        b.poleCaption,
        b.magnetosphereCaption,
        b.atmosphereCaption,
      ]) {
        check(file, 'caption', c);
      }
      for (const t of [...b.footnotes, ...(b.magnetosphereNotes ?? [])]) check(file, 'note', t);
      for (const block of b.satellites ?? []) {
        check(file, 'satellites caption', block.caption);
        for (const n of block.notes) check(file, 'satellites note', n);
        for (const m of block.satellites) {
          check(file, 'satellite', m.name);
          for (const r of m.rows) {
            check(file, `${m.name} ${r.key} label`, r.label, r.note);
            checkVal(file, `${m.name} ${r.key}`, r.body);
          }
        }
      }
      const comp = b.composition;
      if (comp) {
        check(file, 'basis', comp.basis);
        for (const g of comp.gases) {
          check(file, 'gas', g.name);
          check(file, `${g.name} formula`, g.formula);
          checkVal(file, `${g.name} amount`, g.amount);
          check(file, `${g.name} uncertainty`, g.uncertainty);
          check(file, `${g.name} unit`, g.unit);
        }
        for (const t of comp.remarks) check(file, 'remark', t);
      }
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(2000);
  });

  it('ring sheets: headers, names, radii, columns, notes', () => {
    for (const id of GIANTS) {
      const sheet = body(id).rings;
      const file = RING_PAGES[id] ?? '';
      expect(sheet?.url).toBe(`https://nssdc.gsfc.nasa.gov/planetary/factsheet/${file}`);
      for (const h of sheet?.headers ?? []) check(file, 'header', h);
      for (const r of sheet?.rings ?? []) {
        check(file, 'ring', r.name);
        check(file, `${r.name} group`, r.group);
        checkVal(file, `${r.name} radius`, r.radius);
        checkVal(file, `${r.name} ratio`, r.ratio);
        for (const [h, v] of Object.entries(r.columns)) checkVal(file, `${r.name} ${h}`, v);
      }
      for (const n of sheet?.notes ?? []) check(file, 'note', n);
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(300);
  });

  it('main table and definitions', () => {
    check(PAGES.main, 'title', data.main.title);
    for (const n of data.main.notes) check(PAGES.main, 'note', n);
    for (const r of data.main.rows) {
      check(PAGES.main, r.key, r.label);
      for (const id of BODY_IDS) checkVal(PAGES.main, `${r.key}.${id}`, r.values[id]);
    }
    const defs = data.definitions;
    for (const d of Object.values(defs.main)) {
      check(PAGES.mainNotes, 'term', d.term);
      check(PAGES.mainNotes, d.term, d.text);
    }
    for (const n of defs.notes?.main ?? []) check(PAGES.mainNotes, 'note', n);
    for (const d of [
      ...Object.values(defs.sheet),
      ...defs.related,
      ...Object.values(defs.unkeyed ?? {}).flat(),
    ]) {
      check(PAGES.sheetNotes, 'term', d.term);
      check(PAGES.sheetNotes, d.term, d.text);
    }
    for (const t of [...defs.sources, defs.caveat]) check(PAGES.sheetNotes, 'source', t);
    for (const [k, list] of Object.entries(defs.notes ?? {})) {
      if (k !== 'main') for (const n of list) check(PAGES.sheetNotes, `notes.${k}`, n);
    }
    const dated = { main: PAGES.mainNotes, ratio: PAGES.ratioNotes, sheet: PAGES.sheetNotes };
    for (const [k, file] of Object.entries(dated)) {
      const p = defs.pages[k as keyof typeof dated];
      check(file, `pages.${k}`, `Last Updated: ${p.lastUpdated},`);
      expect(p.url).toBe(`https://nssdc.gsfc.nasa.gov/planetary/factsheet/${file}`);
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(300);
  });

  it('has "^" only where fact_notes.html types it, and never leaves a double space', () => {
    // fact_notes.html writes powers as "10^24" (its "Sub- and Superscripts" note says so); every
    // other page uses <sup>, written as Unicode.
    const d = data.definitions;
    const elsewhere = {
      ...data,
      definitions: { ...d, sheet: {}, related: [], unkeyed: {}, notes: { main: d.notes?.main } },
    };
    expect(JSON.stringify(elsewhere)).not.toContain('^');
    expect(JSON.stringify(d.sheet)).toContain('^');
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/"[^"]*\s{2}[^"]*"/);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('(c) values read off the pages', () => {
  it('main table (index.html)', () => {
    expect(main('mass', 'mercury')).toEqual({ text: '0.330', value: 0.33 });
    expect(main('diameter', 'venus')).toEqual({ text: '12,104', value: 12104 });
    expect(main('rotationPeriod', 'venus')).toEqual({ text: '-5832.5', value: -5832.5 });
    expect(main('distanceFromSun', 'moon')).toEqual({ text: '0.384', value: 0.384, note: '*' });
    expect(main('orbitalPeriod', 'moon')).toEqual({ text: '27.3', value: 27.3, note: '*' });
    expect(main('surfacePressure', 'jupiter')).toEqual({ text: 'Unknown', value: null, note: '*' });
    expect(main('surfacePressure', 'pluto')).toEqual({ text: '0.00001', value: 0.00001 });
    expect(main('magneticField', 'pluto')).toEqual({ text: 'Unknown', value: null });
    expect(main('moons', 'saturn')).toEqual({ text: '274', value: 274 });
    expect(main('meanTemperature', 'neptune')).toEqual({ text: '-200', value: -200 });
    expect(main('distanceFromSun', 'pluto')).toEqual({ text: '5906.4', value: 5906.4 });
    expect(data.main.rows[0]).toMatchObject({ label: 'Mass (10²⁴kg)', unit: '10²⁴kg' });
    expect(data.main.rows.find((r) => r.key === 'orbitalEccentricity')?.unit).toBeUndefined();
    expect(data.main.title).toBe('Planetary Fact Sheet - Metric');
    expect(data.main.notes).toEqual(['* - See the Fact Sheet Notes.']);
  });

  it('Mercury', () => {
    expect(row('mercury', 'bulk', 'mass')).toEqual({
      key: 'mass',
      label: 'Mass (10²⁴ kg)',
      unit: '10²⁴ kg',
      body: { text: '0.33010', value: 0.3301 },
      earth: { text: '5.9722', value: 5.9722 },
      ratio: { text: '0.0553', value: 0.0553 },
    });
    expect(row('mercury', 'bulk', 'vMagnitude').ratio).toBeUndefined(); // printed "  -  "
    // The Earth column prints "-" and keeps it; the ratio column's "-" is left out (Row.ratio).
    expect(row('mercury', 'orbital', 'synodicPeriod')).toEqual({
      key: 'synodicPeriod',
      label: 'Synodic period (days)',
      unit: 'days',
      body: { text: '115.88', value: 115.88 },
      earth: { text: '-', value: null },
    });
    expect(row('mercury', 'observational', 'distanceFromEarthMin')).toEqual({
      key: 'distanceFromEarthMin',
      label: 'Minimum (10⁶ km)',
      group: 'Distance from Earth',
      unit: '10⁶ km',
      body: { text: '77.3', value: 77.3 },
    });
    expect(val('mercury', 'observational', 'inferiorConjunctionDistance')).toEqual({
      text: '91.69',
      value: 91.69,
    });
    expect(val('mercury', 'elements', 'meanLongitude')).toEqual({
      text: '252.25084',
      value: 252.25084,
    });
    // A pole formula states two numbers: no value (the text is the data).
    expect(val('mercury', 'pole', 'ra')).toEqual({ text: '281.010 - 0.033T', value: null });
    expect(row('mercury', 'pole', 'tDefinition')).toMatchObject({
      label: 'T',
      body: { text: 'Julian centuries from reference date', value: null },
    });
    // Printed as a bare line, with no "Model" label (Jupiter prints "Model GSFC-O₆").
    expect(row('mercury', 'magnetosphere', 'model')).toEqual({
      key: 'model',
      label: '',
      body: { text: 'MESSENGER Model 2010', value: null },
    });
    expect(row('mercury', 'magnetosphere', 'dipoleOffset').label).toBe('Dipole Offset');
    expect(val('mercury', 'magnetosphere', 'surfaceField')).toEqual({
      text: '0.0025 - 0.007 Gauss',
      value: null,
      range: [0.0025, 0.007],
    });
    expect(val('mercury', 'atmosphere', 'surfacePressure')).toEqual({
      text: '<~5 x 10⁻¹⁵ bar (0.005 picobar)',
      value: null,
      qualifier: '<~',
    });
    expect(val('mercury', 'atmosphere', 'atmosphereMass')).toEqual({
      text: '<~10000 kg',
      value: 10000,
      qualifier: '<~',
    });
  });

  it('Venus', () => {
    expect(val('venus', 'orbital', 'siderealRotation')).toEqual({
      text: '-5832.6',
      value: -5832.6,
    });
    expect(row('venus', 'orbital', 'obliquity').ratio).toBeUndefined();
    expect(row('venus', 'bulk', 'flattening')).toMatchObject({
      body: { text: '0.000', value: 0 },
      ratio: { text: '0.0', value: 0 },
    });
    expect(val('venus', 'atmosphere', 'surfacePressure')).toEqual({ text: '92 bars', value: 92 });
    expect(val('venus', 'atmosphere', 'surfaceDensity')).toEqual({
      text: '~65. kg/m³',
      value: 65,
      qualifier: '~',
    });
    expect(val('venus', 'atmosphere', 'windSpeeds')).toEqual({
      text: '0.3 to 1.0 m/s (surface)',
      value: null,
      range: [0.3, 1],
    });
    expect(keys(body('venus').pole)).toEqual(['ra', 'dec', 'referenceDate']);
    expect(body('venus').magnetosphere).toBeUndefined();
  });

  it('Earth', () => {
    expect(row('earth', 'bulk', 'equatorialRadius')).toEqual({
      key: 'equatorialRadius',
      label: 'Equatorial radius (km)',
      unit: 'km',
      body: { text: '6378.137', value: 6378.137 },
    });
    expect(val('earth', 'bulk', 'coreRadius')).toEqual({ text: '3485', value: 3485 });
    expect(row('earth', 'bulk', 'accelEquator').label).toBe('Surface acceleration (eq) (m/s²)');
    expect(val('earth', 'orbital', 'siderealRotation')).toEqual({
      text: '23.9345',
      value: 23.9345,
    });
    expect(val('earth', 'elements', 'ascendingNode')).toEqual({
      text: '-11.26064',
      value: -11.26064,
    });
    expect(val('earth', 'pole', 'dec')).toEqual({ text: '90.00 - 0.557T', value: null });
    expect(row('earth', 'magnetosphere', 'model')).toMatchObject({
      label: 'Model',
      body: { text: 'GSFC-1283' },
    });
    expect(val('earth', 'atmosphere', 'atmosphereMass')).toEqual({
      text: '5.1 x 10¹⁸ kg',
      value: 5.1e18,
    });
    expect(val('earth', 'atmosphere', 'hydrosphereMass')).toEqual({
      text: '1.4 x 10²¹ kg',
      value: 1.4e21,
    });
    expect(row('earth', 'magnetosphere', 'geocentricDipole')).toEqual({
      key: 'geocentricDipole',
      label: 'Geocentric Dipole',
      group: 'Geomagnetic Poles - Model WMM2020',
      body: { text: '80.65 N, 72.68 W', value: null },
    });
    expect(val('earth', 'magnetosphere', 'magneticNorthPole').text).toBe('86.50 N, 164.04 E');
    expect(val('earth', 'atmosphere', 'surfacePressure')).toEqual({ text: '1014 mb', value: 1014 });
    expect(body('earth').observational).toEqual([]);
  });

  it('Moon', () => {
    expect(body('moon').orbitalCaption).toBe('(for orbit about the Earth)');
    expect(row('moon', 'orbital', 'perigee')).toEqual({
      key: 'perigee',
      label: 'Perigee (10⁶ km)',
      unit: '10⁶ km',
      note: '*',
      body: { text: '0.3633', value: 0.3633 },
    });
    expect(row('moon', 'orbital', 'apogee')).toMatchObject({
      label: 'Apogee (10⁶ km)',
      note: '*',
    });
    expect(val('moon', 'orbital', 'apogee')).toEqual({ text: '0.4055', value: 0.4055 });
    expect(row('moon', 'orbital', 'revolutionPeriod')).toMatchObject({
      label: 'Revolution period (days)',
      body: { text: '27.3217', value: 27.3217 },
    });
    // NASA's notes define none of the three, so no Sun-relative definition reaches them.
    for (const k of ['perigee', 'apogee', 'revolutionPeriod'])
      expect(data.definitions.sheet[k], k).toBeUndefined();
    expect(val('moon', 'atmosphere', 'surfaceAbundance')).toEqual({
      text: '2 x 10⁵ particles/cm³',
      value: 2e5,
    });
    expect(row('moon', 'orbital', 'inclination')).toMatchObject({
      label: 'Inclination to ecliptic (deg)',
      body: { text: '5.145', value: 5.145 },
    });
    expect(val('moon', 'orbital', 'inclinationToEarthEquator')).toEqual({
      text: '18.28 - 28.58',
      value: null,
      range: [18.28, 28.58],
    });
    expect(val('moon', 'orbital', 'recessionRate')).toEqual({ text: '3.8', value: 3.8 });
    expect(row('moon', 'bulk', 'accelEquator').label).toBe('Surface acceleration (m/s²)');
    expect(row('moon', 'bulk', 'gravity').earth).toEqual({ text: '9.80', value: 9.8 });
    expect(row('moon', 'observational', 'oppositionDistanceEquator')).toEqual({
      key: 'oppositionDistanceEquator',
      label: 'Distance from Earth (equator, km)',
      group: 'Mean values at opposition from Earth',
      unit: 'km',
      body: { text: '378,000', value: 378000 },
    });
    expect(val('moon', 'atmosphere', 'atmosphereMass')).toEqual({
      text: '~25,000 kg',
      value: 25000,
      qualifier: '~',
    });
    expect(body('moon').pole).toBeUndefined();
  });

  it('Mars', () => {
    expect(val('mars', 'bulk', 'mass')).toEqual({ text: '0.64169', value: 0.64169 });
    expect(val('mars', 'bulk', 'coreRadius')).toEqual({ text: '1830', value: 1830, note: '**' });
    expect(row('mars', 'orbital', 'tropicalPeriod')).toMatchObject({
      label: 'Tropical orbit period (days)',
      note: '*',
      body: { text: '686.972', value: 686.972 },
    });
    expect(val('mars', 'atmosphere', 'surfacePressure').text).toBe(
      '6.36 mb at mean radius (variable from 4.0 to 8.7 mb depending on season) [6.9 mb to 9 mb (Viking 1 Lander site)]',
    );
    expect(val('mars', 'observational', 'maxApparentMagnitude')).toEqual({
      text: '-2.94',
      value: -2.94,
    });
    // "(I/MR²)" names the dimensionless ratio the value is; it is not a unit to print after it.
    expect(row('mars', 'bulk', 'momentOfInertia')).toEqual({
      key: 'momentOfInertia',
      label: 'Moment of inertia (I/MR²)',
      body: { text: '0.366', value: 0.366 },
      earth: { text: '0.3308', value: 0.3308 },
      ratio: { text: '1.106', value: 1.106 },
    });
    expect(val('mars', 'atmosphere', 'atmosphereMass')).toEqual({
      text: '~2.5 x 10¹⁶ kg',
      value: 2.5e16,
      qualifier: '~',
    });
    expect(row('mars', 'orbital', 'synodicPeriod').earth).toEqual({ text: '-', value: null });
    expect(row('mars', 'orbital', 'synodicPeriod').ratio).toBeUndefined();
  });

  it('Satellites of Mars', () => {
    const [block, ...more] = body('mars').satellites ?? [];
    expect(more).toEqual([]);
    expect(block?.caption).toBe('Satellites of Mars');
    // The footnote of "Semimajor axis*" belongs to the table, not to the page.
    expect(block?.notes).toEqual(['*Mean orbital distance from the center of Mars.']);
    expect(body('mars').footnotes.join(' ')).not.toContain('center of Mars');
    const [phobos, deimos] = block?.satellites ?? [];
    expect(phobos?.name).toBe('Phobos');
    expect(deimos?.name).toBe('Deimos');
    expect(phobos?.rows[0]).toEqual({
      key: 'semimajorAxis',
      label: 'Semimajor axis (km)',
      unit: 'km',
      note: '*',
      body: { text: '9378', value: 9378 },
    });
    const of = (m: typeof phobos, k: string) => m?.rows.find((r) => r.key === k);
    expect(of(deimos, 'semimajorAxis')?.body).toEqual({ text: '23459', value: 23459 });
    expect(of(phobos, 'mass')).toMatchObject({
      label: 'Mass (10¹⁵ kg)',
      unit: '10¹⁵ kg',
      body: { text: '10.6', value: 10.6 },
    });
    expect(of(deimos, 'siderealPeriod')?.body).toEqual({ text: '1.26244', value: 1.26244 });
    expect(of(phobos, 'subplanetaryRadius')?.body).toEqual({ text: '13.0', value: 13 });
    expect(of(deimos, 'vMagnitude')?.body).toEqual({ text: '+12.89', value: 12.89 });
    expect(of(deimos, 'apparentMagnitude')).toEqual({
      key: 'apparentMagnitude',
      label: 'Apparent visual magnitude (V₀)',
      body: { text: '12.40', value: 12.4 },
    });
    expect(phobos?.rows.map((r) => r.key)).toEqual(deimos?.rows.map((r) => r.key));
  });

  it('Jupiter', () => {
    expect(val('jupiter', 'bulk', 'mass')).toEqual({ text: '1,898.13', value: 1898.13 });
    expect(row('jupiter', 'bulk', 'equatorialRadius')).toMatchObject({
      label: 'Equatorial radius (1 bar level) (km)',
      body: { text: '71,492', value: 71492 },
      earth: { text: '6,378.1', value: 6378.1 },
    });
    expect(row('jupiter', 'bulk', 'flattening').label).toBe('Ellipticity');
    expect(val('jupiter', 'orbital', 'siderealRotation')).toEqual({
      text: '9.9250',
      value: 9.925,
      note: '*',
    });
    expect(val('jupiter', 'pole', 'dec')).toEqual({ text: '64.495 + 0.002T', value: null });
    expect(row('jupiter', 'magnetosphere', 'model')).toMatchObject({
      label: 'Model',
      body: { text: 'GSFC-O₆' },
    });
    expect(row('jupiter', 'bulk', 'momentOfInertia').unit).toBeUndefined();
    expect(row('jupiter', 'orbital', 'synodicPeriod').earth).toEqual({ text: '-', value: null });
    expect(val('jupiter', 'magnetosphere', 'tiltLongitude')).toEqual({
      text: '200.1 degrees',
      value: 200.1,
    });
    expect(val('jupiter', 'atmosphere', 'surfacePressure')).toEqual({
      text: '>>1000 bars',
      value: 1000,
      qualifier: '>>',
    });
    expect(val('jupiter', 'atmosphere', 'windSpeeds').text).toBe(
      'Up to 150 m/s (<30 degrees latitude) Up to 40 m/s (>30 degrees latitude)',
    );
  });

  it('Saturn', () => {
    expect(val('saturn', 'bulk', 'equatorialRadius')).toEqual({ text: '60,268', value: 60268 });
    expect(val('saturn', 'bulk', 'j2')).toEqual({ text: '16,298.', value: 16298 });
    expect(val('saturn', 'orbital', 'siderealRotation')).toEqual({
      text: '10.656',
      value: 10.656,
      note: '*',
    });
    expect(keys(body('saturn').orbital)).not.toContain('equatorInclination'); // not printed for Saturn
    expect(val('saturn', 'observational', 'maxApparentMagnitude')).toEqual({
      text: '0.43',
      value: 0.43,
    });
    expect(row('saturn', 'observational', 'oppositionMagnitudeWithRings')).toMatchObject({
      group: 'Mean values at opposition including rings',
      body: { text: '0.05', value: 0.05 },
    });
    expect(row('saturn', 'observational', 'maxApparentMagnitudeWithRings')).toEqual({
      key: 'maxApparentMagnitudeWithRings',
      label: 'Maximum apparent visual magnitude',
      body: { text: '-0.55', value: -0.55 },
    });
    expect(val('saturn', 'magnetosphere', 'dipoleTilt')).toEqual({ text: '0.0', value: 0 });
    expect(val('saturn', 'pole', 'ra')).toEqual({ text: '40.589 - 0.036T', value: null });
    expect(val('saturn', 'pole', 'dec')).toEqual({ text: '83.537 - 0.004T', value: null });
    expect(row('saturn', 'orbital', 'synodicPeriod').earth).toEqual({ text: '-', value: null });
  });

  it('Uranus', () => {
    expect(val('uranus', 'orbital', 'siderealRotation')).toEqual({
      text: '-17.24',
      value: -17.24,
      note: '*',
    });
    expect(row('uranus', 'orbital', 'obliquity')).toMatchObject({
      body: { text: '97.77', value: 97.77 },
    });
    expect(row('uranus', 'orbital', 'obliquity').ratio).toBeUndefined();
    expect(val('uranus', 'pole', 'dec')).toEqual({ text: '-15.175', value: -15.175 });
    expect(val('uranus', 'magnetosphere', 'dipoleTilt')).toEqual({
      text: '58.6 degrees',
      value: 58.6,
    });
    expect(val('uranus', 'magnetosphere', 'surfaceField')).toEqual({
      text: '~0.1 - 1.0 Gauss',
      value: null,
      qualifier: '~',
      range: [0.1, 1],
    });
    expect(val('uranus', 'observational', 'discoverer').text).toBe('William Herschel');
    expect(val('uranus', 'observational', 'discoveryDate').text).toBe('13 March 1781');
    expect(val('uranus', 'atmosphere', 'windSpeeds')).toEqual({
      text: '0-250 m/s',
      value: null,
      range: [0, 250],
    });
    expect(val('uranus', 'pole', 'ra')).toEqual({ text: '257.311', value: 257.311 }); // a number
    expect(row('uranus', 'orbital', 'synodicPeriod').earth).toEqual({ text: '-', value: null });
  });

  it('Neptune', () => {
    expect(val('neptune', 'magnetosphere', 'dipoleOffset')).toEqual({
      text: '0.485 Rn',
      value: 0.485,
    });
    expect(val('neptune', 'magnetosphere', 'tiltLongitude')).toEqual({
      text: '288 degrees (IAU convention)',
      value: 288,
    });
    // Formulas in N, and N a formula in T: no value, and "43.46 - 0.51 cos N" is not a range.
    expect(val('neptune', 'pole', 'ra')).toEqual({ text: '299.36 + 0.70 sin N', value: null });
    expect(val('neptune', 'pole', 'dec')).toEqual({ text: '43.46 - 0.51 cos N', value: null });
    expect(row('neptune', 'pole', 'nDefinition')).toEqual({
      key: 'nDefinition',
      label: 'N',
      body: { text: '357.85 + 52.316T degrees', value: null },
    });
    expect(val('neptune', 'observational', 'discoverer').text).toBe(
      'Johann Gottfried Galle (based on predictions by John Couch Adams and Urbain Leverrier)',
    );
    expect(keys(body('neptune').bulk)).not.toContain('momentOfInertia'); // not printed for Neptune
    expect(row('neptune', 'bulk', 'blackBodyTemperature').earth).toEqual({
      text: '254.3',
      value: 254.3,
    });
    expect(val('neptune', 'atmosphere', 'scaleHeight')).toEqual({
      text: '19.1 - 20.3 km',
      value: null,
      range: [19.1, 20.3],
    });
  });

  it('Pluto', () => {
    expect(val('pluto', 'orbital', 'obliquity')).toEqual({ text: '119.51', value: 119.51 });
    expect(val('pluto', 'orbital', 'tropicalPeriod')).toEqual({ text: 'Unknown', value: null });
    expect(row('pluto', 'bulk', 'gravity').label).toBe('Surface Gravity (mean) (m/s²)');
    expect(row('pluto', 'elements', 'meanLongitude')).toMatchObject({
      label: 'Mean longitude (deg)',
      body: { text: '238.92881', value: 238.92881 },
    });
    expect(body('pluto').poleCaption).toBe('Positive Pole of Rotation');
    expect(val('pluto', 'pole', 'dec')).toEqual({ text: '-6.16', value: -6.16 });
    expect(val('pluto', 'atmosphere', 'surfacePressure')).toEqual({
      text: '~13 microbar',
      value: 13,
      qualifier: '~',
    });
    expect(val('pluto', 'atmosphere', 'surfaceTemperature')).toEqual({
      text: '24 - 38 K (-247 - -233 C)',
      value: null,
    });
  });

  it('Moons of Pluto', () => {
    const [charon, others, ...more] = body('pluto').satellites ?? [];
    expect(more).toEqual([]);
    expect(charon?.caption).toBe('Charon (P1)');
    expect(charon?.notes).toEqual([]);
    const [c] = charon?.satellites ?? [];
    expect(c?.name).toBe('Charon (P1)');
    expect(c?.rows.map((r) => [r.key, r.label, r.unit ?? null, r.body.text])).toEqual([
      ['meanDistance', 'Mean distance from Pluto (km)', 'km', '19,596'],
      ['siderealPeriod', 'Sidereal orbit period (days)', 'days', '6.3872'],
      ['siderealRotation', 'Sidereal rotation period (days)', 'days', '6.3872'],
      ['inclinationToPluto', 'Orbital inclination to Pluto (deg)', 'deg', '0.00005'],
      ['eccentricity', 'Orbital eccentricity', null, '0.0'],
      ['equatorialRadius', 'Equatorial radius (km)', 'km', '606'],
      ['mass', 'Mass (10²¹ kg)', '10²¹ kg', '1.586'],
      ['density', 'Mean density (kg/m³)', 'kg/m³', '1700'],
      ['gravity', 'Surface gravity (m/s²)', 'm/s²', '0.29'],
      ['escapeVelocity', 'Escape velocity (km/s)', 'km/s', '0.59'],
      ['geometricAlbedo', 'Geometric Albedo', null, '0.42'],
      ['bondAlbedo', 'Bond Albedo', null, '0.25'],
      ['apparentMagnitude', 'Apparent visual magnitude', null, '16.8'],
    ]);
    expect(c?.rows[0]?.body).toEqual({ text: '19,596', value: 19596 });
    // The caveat printed under the table is the table's: Pluto's own orbit is not barycentric.
    expect(others?.caption).toBe('Other Moons of Pluto');
    expect(others?.notes).toEqual(['Orbital values are barycentric']);
    expect(body('pluto').footnotes).toEqual([]);
    expect(others?.satellites.map((m) => [m.name, ...m.rows.map((r) => r.body.text)])).toEqual([
      ['Styx (P5)', '42,413', '20.16', '3.24', '10.5', '0.65'],
      ['Nix (P2)', '48,690', '24.85', '1.83', '48.4 x 33.8 x 31.4', '0.56'],
      ['Kerberos (P4)', '57,750', '32.17', '5.31', '19 x 10 x 9', '0.56'],
      ['Hydra (P3)', '64,721', '38.20', '0.43', '62.0 x 36.5 x 29.3', '0.83'],
    ]);
    const hydra = others?.satellites[3];
    expect(hydra?.rows.map((r) => [r.key, r.label])).toEqual([
      ['semimajorAxis', 'Semi-Major Axis (km)'],
      ['orbitalPeriod', 'Orbital Period (days)'],
      ['rotationPeriod', 'Rotation Period (days)'],
      ['meanDiameter', 'Mean Diameter (km)'],
      ['geometricAlbedo', 'Geometric Albedo'],
    ]);
    expect(hydra?.rows[0]?.body).toEqual({ text: '64,721', value: 64721 });
    expect(hydra?.rows[3]?.body).toEqual({ text: '62.0 x 36.5 x 29.3', value: null }); // three axes
  });

  it('footnotes of every page, verbatim', () => {
    expect(Object.fromEntries(BODY_IDS.map((id) => [id, body(id).footnotes]))).toEqual({
      mercury: [],
      venus: [],
      earth: [
        'Note that the acceleration values given are for the equator and pole.',
        'The standard acceleration of gravity for Earth is defined (CODATA 2018) as 9.80665 m/s² (exact).',
      ],
      moon: [
        '* These represent mean apogee and perigee for the lunar orbit, and were used for calculating the maximum and minimum velocities. The orbit changes over the course of the year so the distance from the Moon to Earth roughly ranges from 357,000 km to 407,000 km, giving velocities ranging from 1.100 to 0.966 km/s.',
      ],
      mars: [
        '** Recent results indicate the radius of the core of Mars may only be 1650 - 1675 km.',
        '* Mean value - the tropical orbit period for Mars can vary from this by up to 0.004 days depending on the initial point of the orbit.',
      ],
      jupiter: ['* System III (1965.0) coordinates'],
      saturn: ['* Saturnian System III coordinates'],
      uranus: ['* Magnetic coordinates (as determined by the Voyager 2 Radio Science experiment)'],
      neptune: ['* Magnetic coordinates (as determined by the Voyager 2 Radio Science experiment)'],
      pluto: [],
    });
  });

  it('magnetosphere notes of every page, verbatim', () => {
    // Printed inside the magnetosphere block, under its rows: the model radius the rows are in
    // (Saturn's in the same paragraph as its caveat), so they are the block's, not page footnotes.
    expect(
      Object.fromEntries(BODY_IDS.map((id) => [id, body(id).magnetosphereNotes ?? null])),
    ).toEqual({
      mercury: ['Rh denotes Mercurian model radius, here defined to be 2,440 km'],
      venus: null,
      earth: ['Re denotes Earth model radius, here defined to be 6,378 km'],
      moon: null,
      mars: null,
      jupiter: ['Rj denotes Jovian model radius, defined here to be 71,398 km'],
      saturn: [
        "Saturn's magnetic field has significant quadrapole and octapole moments, making approximation of the central field as an offset dipole difficult.",
        'Rs denotes Saturnian model radius, defined here to be 60,330 km',
      ],
      uranus: ['Ru denotes Uranian model radius, here defined to be 25,600 km'],
      neptune: ['Rn denotes Neptunian model radius, here defined to be 24,765 km'],
      pluto: null,
    });
  });

  it('atmospheric composition of every body, gas by gas', () => {
    // [group, name, formula, amount as printed, unit, uncertainty]
    expect(gasList('mercury')).toEqual(
      [
        ['Sodium', '12,000-200,000'],
        ['Magnesium', '100,000'],
        ['Oxygen', '<40,000'],
        ['Hydrogen', '5000'],
        ['Potassium', '800-1300'],
        ['Calcium', '300-1000'],
        ['Iron', '<300'],
        ['Aluminum', '15'],
      ].map(([n, a]) => ['other', n, null, a, '10⁶ per cm²', null]),
    );
    expect(gasList('venus')).toEqual([
      ['major', 'Carbon Dioxide', 'CO₂', '96.5', '%', null],
      ['major', 'Nitrogen', 'N₂', '3.5', '%', null],
      ['minor', 'Sulfur Dioxide', 'SO₂', '150', 'ppm', null],
      ['minor', 'Argon', 'Ar', '70', 'ppm', null],
      ['minor', 'Water', 'H₂O', '20', 'ppm', null],
      ['minor', 'Carbon Monoxide', 'CO', '17', 'ppm', null],
      ['minor', 'Helium', 'He', '12', 'ppm', null],
      ['minor', 'Neon', 'Ne', '7', 'ppm', null],
    ]);
    expect(gasList('earth')).toEqual([
      ['major', 'Nitrogen', 'N₂', '78.08', '%', null],
      ['major', 'Oxygen', 'O₂', '20.95', '%', null],
      ['minor', 'Argon', 'Ar', '9340', 'ppm', null],
      ['minor', 'Carbon Dioxide', 'CO₂', '420', 'ppm', null],
      ['minor', 'Neon', 'Ne', '18.18', 'ppm', null],
      ['minor', 'Helium', 'He', '5.24', 'ppm', null],
      ['minor', '', 'CH₄', '1.94', 'ppm', null], // printed as a formula only: no name
      ['minor', 'Krypton', 'Kr', '1.14', 'ppm', null],
      ['minor', 'Hydrogen', 'H₂', '0.55', 'ppm', null],
    ]);
    expect(gasList('moon')).toEqual(
      [
        ['Helium 4', '⁴He', '40,000'],
        ['Neon 20', '²⁰Ne', '40,000'],
        ['Hydrogen', 'H₂', '35,000'],
        ['Argon 40', '⁴⁰Ar', '30,000'],
        ['Neon 22', '²²Ne', '5,000'],
        ['Argon 36', '³⁶Ar', '2,000'],
        ['Methane', null, '1000'],
        ['Ammonia', null, '1000'],
        ['Carbon Dioxide', 'CO₂', '1000'],
      ].map(([n, f, a]) => ['other', n, f, a, 'particles per cubic cm', null]),
    );
    expect(gasList('mars')).toEqual([
      ['major', 'Carbon Dioxide', 'CO₂', '95.1', '%', null],
      ['major', 'Nitrogen', 'N₂', '2.59', '%', null],
      ['major', 'Argon', 'Ar', '1.94', '%', null],
      ['major', 'Oxygen', 'O₂', '0.16', '%', null],
      ['major', 'Carbon Monoxide', 'CO', '0.06', '%', null],
      ['minor', 'Water', 'H₂O', '210', 'ppm', null],
      ['minor', 'Nitrogen Oxide', 'NO', '100', 'ppm', null],
      ['minor', 'Neon', 'Ne', '2.5', 'ppm', null],
      ['minor', 'Hydrogen-Deuterium-Oxygen', 'HDO', '0.85', 'ppm', null],
      ['minor', 'Krypton', 'Kr', '0.3', 'ppm', null],
      ['minor', 'Xenon', 'Xe', '0.08', 'ppm', null],
    ]);
    expect(gasList('jupiter')).toEqual([
      ['major', 'Molecular hydrogen', 'H₂', '89.8', '%', '2.0%'],
      ['major', 'Helium', 'He', '10.2', '%', '2.0%'],
      ['minor', 'Methane', 'CH₄', '3000', 'ppm', '1000'],
      ['minor', 'Ammonia', 'NH₃', '260', 'ppm', '40'],
      ['minor', 'Hydrogen Deuteride', 'HD', '28', 'ppm', '10'],
      ['minor', 'Ethane', 'C₂H₆', '5.8', 'ppm', '1.5'],
      ['minor', 'Water', 'H₂O', '4', 'ppm', 'varies with pressure'],
    ]);
    expect(gasList('saturn')).toEqual([
      ['major', 'Molecular hydrogen', 'H₂', '96.3', '%', '2.4%'],
      ['major', 'Helium', 'He', '3.25', '%', '2.4%'],
      ['minor', 'Methane', 'CH₄', '4500', 'ppm', '2000'],
      ['minor', 'Ammonia', 'NH₃', '125', 'ppm', '75'], // broken over two lines on the page
      ['minor', 'Hydrogen Deuteride', 'HD', '110', 'ppm', '58'],
      ['minor', 'Ethane', 'C₂H₆', '7', 'ppm', '1.5'],
    ]);
    expect(gasList('uranus')).toEqual([
      ['major', 'Molecular hydrogen', 'H₂', '82.5', '%', '3.3%'],
      ['major', 'Helium', 'He', '15.2', '%', '3.3%'],
      ['major', 'Methane', 'CH₄', '2.3', '%', null],
      ['minor', 'Hydrogen Deuteride', 'HD', '148', 'ppm', null],
    ]);
    expect(gasList('neptune')).toEqual([
      ['major', 'Molecular hydrogen', 'H₂', '80.0', '%', '3.2%'],
      ['major', 'Helium', 'He', '19.0', '%', '3.2%'],
      ['major', 'Methane', 'CH₄', '1.5', '%', '0.5%'], // printed without the " - "
      ['minor', 'Hydrogen Deuteride', 'HD', '192', 'ppm', null],
      ['minor', 'Ethane', 'C₂H₆', '1.5', 'ppm', null],
    ]);
    expect(gasList('pluto')).toEqual([
      ['other', 'Nitrogen', 'N₂', '99', '%', null],
      ['other', 'Methane', 'CH₄', '0.5', '%', null],
      ['other', 'Carbon Monoxide', 'CO', '0.05', '%', null],
    ]);
    expect(body('earth').composition?.gases[0]?.amount).toEqual({ text: '78.08', value: 78.08 });
    expect(body('mercury').composition?.gases[0]?.amount).toEqual({
      text: '12,000-200,000',
      value: null,
      range: [12000, 200000],
    });
    expect(body('mercury').composition?.gases[2]?.amount).toEqual({
      text: '<40,000',
      value: 40000,
      qualifier: '<',
    });
  });

  it('composition headings and remarks', () => {
    const basis = Object.fromEntries(BODY_IDS.map((id) => [id, body(id).composition?.basis]));
    expect(basis).toEqual({
      mercury: 'Atmospheric composition (Column abundances in 10⁶ per cm²):',
      venus: 'Atmospheric composition (near surface, by volume):',
      earth: 'Atmospheric composition (by volume, dry air):',
      moon: 'Estimated Composition (night, particles per cubic cm):',
      mars: 'Atmospheric composition (by volume):',
      jupiter: 'Atmospheric composition (by volume, uncertainty in parentheses)',
      saturn: 'Atmospheric composition (by volume, uncertainty in parentheses)',
      uranus: 'Atmospheric composition (by volume, uncertainty in parentheses)',
      neptune: 'Atmospheric composition (by volume, uncertainty in parentheses)',
      pluto: 'Atmospheric composition:',
    });
    const remarks = Object.fromEntries(BODY_IDS.map((id) => [id, body(id).composition?.remarks]));
    expect(remarks).toEqual({
      mercury: [
        'possible trace amounts of Argon (Ar), Carbon Dioxide (CO₂), Water (H₂O), Nitrogen (N₂), Xenon (Xe), Krypton (Kr), Neon (Ne), Helium (He)',
        '(The atmosphere of Mercury is a surface bounded exosphere, essentially a vacuum. Values for some species can vary with local time or location, these are given as ranges.)',
      ],
      venus: [],
      earth: [
        'Numbers do not add up to exactly 100% due to roundoff and uncertainty',
        'Water is highly variable, typically makes up about 1%',
      ],
      moon: [
        'Trace Oxygen (O⁺), Aluminum (Al⁺), Silicon (Si⁺)',
        'Possible Phosphorus (P⁺), Sodium (Na⁺), Magnesium (Mg⁺)',
        'Composition of the tenuous lunar atmosphere is poorly known and variable, these are estimates of the upper limits of the nighttime ambient atmosphere composition. Daytime levels were difficult to measure due to heating and outgassing of Apollo surface experiments.',
      ],
      mars: [],
      jupiter: ['Aerosols: Ammonia ice, water ice, ammonia hydrosulfide'],
      saturn: ['Aerosols: Ammonia ice, water ice, ammonia hydrosulfide'],
      uranus: ['Aerosols: Ammonia ice, water ice, ammonia hydrosulfide, methane ice(?)'],
      neptune: ['Aerosols: Ammonia ice, water ice, ammonia hydrosulfide, methane ice(?)'],
      pluto: ['trace HCN, C₂Hₓ hydrocarbons'],
    });
  });

  it('rings', () => {
    expect(body('jupiter').rings?.headers).toEqual([
      'Radius (km)',
      'Radius/Eq. radius',
      'Thickness (km)',
      'Optical Depth',
      'Albedo',
      'Surf. Density (g/cm²)',
    ]);
    expect(ring('jupiter', 'Jupiter Equator')).toEqual({
      name: 'Jupiter Equator',
      radius: { text: '71,492', value: 71492 },
      ratio: { text: '1.000', value: 1 },
      columns: {},
    });
    expect(ring('jupiter', 'Halo')?.radius).toEqual({
      text: '89,400 - 123,000',
      value: null,
      range: [89400, 123000],
    });
    expect(ring('jupiter', 'Main Ring')?.columns['Thickness (km)']).toEqual({
      text: '<~100',
      value: 100,
      qualifier: '<~',
    });
    expect(ring('jupiter', 'Main Ring')?.columns).toEqual({
      'Thickness (km)': { text: '<~100', value: 100, qualifier: '<~' },
      'Optical Depth': { text: '5 x 10⁻⁶', value: 5e-6 },
      Albedo: { text: '~0.015', value: 0.015, qualifier: '~' },
      'Surf. Density (g/cm²)': { text: '5 x 10⁻⁶', value: 5e-6 },
    });
    expect(ring('jupiter', 'Halo')?.columns['Optical Depth']).toEqual({
      text: '3 x 10⁻⁶',
      value: 3e-6,
    });
    for (const name of ['Amalthea Ring', 'Thebe Ring', 'Thebe Extension'])
      expect(ring('jupiter', name)?.columns['Optical Depth'], name).toEqual({
        text: '1 x 10⁻⁷',
        value: 1e-7,
      });
    expect(ring('saturn', 'B outer edge')?.radius).toEqual({ text: '117,507', value: 117507 });
    expect(ring('saturn', 'Cassini division')).toMatchObject({
      radius: { text: '', value: null },
      ratio: { text: '', value: null },
    });
    expect(ring('saturn', 'D inner edge')?.columns).toEqual({
      'Optical Depth': { text: '10⁻⁵', value: 1e-5 },
    });
    expect(ring('saturn', 'G inner edge')?.columns).toMatchObject({
      'Optical Depth': { text: '10⁻⁶', value: 1e-6 },
      'Thickness (m)': { text: '10⁵', value: 1e5 },
    });
    expect(ring('saturn', 'E outer edge')?.columns['Thickness (m)']).toEqual({
      text: '10⁷',
      value: 1e7,
    });
    expect(Object.keys(ring('saturn', 'Titan ringlet')?.columns ?? {})).toEqual([
      'Surf. Density (g/cm²)',
      'Eccentricity',
    ]);
    expect(body('uranus').rings?.rings.map((r) => r.name)).toEqual([
      'Uranus equator',
      '6',
      '5',
      '4',
      'Alpha',
      'Beta',
      'Eta',
      'Gamma',
      'Delta',
      'Lambda',
      'Epsilon',
      'R/2003 U 2',
      'R/2003 U 1',
    ]);
    expect(ring('uranus', 'Eta')?.columns['Optical Depth']).toEqual({
      text: '~0.4-',
      value: 0.4,
      qualifier: '~',
    });
    expect(ring('uranus', 'Gamma')?.columns['Optical Depth']).toEqual({
      text: '~0.3+',
      value: 0.3,
      qualifier: '~',
    });
    expect(ring('uranus', 'Epsilon')?.columns['Optical Depth']).toEqual({
      text: '0.5-2.3',
      value: null,
      range: [0.5, 2.3],
    });
    expect(ring('uranus', 'Lambda')?.columns['Eccentricity']).toEqual({ text: '0.', value: 0 });
    expect(ring('neptune', 'Galle (1989N3R)')?.radius).toEqual({
      text: '~41,900',
      value: 41900,
      qualifier: '~',
    });
    expect(ring('neptune', 'Neptune equator')?.radius).toEqual({ text: '24,766', value: 24766 });
    expect(ring('neptune', 'Arago (1989N4R*)')?.columns).toEqual({
      'Optical Depth': { text: '< 100', value: 100, qualifier: '<' }, // in this column on NASA's page
    });
    expect(ring('neptune', 'Adams (1989N1R)')?.group).toBeUndefined();
    expect(
      body('neptune')
        .rings?.rings.filter((r) => r.group === 'Arcs in Adams Ring')
        .map((r) => r.name),
    ).toEqual(['Courage', 'Liberté', 'Egalité 1', 'Egalité 2', 'Fraternité']);
    expect(body('neptune').rings?.notes).toEqual([
      '(*Lassell and Arago were originally identified as one ring, designated 1989N4R)',
      'For more details on the rings of Neptune, see the PDS Rings Node Vital Statistics.',
    ]);
    expect(body('saturn').rings?.notes[0]).toBe(
      'Rings, ringlets and gaps of width less than 1000 km are listed by inner edge radius.',
    );
  });

  it('definitions', () => {
    const d = data.definitions;
    expect(Object.keys(d.main)).toEqual(data.main.rows.map((r) => r.key));
    expect(d.main.mass?.term).toBe('Mass (10²⁴kg or 10²¹tons)');
    expect(d.main.distanceFromSun?.text).toMatch(
      / \* For the Moon, the average distance from the Earth is given\.$/,
    );
    expect(d.main.perihelion).toEqual(d.main.aphelion);
    expect(d.main.perihelion?.term).toBe('Perihelion, Aphelion (10⁶ km or 10⁶ miles)');
    expect(d.main.obliquity?.text).toContain('*Venus rotates in a retrograde direction');
    expect(d.sheet.momentOfInertia?.term).toBe('Moment of inertia (C/MR²)');
    // Verbatim: fact_notes.html types its powers with a caret (and says so, notes.subAndSuperscripts).
    expect(d.sheet.mass?.text).toBe(
      'Mass of the body in 10^24 kilograms [GM(measured)/G(CODATA 2018 - see below)]',
    );
    expect(d.sheet.momentOfInertia?.text).toContain(
      "divided by the body's mass x radius^2, where radius^2 = {2(R_equator^2) + R_polar^2}/3.",
    );
    expect(d.sheet.dipoleTilt).toEqual({
      term: 'Dipole tilt to rotational axis',
      text: 'Tilt of the dipole axis to the axis of rotation in degrees.',
    });
    expect(d.sheet.surfaceField?.term).toBe('Surface field strength');
    expect(d.sheet.meanLongitude?.term).toBe('Mean longitude (deg)');
    for (const k of [
      'dipoleFieldStrength',
      'dipoleOffset',
      'surfacePressure',
      'windSpeeds',
      'composition',
    ]) {
      expect(d.sheet[k], k).toBeDefined();
    }
    expect(d.related[0]).toEqual({
      term: 'Astronomical Unit (AU)',
      text: 'The standard distance from the Sun to the Earth = 149,597,870.7 km.',
    });
    expect(d.related.find((r) => r.term === 'Bar')?.text).toBe(
      'A measure of pressure or stress. 1 bar = 10^5 Pascal (Pa) = 10^5 kg m^-1 s^-2',
    );
    // Exactly the page's "Related Definitions"; terms defined in other sections are filed there.
    expect(d.related.map((r) => r.term)).toEqual([
      'Astronomical Unit (AU)',
      'Bar',
      'Ecliptic',
      'Equinox',
      'Gravitational Constant (G)',
      'Julian Day (JD)',
      'Opposition',
      'Phase Angle',
    ]);
    expect(Object.keys(d.unkeyed ?? {})).toEqual(['bulk', 'elements']);
    expect(d.unkeyed?.bulk).toEqual([
      {
        term: 'Absolute magnitude (Comets)',
        text: 'The magnitude of the comet at 1 AU for Y = 10, where Y is the photometric parameter giving the observed dependence of the magnitude on heliocentric distance, also designated H(10).',
      },
    ]);
    expect(d.unkeyed?.elements?.map((t) => t.term)).toEqual(['Longitude']);
    expect(d.unkeyed?.elements?.[0]?.text).toMatch(
      /^The point in a body's orbit around the Sun, defined from 0 to 360 degrees\. .* at a longitude of 180 degrees\.$/,
    );
    expect(d.sources).toHaveLength(7);
    expect(d.sources[0]).toBe('IAU/IAG Working Group Report, 2006, 2015');
    // "Most values", not all: the sentence that introduces the list is kept with the notes.
    expect(d.notes?.intro).toEqual([
      'Most values listed in the factsheets are from the following sources:',
    ]);
    expect(d.caveat).toMatch(
      /^Note that the values listed on the factsheets are not "official" values,/,
    );
    expect(d.notes?.subAndSuperscripts).toEqual([
      "In the explanation of units, we've included a description of the units in the form where, for example, 10^24 equals 10 to the 24 power.",
    ]);
    expect(d.notes?.orbital?.[0]).toContain('referenced to Julian Date 2459000.5 (11 June 2020)');
    expect(d.notes?.main).toEqual([
      'The term "terrestrial planets" refers to Mercury, Venus, Earth, Moon, Mars, and Pluto.',
      'The term "gas giants" refers to Jupiter, Saturn, Uranus, and Neptune.',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('(d) numbers are the numbers their text states', () => {
  const NUM = String.raw`[+-]?[\d,]*\d(?:\.\d*)?`;
  const fresh = buildFactSheet();

  /** Every Val in the sheet, found structurally ({ text: string, value }), with its path. */
  function vals(node: unknown, path: string, out: [string, Val][] = []): [string, Val][] {
    if (Array.isArray(node)) node.forEach((n, i) => vals(n, `${path}[${i}]`, out));
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.text === 'string' && 'value' in o) out.push([path, o as unknown as Val]);
      else for (const [k, v] of Object.entries(o)) vals(v, `${path}.${k}`, out);
    }
    return out;
  }
  const all = vals(fresh, 'factsheet');
  const bare = (text: string): string => text.replace(/^(<~|>>|<<|~|<|>)\s*/, '');
  const num = (s: string): number => Number(s.replace(/,/g, ''));
  /** "[a x ]10ⁿ" at the start of a text: a power of ten, with its mantissa ("1" when bare). */
  const POWER = /^(?:([+-]?[\d,]*\d(?:\.\d*)?)\s*x\s*)?10([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/;
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  /** The number a text starts with, read independently of the parser: "3 x 10⁻⁶" → 3e-6. */
  function leading(text: string): number | undefined {
    const p = POWER.exec(bare(text));
    if (p) {
      const exp = [...(p[2] ?? '')]
        .map((c) => (c === '⁻' ? '-' : c === '⁺' ? '+' : String(SUP.indexOf(c))))
        .join('');
      return Number(`${(p[1] ?? '1').replace(/,/g, '')}e${exp}`);
    }
    const lead = new RegExp(`^${NUM}`).exec(bare(text))?.[0];
    return lead === undefined ? undefined : num(lead);
  }

  it('finds the values', () => expect(all.length).toBeGreaterThan(1500));

  it('has no NaN and no number without a printed source', () => {
    const bad = all.filter(([, v]) => {
      if (v.value === null) return false;
      return (
        Number.isNaN(v.value) ||
        !Number.isFinite(v.value) ||
        !new RegExp(`^${NUM}`).test(bare(v.text))
      );
    });
    expect(bad).toEqual([]);
  });

  it('every value equals the leading number of its text, commas removed, powers of ten read', () => {
    const bad = all.filter(([, v]) => v.value !== null && v.value !== leading(v.text));
    expect(bad).toEqual([]);
  });

  it('a text that is one power of ten, with or without a unit, has its value', () => {
    const powers = all.filter(([, v]) =>
      new RegExp(`${POWER.source}(?:\\s+[^0-9]*)?$`).test(bare(v.text)),
    );
    expect(powers.length).toBeGreaterThanOrEqual(20); // rings, atmosphere and hydrosphere masses
    expect(powers.filter(([, v]) => v.value === null)).toEqual([]);
  });

  it('a pole of rotation formula has no value (it states several numbers) and no range', () => {
    const formulas = BODY_IDS.flatMap((id) =>
      (fresh.bodies[id].pole ?? [])
        .filter((r) => ['ra', 'dec', 'nDefinition'].includes(r.key) && /[A-Z]/i.test(r.body.text))
        .map((r) => [`${id}.${r.key}`, r.body] as const),
    );
    expect(formulas.length).toBe(13); // RA and Dec of six bodies, and Neptune's N
    expect(formulas.filter(([, v]) => v.value !== null || v.range)).toEqual([]);
  });

  it('every range equals the two numbers of its text', () => {
    const ranges = all.filter(([, v]) => v.range);
    expect(ranges.length).toBeGreaterThan(30);
    const bad = ranges.filter(([, v]) => {
      const m = new RegExp(`^(${NUM})\\s*(?:-|to)\\s*(${NUM})`).exec(bare(v.text));
      return (
        !m || v.value !== null || v.range?.[0] !== num(m[1] ?? '') || v.range[1] !== num(m[2] ?? '')
      );
    });
    expect(bad).toEqual([]);
  });

  it('qualifiers are the printed prefix', () => {
    const bad = all.filter(([, v]) => v.qualifier !== undefined && !v.text.startsWith(v.qualifier));
    expect(bad).toEqual([]);
    const printed = all.filter(([, v]) => /^(<~|>>|<<|~|<|>)\s*\d/.test(v.text));
    expect(printed.every(([, v]) => v.qualifier !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('outputs', () => {
  it('factsheet.json and factsheet-main.csv are exactly what the parser writes, on every run', async () => {
    const a = buildFactSheet();
    const b = buildFactSheet();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toEqual(data);
    expect(readFileSync(JSON_OUT, 'utf8')).toBe(await renderJson(a));
    expect(readFileSync(CSV_OUT, 'utf8')).toBe(mainCsv(a.main));
  });

  it('the CSV holds the main table as printed, RFC 4180 quoted', () => {
    const lines = readFileSync(CSV_OUT, 'utf8').trimEnd().split('\n');
    const parse = (line: string): string[] =>
      [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map((m) => {
        const f = m[1] ?? '';
        return f.startsWith('"') ? f.slice(1, -1).replace(/""/g, '"') : f;
      });
    expect(parse(lines[0] ?? '')).toEqual(['key', 'label', 'unit', ...BODY_IDS]);
    expect(lines).toHaveLength(21);
    expect(lines[2]).toBe(
      'diameter,Diameter (km),km,4879,"12,104","12,756",3475,6792,"142,984","120,536","51,118","49,528",2376',
    );
    data.main.rows.forEach((r, i) => {
      expect(parse(lines[i + 1] ?? '')).toEqual([
        r.key,
        r.label,
        r.unit ?? '',
        ...BODY_IDS.map((id) => r.values[id].text + (r.values[id].note ?? '')),
      ]);
    });
    expect(lines.find((l) => l.startsWith('distanceFromSun,'))).toContain(',0.384*,');
  });
});

describe('ratio table (planet_table_ratio.html)', () => {
  const page = normalizeText(readFileSync(resolve(RAW_DIR, PAGES.ratio), 'utf8'));
  const row = (key: string) => data.ratio.rows.find((r) => r.key === key)!;

  it('has the 18 rows NASA lists, keyed like the main table', () => {
    expect(data.ratio.rows.map((r) => r.key)).toEqual([
      'mass',
      'diameter',
      'density',
      'gravity',
      'escapeVelocity',
      'rotationPeriod',
      'dayLength',
      'distanceFromSun',
      'perihelion',
      'aphelion',
      'orbitalPeriod',
      'orbitalVelocity',
      'orbitalEccentricity',
      'obliquity',
      'surfacePressure',
      'moons',
      'ringSystem',
      'magneticField',
    ]);
    const mainKeys = new Set(data.main.rows.map((r) => r.key));
    for (const r of data.ratio.rows) expect(mainKeys.has(r.key)).toBe(true);
  });

  it('prints every value verbatim', () => {
    for (const r of data.ratio.rows)
      for (const id of BODY_IDS)
        expect(page).toContain(r.values[id].text + (r.values[id].note ?? ''));
  });

  it('values read off the page', () => {
    expect(row('mass').values.mars).toMatchObject({ text: '0.107', value: 0.107 });
    expect(row('rotationPeriod').values.venus).toMatchObject({ text: '-244', value: -244 });
    expect(row('obliquity').values.uranus).toMatchObject({ text: '4.17', value: 4.17, note: '*' });
    expect(row('obliquity').values.venus).toMatchObject({ text: '0.113', note: '*' });
    expect(row('distanceFromSun').values.moon).toMatchObject({ text: '0.00257', note: '*' });
    expect(row('surfacePressure').values.jupiter).toMatchObject({ text: 'Unknown', note: '*' });
    expect(row('gravity').values.earth).toMatchObject({ text: '1', value: 1 });
  });

  it("takes each row's definition from planetfact_ratio_notes.html", () => {
    expect(data.definitions.ratio?.mass?.text).toContain('compared to the mass of the Earth');
    // NASA links obliquity to #orbo; the notes page calls it "Axial Tilt" under #axit.
    expect(data.definitions.ratio?.obliquity?.term).toBe('Axial Tilt');
  });
});
