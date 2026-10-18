#!/usr/bin/env node
// Where NASA's pages disagree. Compares the main table (index.html) with each body's own fact sheet,
// and checks a few relations within one page (eccentricity against perihelion and aphelion, Celsius
// against Kelvin, a ring sheet's ratio column against its radii in km), then writes
// data/discrepancies.md and, for the row popovers, the conflicts alone as src/data/discrepancies.json.
//
//   node scripts/ledger.ts            # rewrite both files
//   node scripts/ledger.ts --check    # fail if either is out of date (used by CI and the tests)
//
// A pair counts as "rounding" when the more precise value, rounded to the other's printed decimals,
// equals it; anything else is a "conflict". A value worked out from printed ones shows its sum with
// the result ("2 × 2440.5 = 4881"). Nothing here changes what the pages show: every value is still
// drawn and listed exactly where NASA prints it.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import raw from '../src/data/factsheet.json' with { type: 'json' };
import {
  BODY_IDS,
  type BodyId,
  type Discrepancy,
  type FactSheet,
  type Row,
  type Val,
} from '../src/data/types.ts';

const F = raw as unknown as FactSheet;

interface Entry {
  body: BodyId;
  /** The table row the value belongs to: a main-table key (ringSystem for the ring sheets). */
  key: string;
  /** What is compared, as running text ("rotation period (h)"); the Markdown table capitalises it. */
  what: string;
  a: string;
  aSrc: string;
  b: string;
  bSrc: string;
  /** The one page (or table) both values come from, when it disagrees with itself. */
  within?: string;
  kind: 'rounding' | 'conflict';
  note?: string;
}

const entries: Entry[] = [];

const decimals = (t: string) => {
  const m = t.replace(/,/g, '').match(/\.(\d+)/);
  return m ? m[1]!.length : 0;
};

/** An exact product, as NASA prints its numbers: no trailing zeros, commas from 10,000. */
const exact = (x: number, d: number) =>
  x.toLocaleString('en-US', { maximumFractionDigits: d, useGrouping: Math.abs(x) >= 10_000 });

/**
 * The interval a printed number stands for: ± half a unit in its last place. Trailing zeros of an
 * integer do not say whether they are significant ("1850" may be 1854 to three figures), so they
 * widen the interval.
 */
function interval(text: string, value: number): [number, number] {
  const d = decimals(text);
  let half = 0.5 * 10 ** -d;
  if (d === 0 && !/\.$/.test(text.trim())) {
    const zeros = text.replace(/[^\d]/g, '').match(/0+$/)?.[0].length ?? 0;
    half = 0.5 * 10 ** zeros;
  }
  return [value - half, value + half];
}

/** Can both printed values be roundings of one number? Touching intervals only count when the
 *  precisions differ (two values at the same precision one unit apart are a real difference). */
function consistent(a: [number, number], b: [number, number], samePrecision: boolean) {
  return samePrecision
    ? a[0] < b[1] - 1e-12 && b[0] < a[1] - 1e-12
    : a[0] <= b[1] + 1e-12 && b[0] <= a[1] + 1e-12;
}

function compare(
  body: BodyId,
  key: string,
  what: string,
  a: Val | undefined,
  aSrc: string,
  b: Val | undefined,
  bSrc: string,
  scale = 1,
  note?: string,
) {
  if (!a || !b || a.value === null || b.value === null) return;
  const av = a.value,
    bv = b.value * scale;
  if (av === bv) return;
  const ia = interval(a.text, av);
  const ib0 = interval(b.text, b.value);
  const ib: [number, number] = [ib0[0] * scale, ib0[1] * scale];
  const same = decimals(a.text) === decimals(b.text) && scale === 1;
  const printed = b.text + (b.note ?? '');
  entries.push({
    body,
    key,
    what,
    a: a.text + (a.note ?? ''),
    aSrc,
    b: scale === 1 ? printed : `${scale} × ${printed} = ${exact(bv, decimals(b.text))}`,
    bSrc,
    kind: consistent(ia, ib, same) ? 'rounding' : 'conflict',
    ...(note ? { note } : {}),
  });
}

