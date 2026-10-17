#!/usr/bin/env node
// Where NASA's pages disagree with each other. Compares the main table (index.html) with each body's
// own fact sheet, and checks a few internal relations, then writes data/discrepancies.md.
//
//   node scripts/ledger.ts            # rewrite data/discrepancies.md
//   node scripts/ledger.ts --check    # fail if it is out of date (used by the tests)
//
// A pair counts as "rounding" when the more precise value, rounded to the other's printed decimals,
// equals it; anything else is a "conflict". Nothing here changes what the sheets show: every value
// is still drawn and listed exactly where NASA prints it.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import raw from '../src/data/factsheet.json' with { type: 'json' };
import { BODY_IDS, type BodyId, type FactSheet, type Row, type Val } from '../src/data/types.ts';

const F = raw as unknown as FactSheet;

interface Entry {
  body: string;
  what: string;
  a: string;
  aSrc: string;
  b: string;
  bSrc: string;
  kind: 'rounding' | 'conflict';
  note?: string;
}

const entries: Entry[] = [];

const decimals = (t: string) => {
  const m = t.replace(/,/g, '').match(/\.(\d+)/);
  return m ? m[1]!.length : 0;
};

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
  body: string,
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
  entries.push({
    body,
    what,
    a: a.text + (a.note ?? ''),
    aSrc,
    b: (scale === 1 ? '' : `${scale} × `) + b.text + (b.note ?? ''),
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
  const name = F.bodies[id].name;
  const p = page(id);
  compare(
    name,
    'Diameter vs 2 × equatorial radius (km)',
    main(id, 'diameter'),
    'main table',
    row(id, 'bulk', 'equatorialRadius')?.body,
    p,
    2,
  );
  compare(
    name,
    'Density (kg/m³)',
    main(id, 'density'),
    'main table',
    row(id, 'bulk', 'density')?.body,
    p,
  );
  compare(
    name,
    'Gravity vs surface acceleration at the equator (m/s²)',
    main(id, 'gravity'),
    'main table',
    row(id, 'bulk', 'accelEquator')?.body,
    p,
  );
  compare(
    name,
    'Escape velocity (km/s)',
    main(id, 'escapeVelocity'),
    'main table',
    row(id, 'bulk', 'escapeVelocity')?.body,
    p,
  );
  compare(
    name,
    'Rotation period (h)',
    main(id, 'rotationPeriod'),
    'main table',
    row(id, 'orbital', 'siderealRotation')?.body,
    p,
  );
  compare(
    name,
    'Length of day (h)',
    main(id, 'dayLength'),
    'main table',
    row(id, 'orbital', 'dayLength')?.body,
    p,
  );
  compare(
    name,
    'Distance from Sun vs semimajor axis (10⁶ km)',
    main(id, 'distanceFromSun'),
    'main table',
    row(id, 'orbital', 'semimajorAxis')?.body,
    p,
  );
  compare(
    name,
    'Perihelion (10⁶ km)',
    main(id, 'perihelion'),
    'main table',
    row(id, 'orbital', id === 'moon' ? 'perigee' : 'perihelion')?.body,
    p,
  );
  compare(
    name,
    'Aphelion (10⁶ km)',
    main(id, 'aphelion'),
    'main table',
    row(id, 'orbital', id === 'moon' ? 'apogee' : 'aphelion')?.body,
    p,
  );
  const period =
    id === 'moon' ? 'revolutionPeriod' : id === 'pluto' ? 'siderealPeriod' : 'tropicalPeriod';
  compare(
    name,
    `Orbital period vs ${period === 'tropicalPeriod' ? 'tropical' : 'sidereal'} period (days)`,
    main(id, 'orbitalPeriod'),
    'main table',
    row(id, 'orbital', period)?.body,
    p,
  );
  compare(
    name,
    'Orbital velocity vs mean orbital velocity (km/s)',
    main(id, 'orbitalVelocity'),
    'main table',
    row(id, 'orbital', 'meanOrbitalVelocity')?.body,
    p,
  );
  compare(
    name,
    'Orbital inclination (°)',
    main(id, 'orbitalInclination'),
    'main table',
    row(id, 'orbital', 'inclination')?.body,
    p,
  );
  compare(
    name,
    'Orbital eccentricity',
    main(id, 'orbitalEccentricity'),
    'main table',
    row(id, 'orbital', 'eccentricity')?.body,
    p,
  );
  compare(
    name,
    'Obliquity to orbit (°)',
    main(id, 'obliquity'),
    'main table',
    row(id, 'orbital', 'obliquity')?.body,
    p,
  );
  compare(
    name,
    'Number of moons',
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
    if (!consistent(interval(mt.text, mt.value), ib, false))
      entries.push({
        body: name,
        what: `Mean temperature vs "${tRow.label}" (°C)`,
        a: mt.text,
        aSrc: 'main table',
        b: tRow.body.text,
        bSrc: p,
        kind: 'conflict',
      });
    else if (mt.value !== lo || c[2] !== undefined)
      entries.push({
        body: name,
        what: `Mean temperature vs "${tRow.label}" (°C)`,
        a: mt.text,
        aSrc: 'main table',
        b: tRow.body.text,
        bSrc: p,
        kind: 'rounding',
      });
  }

  // Kelvin and Celsius printed side by side on one line: C = K − 273.15, within their rounding.
  for (const r of F.bodies[id].atmosphere ?? []) {
    const m = r.body.text.match(
      /~?([\d.]+)(?:\s*-\s*([\d.]+))?\s*K\s*\(\s*~?(-?[\d.]+)(?:\s*-\s*(-?[\d.]+))?\s*C\s*\)/,
    );
    if (!m) continue;
    const pairs: [string, string][] = [[m[1]!, m[3]!]];
    if (m[2] && m[4]) pairs.push([m[2], m[4]]);
    for (const [k, cText] of pairs) {
      const ik = interval(k, Number(k));
      const ic = interval(cText, Number(cText));
      if (!consistent([ik[0] - 273.15, ik[1] - 273.15], ic, false))
        entries.push({
          body: name,
          what: `"${r.label}": ${k} K printed as ${cText} C`,
          a: r.body.text,
          aSrc: p,
          b: `${(Number(k) - 273.15).toFixed(2)} C`,
          bSrc: 'K − 273.15',
          kind: 'conflict',
        });
    }
  }

  // Inside the main table: eccentricity against the printed perihelion and aphelion, with their
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
        body: name,
        what: 'Eccentricity vs (Q − q)/(Q + q) from the same table',
        a: e.text,
        aSrc: 'main table',
        b: implied.toFixed(4),
        bSrc: `main table q ${qv.text}, Q ${Qv.text}`,
        kind: 'conflict',
        note: 'The sheets draw the ellipse from q and Q and print e as listed.',
      });
  }

  // Ring sheets: the Radius/Eq. radius column against km ÷ the sheet's own equator row.
  const rs = F.bodies[id].rings;
  if (rs) {
    const eq = rs.rings.find((r) => /equator/i.test(r.name))?.radius.value;
    const eqRow = rs.rings.find((x) => /equator/i.test(x.name));
    for (const r of rs.rings) {
      if (!eq || !eqRow || r === eqRow || r.radius.value === null || r.ratio.value === null)
        continue;
      const ir = interval(r.radius.text.replace(/^[~<>]+/, ''), r.radius.value),
        ie = interval(eqRow.radius.text, eq);
      const implied: [number, number] = [ir[0] / ie[1], ir[1] / ie[0]];
      if (!consistent(interval(r.ratio.text.replace(/^[~<>]+/, ''), r.ratio.value), implied, false))
        entries.push({
          body: name,
          what: `Ring "${r.name}": radius/equatorial radius`,
          a: r.ratio.text,
          aSrc: rs.url.split('/').pop()!,
          b: (r.radius.value / eq).toFixed(3),
          bSrc: `${r.radius.text} km ÷ ${eqRow.radius.text} km`,
          kind: 'conflict',
          note: 'The sheets draw rings from the km column.',
        });
    }
  }
}

const conflicts = entries.filter((e) => e.kind === 'conflict');
const rounding = entries.filter((e) => e.kind === 'rounding');
const table = (list: Entry[]) =>
  ['| Body | Value | One page | Other page | Note |', '| --- | --- | --- | --- | --- |']
    .concat(
      list.map(
        (e) =>
          `| ${e.body} | ${e.what} | ${e.a} (${e.aSrc}) | ${e.b} (${e.bSrc}) | ${e.note ?? ''} |`,
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
are plain conflicts. The sheets never pick a winner: each value is shown where NASA prints it, and each
drawing is sized by the value printed on it.

## Conflicts (${conflicts.length})

${table(conflicts)}

## Rounding only (${rounding.length})

${table(rounding)}
`;

const out = resolve(import.meta.dirname, '../data/discrepancies.md');
if (process.argv.includes('--check')) {
  const cur = readFileSync(out, 'utf8');
  if (cur !== md) {
    console.error('data/discrepancies.md is out of date: run node scripts/ledger.ts');
    process.exit(1);
  }
  console.log('data/discrepancies.md is up to date');
} else {
  writeFileSync(out, md);
  console.log(
    `${conflicts.length} conflicts, ${rounding.length} rounding differences → data/discrepancies.md`,
  );
}
