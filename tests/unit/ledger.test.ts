// The discrepancy ledger: both files it writes are up to date, every conflict names the table row
// whose popover shows it, and each says whether two pages disagree or one page disagrees with itself.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { BODY_IDS, DISCREPANCIES } from '../../src/data/index.ts';

const lines = (body: string, key: string) =>
  DISCREPANCIES.filter((d) => d.body === body && d.key === key);

describe('discrepancy ledger', () => {
  it('data/discrepancies.md and src/data/discrepancies.json are up to date', () => {
    const script = resolve(import.meta.dirname, '../../scripts/ledger.ts');
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('every conflict belongs to a body and to one of its rows', () => {
    const keys = new Set(PARAMS.map((p) => p.key));
    for (const d of DISCREPANCIES) {
      expect(BODY_IDS).toContain(d.body);
      expect(keys.has(d.key), `${d.body} ${d.key}`).toBe(true);
    }
  });

  it('18 conflicts: Mercury, Venus, Earth, the Moon and Mars 1 each, Uranus 4, Pluto 9', () => {
    const count = (id: string) => DISCREPANCIES.filter((d) => d.body === id).length;
    expect(DISCREPANCIES).toHaveLength(18);
    expect(BODY_IDS.map(count)).toEqual([1, 1, 1, 1, 1, 0, 0, 4, 0, 9]);
  });

  it('a page that disagrees with itself is named in `within`; otherwise two pages disagree', () => {
    expect(DISCREPANCIES.filter((d) => d.within).map((d) => [d.body, d.key, d.within])).toEqual([
      ['uranus', 'ringSystem', 'uranringfact.html'],
      ['uranus', 'ringSystem', 'uranringfact.html'],
      ['uranus', 'ringSystem', 'uranringfact.html'],
      ['pluto', 'meanTemperature', 'plutofact.html'],
      ['pluto', 'orbitalEccentricity', 'main table'],
    ]);
    for (const d of DISCREPANCIES) {
      if (d.within) expect(d.aSrc).toBe(d.within);
      else {
        expect(d.aSrc).toBe('main table');
        expect(d.bSrc).toBe(`${d.body}fact.html`);
      }
    }
  });

  it('values worked out from printed ones show the sum and its result', () => {
    expect(lines('mercury', 'diameter')[0]?.b).toBe('2 × 2440.5 = 4881');
    expect(lines('moon', 'diameter')[0]?.b).toBe('2 × 1738.1 = 3476.2');
    expect(lines('uranus', 'ringSystem').map((d) => [d.a, d.b])).toEqual([
      ['Eta 1.834', '47,176 ÷ 25,559 = 1.846'],
      ['Delta 1.900', '48,300 ÷ 25,559 = 1.890'],
      ['Epsilon 2.006', '51,149 ÷ 25,559 = 2.001'],
    ]);
    expect(lines('pluto', 'orbitalEccentricity')).toEqual([
      {
        body: 'pluto',
        key: 'orbitalEccentricity',
        what: 'eccentricity vs perihelion and aphelion',
        a: '0.244',
        aSrc: 'main table',
        b: '(7375.9 − 4436.8)/(7375.9 + 4436.8) = 0.2488',
        bSrc: 'main table',
        within: 'main table',
        note: 'Planetary draws the ellipse from the perihelion and aphelion, and lists the eccentricity as NASA prints it.',
      },
    ]);
  });

  it("Pluto's Kelvin-to-Celsius slip is one entry for the whole printed range", () => {
    expect(lines('pluto', 'meanTemperature')).toEqual([
      {
        body: 'pluto',
        key: 'meanTemperature',
        what: 'mean temperature vs “Surface temperature” (°C)',
        a: '-225',
        aSrc: 'main table',
        b: '24 - 38 K (-247 - -233 C)',
        bSrc: 'plutofact.html',
      },
      {
        body: 'pluto',
        key: 'meanTemperature',
        what: '“Surface temperature”',
        a: '24 - 38 K printed as -247 to -233 C',
        aSrc: 'plutofact.html',
        b: '-249.15 to -235.15 C',
        bSrc: 'K − 273.15',
        within: 'plutofact.html',
      },
    ]);
  });

  it('reads as running text after "disagree on", and every note says what Planetary does', () => {
    for (const d of DISCREPANCIES) {
      expect(d.what, d.what).toMatch(/^[a-z“]/);
      expect(d.what).not.toContain(':');
      if (d.note) expect(d.note).toMatch(/^Planetary /);
    }
  });

  it('the Markdown ledger heads its columns "Printed" and "Compared with"', () => {
    const md = readFileSync(resolve(import.meta.dirname, '../../data/discrepancies.md'), 'utf8');
    expect(md).toContain('## Conflicts (18)');
    expect(md).toContain('| Body | Value | Printed | Compared with | Note |');
    expect(md).toContain(
      '| Pluto | Eccentricity vs perihelion and aphelion | 0.244 (main table) | (7375.9 − 4436.8)/(7375.9 + 4436.8) = 0.2488 (main table) |',
    );
    expect(md).not.toMatch(/The sheets/);
  });
});