const main = (id: BodyId, key: string) => F.main.rows.find((r) => r.key === key)?.values[id];
const row = (id: BodyId, section: 'bulk' | 'orbital', key: string): Row | undefined =>
  F.bodies[id][section].find((r) => r.key === key);
const page = (id: BodyId) => `${id}fact.html`;

for (const id of BODY_IDS) {
  const p = page(id);
  compare(
    id,
    'diameter',
    'diameter vs 2 × equatorial radius (km)',
    main(id, 'diameter'),
    'main table',
    row(id, 'bulk', 'equatorialRadius')?.body,
    p,
    2,
  );
  compare(
    id,
    'density',
    'density (kg/m³)',
    main(id, 'density'),
    'main table',
    row(id, 'bulk', 'density')?.body,
    p,
  );
  compare(
    id,
    'gravity',
    'gravity vs surface acceleration at the equator (m/s²)',
    main(id, 'gravity'),
    'main table',
    row(id, 'bulk', 'accelEquator')?.body,
    p,
  );
  compare(
    id,
    'escapeVelocity',
    'escape velocity (km/s)',
    main(id, 'escapeVelocity'),
    'main table',
    row(id, 'bulk', 'escapeVelocity')?.body,
    p,
  );
  compare(
    id,
    'rotationPeriod',
    'rotation period (h)',
    main(id, 'rotationPeriod'),
    'main table',
    row(id, 'orbital', 'siderealRotation')?.body,
    p,
  );
  compare(
    id,
    'dayLength',
    'length of day (h)',
    main(id, 'dayLength'),
    'main table',
    row(id, 'orbital', 'dayLength')?.body,
    p,
  );
  compare(
    id,
    'distanceFromSun',
    'distance from Sun vs semimajor axis (10⁶ km)',
    main(id, 'distanceFromSun'),
    'main table',
    row(id, 'orbital', 'semimajorAxis')?.body,
    p,
  );
  compare(
    id,
    'perihelion',
    'perihelion (10⁶ km)',
    main(id, 'perihelion'),
    'main table',
    row(id, 'orbital', id === 'moon' ? 'perigee' : 'perihelion')?.body,
    p,
  );
  compare(
    id,
    'aphelion',
    'aphelion (10⁶ km)',
    main(id, 'aphelion'),
    'main table',
    row(id, 'orbital', id === 'moon' ? 'apogee' : 'aphelion')?.body,
    p,
  );
  const period =
    id === 'moon' ? 'revolutionPeriod' : id === 'pluto' ? 'siderealPeriod' : 'tropicalPeriod';
  compare(
    id,
    'orbitalPeriod',
    `orbital period vs ${period === 'tropicalPeriod' ? 'tropical' : 'sidereal'} period (days)`,
    main(id, 'orbitalPeriod'),
    'main table',
    row(id, 'orbital', period)?.body,
    p,
  );
  compare(
    id,
    'orbitalVelocity',
    'orbital velocity vs mean orbital velocity (km/s)',
    main(id, 'orbitalVelocity'),
    'main table',
    row(id, 'orbital', 'meanOrbitalVelocity')?.body,
    p,
  );
  compare(
    id,
    'orbitalInclination',
    'orbital inclination (°)',
    main(id, 'orbitalInclination'),
    'main table',
    row(id, 'orbital', 'inclination')?.body,
    p,
  );
  compare(
    id,
    'orbitalEccentricity',
    'orbital eccentricity',
    main(id, 'orbitalEccentricity'),
    'main table',
    row(id, 'orbital', 'eccentricity')?.body,
    p,
  );
  compare(
    id,
    'obliquity',
    'obliquity to orbit (°)',
    main(id, 'obliquity'),
    'main table',
    row(id, 'orbital', 'obliquity')?.body,
    p,
  );
  compare(
    id,
    'moons',
    'number of moons',
    main(id, 'moons'),
    'main table',
    row(id, 'bulk', 'satellites')?.body,
    p,
  );

  // Mean temperature (°C) against the body page's temperature line, read from its "(… C)" part.
  const mt = main(id, 'meanTemperature');
  const tRow = F.bodies[id].atmosphere?.find((r) =>
    /^(average temperature|surface temperature|temperature at 1 bar)/i.test(r.label),
  );
  const c = tRow?.body.text.match(/\(\s*~?(-?[\d.]+)(?:\s*-\s*(-?[\d.]+))?\s*C\s*\)/);
  if (mt && mt.value !== null && tRow && c) {
    const lo = Number(c[1]),
      hi = c[2] !== undefined ? Number(c[2]) : lo;
    const ib: [number, number] =
      c[2] !== undefined ? [Math.min(lo, hi), Math.max(lo, hi)] : interval(c[1]!, lo);
    const conflict = !consistent(interval(mt.text, mt.value), ib, false);
    if (conflict || mt.value !== lo || c[2] !== undefined)
      entries.push({
        body: id,
        key: 'meanTemperature',
        what: `mean temperature vs “${tRow.label}” (°C)`,
        a: mt.text,
        aSrc: 'main table',
        b: tRow.body.text,
        bSrc: p,
        kind: conflict ? 'conflict' : 'rounding',
      });
  }

  // Within the body page: Kelvin and Celsius printed side by side on one line, C = K − 273.15 within
  // their rounding. A range is one entry, whichever of its ends is off.
  for (const r of F.bodies[id].atmosphere ?? []) {
    const m = r.body.text.match(
      /(~?([\d.]+)(?:\s*-\s*([\d.]+))?)\s*K\s*\(\s*~?(-?[\d.]+)(?:\s*-\s*(-?[\d.]+))?\s*C\s*\)/,
    );
    if (!m) continue;
    const ends: [string, string][] = [[m[2]!, m[4]!]];
    if (m[3] && m[5]) ends.push([m[3], m[5]]);
    const off = ends.some(([k, cText]) => {
      const ik = interval(k, Number(k));
      return !consistent([ik[0] - 273.15, ik[1] - 273.15], interval(cText, Number(cText)), false);
    });
    if (off)
      entries.push({
        body: id,
        key: 'meanTemperature',
        what: `“${r.label}”`,
        a: `${m[1]} K printed as ${ends.map(([, cText]) => cText).join(' to ')} C`,
        aSrc: p,
        b: `${ends.map(([k]) => (Number(k) - 273.15).toFixed(2)).join(' to ')} C`,
        bSrc: 'K − 273.15',
        within: p,
        kind: 'conflict',
      });
  }

  // Within the main table: eccentricity against the printed perihelion and aphelion, with their
  // rounding carried through e = (Q − q)/(Q + q).
  const qv = main(id, 'perihelion'),
    Qv = main(id, 'aphelion'),
    e = main(id, 'orbitalEccentricity');
  if (qv?.value && Qv?.value && e && e.value !== null) {
    const iq = interval(qv.text, qv.value),
      iQ = interval(Qv.text, Qv.value);
    const lo = (iQ[0] - iq[1]) / (iQ[0] + iq[1]),
      hi = (iQ[1] - iq[0]) / (iQ[1] + iq[0]);
    const implied = (Qv.value - qv.value) / (Qv.value + qv.value);
    if (!consistent(interval(e.text, e.value), [lo, hi], false))
      entries.push({
        body: id,
        key: 'orbitalEccentricity',
        what: 'eccentricity vs perihelion and aphelion',
        a: e.text,
        aSrc: 'main table',
        b: `(${Qv.text} − ${qv.text})/(${Qv.text} + ${qv.text}) = ${implied.toFixed(4)}`,
        bSrc: 'main table',
        within: 'main table',
        kind: 'conflict',
        note: 'Planetary draws the ellipse from the perihelion and aphelion, and lists the eccentricity as NASA prints it.',
      });
  }

  // Within a ring sheet: the Radius/Eq. radius column against km ÷ the sheet's own equator row.
  const rs = F.bodies[id].rings;
  const eqRow = rs?.rings.find((x) => /equator/i.test(x.name));
  const eq = eqRow?.radius.value;
  if (rs && eqRow && eq) {
    const sheet = rs.url.split('/').pop()!;
    for (const r of rs.rings) {
      if (r === eqRow || r.radius.value === null || r.ratio.value === null) continue;
      const ir = interval(r.radius.text.replace(/^[~<>]+/, ''), r.radius.value),
        ie = interval(eqRow.radius.text, eq);
      const implied: [number, number] = [ir[0] / ie[1], ir[1] / ie[0]];
      if (!consistent(interval(r.ratio.text.replace(/^[~<>]+/, ''), r.ratio.value), implied, false))
        entries.push({
          body: id,
          key: 'ringSystem',
          what: 'the Radius/Eq. radius column',
          a: `${/^\d/.test(r.name) ? `Ring ${r.name}` : r.name} ${r.ratio.text}`,
          aSrc: sheet,
          b: `${r.radius.text} ÷ ${eqRow.radius.text} = ${(r.radius.value / eq).toFixed(decimals(r.ratio.text))}`,
          bSrc: sheet,
          within: sheet,
          kind: 'conflict',
          note: 'Planetary draws the rings from the km column.',
        });
    }
  }
}

const conflicts = entries.filter((e) => e.kind === 'conflict');
const rounding = entries.filter((e) => e.kind === 'rounding');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const table = (list: Entry[]) =>
  ['| Body | Value | Printed | Compared with | Note |', '| --- | --- | --- | --- | --- |']
    .concat(
      list.map(
        (e) =>
          `| ${F.bodies[e.body].name} | ${cap(e.what)} | ${e.a} (${e.aSrc}) | ${e.b} (${e.bSrc}) | ${e.note ?? ''} |`,
      ),
    )
    .join('\n');

const md = `# Where NASA's pages disagree

Generated by \`scripts/ledger.ts\` from the snapshot in \`data/raw/\` (retrieved ${F.retrieved.slice(0, 10)}).
Do not edit by hand.

NASA's fact sheets are curated by hand and updated page by page, so the main table and the body pages
sometimes print different values for what looks like the same quantity. Some differences are only
rounding; others come from different epochs or definitions (the main table's "Orbital Period" is the
tropical period, its "Gravity" is the equatorial acceleration including rotation, and so on), and some
are plain conflicts. A few pages also disagree with themselves: the ledger checks the main table's
eccentricity against its perihelion and aphelion, Celsius against Kelvin where a page prints both, and
each ring sheet's Radius/Eq. radius column against its radii in km. Planetary never picks a winner:
each value is shown where NASA prints it, and each drawing is sized by the value printed on it.

## Conflicts (${conflicts.length})

${table(conflicts)}

## Rounding only (${rounding.length})

${table(rounding)}
`;

// The conflicts again for the body pages, which show each one in the popover of the row it concerns.
const json =
  JSON.stringify(
    conflicts.map(({ body, key, what, a, aSrc, b, bSrc, within, note }): Discrepancy => ({
      body,
      key,
      what,
      a,
      aSrc,
      b,
      bSrc,
      ...(within ? { within } : {}),
      ...(note ? { note } : {}),
    })),
    null,
    2,
  ) + '\n';

const files = { 'data/discrepancies.md': md, 'src/data/discrepancies.json': json };
const path = (f: string) => resolve(import.meta.dirname, '..', f);
if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([f, text]) => {
    try {
      return readFileSync(path(f), 'utf8') !== text;
    } catch {
      return true;
    }
  });
  for (const [f] of stale) console.error(`${f} is out of date: run node scripts/ledger.ts`);
  if (stale.length) process.exit(1);
  console.log('data/discrepancies.md and src/data/discrepancies.json are up to date');
} else {
  for (const [f, text] of Object.entries(files)) writeFileSync(path(f), text);
  console.log(
    `${conflicts.length} conflicts, ${rounding.length} rounding differences → ${Object.keys(files).join(', ')}`,
  );
}
