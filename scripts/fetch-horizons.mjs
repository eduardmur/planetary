#!/usr/bin/env node
// Downloads reference positions of the nine Sun-orbiting bodies from JPL Horizons, against which
// tests/unit/astro.test.ts measures the two-body model of src/astro/ (NASA's J2000 mean elements,
// no perturbations).
//
//   node scripts/fetch-horizons.mjs                     # the fixture → tests/fixtures/horizons.json
//   node scripts/fetch-horizons.mjs --scan scan.json    # every day 1990–2060 → scan.json (~35 MB)
//   node scripts/fetch-horizons.mjs --scan scan.json '2 d' 1900-01-01 2100-01-01   # any range
//   HORIZONS_SCAN=scan.json npx vitest run tests/unit/astro.test.ts   # also test against the scan
//
// What is asked for: geometric heliocentric positions (no light time, no aberration) of the body
// centres 199 … 999 relative to the Sun's centre (500@10), in the ecliptic and mean equinox of J2000
// (Horizons defines that frame with the IAU 1976 obliquity 84381.448″), in AU. Times are Julian
// dates on the TDB scale. src/astro/ does not tell TDB, TT and UTC apart: the ~69 s between them
// moves Mercury, the fastest planet, by 0.003°.
//
// The fixture holds, for every body, five shared epochs and the dates on which the model is worst
// in a one-day scan of 1990–2060 (WORST below), so that the per-body tolerances in the test are
// checked where they are tight. It also holds a few of the same positions in Horizons' equatorial
// ICRF frame: the test rotates those with poleToEcliptic and must land on the ecliptic ones.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

export const BODIES = [
  { id: 199, name: 'Mercury' },
  { id: 299, name: 'Venus' },
  { id: 399, name: 'Earth' },
  { id: 499, name: 'Mars' },
  { id: 599, name: 'Jupiter' },
  { id: 699, name: 'Saturn' },
  { id: 799, name: 'Uranus' },
  { id: 899, name: 'Neptune' },
  { id: 999, name: 'Pluto' },
];

/** The fixture's shared epochs, 1990–2060 with J2000 itself, as calendar dates on the TDB scale. */
export const EPOCHS = [
  '1990-01-01T00:00:00Z',
  '2000-01-01T12:00:00Z',
  '2026-10-17T00:00:00Z',
  '2040-06-01T00:00:00Z',
  '2060-01-01T00:00:00Z',
];

/**
 * Per body, the 00:00 TDB dates of the model's largest |Δlongitude|, |Δlatitude| and |Δdistance|
 * in a one-day scan of 1990-01-01 … 2060-01-01. The scan test (HORIZONS_SCAN) reports them again
 * if the model changes and they move.
 */
export const WORST = {
  199: ['2059-11-09', '2059-11-06', '2059-11-23'],
  299: ['2056-12-01', '2059-06-29', '2051-04-15'],
  399: ['2058-02-16', '2059-12-22', '2058-05-08'],
  499: ['2052-07-07', '2059-05-10', '2052-02-19'],
  599: ['2058-10-05', '2056-12-26', '2050-04-06'],
  699: ['2059-06-27', '2051-11-02', '2000-12-05'],
  799: ['2034-07-02', '1998-10-18', '2058-12-08'],
  899: ['2018-12-28', '1991-12-19', '1996-06-18'],
  999: ['2023-10-15', '2038-06-12', '2057-08-17'],
};

/** Epochs at which the fixture also gives each position in the equatorial ICRF frame. */
export const ICRF_EPOCHS = [EPOCHS[1], EPOCHS[2]];

const [mode, scanFile, step = '1 d', start = '1990-01-01', stop = '2060-01-01'] =
  process.argv.slice(2);
if (mode !== undefined && !(mode === '--scan' && scanFile)) {
  console.error(
    'usage: node scripts/fetch-horizons.mjs [--scan <out.json> [step [start stop]]]\n' +
      '       defaults: step "1 d", start 1990-01-01, stop 2060-01-01',
  );
  process.exit(2);
}
const scan = mode === '--scan';

/** Julian date of a calendar date: days since 1970-01-01T00:00 plus that moment's JD. */
const julian = (iso) => Date.parse(iso) / 86_400_000 + 2_440_587.5;

const COMMON = {
  format: 'json',
  OBJ_DATA: "'NO'",
  MAKE_EPHEM: "'YES'",
  EPHEM_TYPE: "'VECTORS'",
  CENTER: "'500@10'",
  REF_PLANE: "'ECLIPTIC'",
  REF_SYSTEM: "'J2000'",
  OUT_UNITS: "'AU-D'",
  VEC_TABLE: "'1'",
  VEC_CORR: "'NONE'",
  CSV_FORMAT: "'YES'",
  TIME_TYPE: "'TDB'",
};

/** A TLIST of Julian dates, sorted, for calendar dates on the TDB scale. */
const tlist = (isoDates) => ({
  TLIST_TYPE: "'JD'",
  TLIST: [...new Set(isoDates.map(julian))]
    .sort((a, b) => a - b)
    .map((jd) => `'${jd}'`)
    .join(' '),
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** One Horizons request, retried with back-off on network errors, HTTP 429 and 5xx. */
async function query(command, params, attempts = 5) {
  const url = `${API}?${new URLSearchParams({ ...params, COMMAND: `'${command}'` })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'planetary tests' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `HTTP ${res.status}`, { cause: 'fatal' });
      }
      return body;
    } catch (err) {
      if (err.cause === 'fatal' || attempt >= attempts) {
        throw new Error(`${command}: ${err.message}`);
      }
      console.warn(`${command}: ${err.message}, retrying (${attempt}/${attempts - 1})`);
      await sleep(2000 * attempt);
    }
  }
}

/** The header lines that say what was computed, checked before anything is kept. */
function header(id, result, frame) {
  const line = (label) => new RegExp(`^${label}\\s*:\\s*(.+?)\\s*$`, 'm').exec(result)?.[1];
  const target = /^Target body name:\s*(.+?)\s*\{source:\s*([^}]+)\}/m.exec(result);
  const center = /^Center body name:\s*(.+?)\s*\{source:\s*([^}]+)\}/m.exec(result);
  const h = {
    target: target?.[1],
    center: center?.[1],
    site: line('Center-site name'),
    frame: line('Reference frame'),
    source: target?.[2].trim(),
  };
  if (!h.target?.endsWith(`(${id})`) || h.center !== 'Sun (10)' || h.site !== 'BODY CENTER') {
    throw new Error(
      `${id}: unexpected target or centre in the Horizons header: ${JSON.stringify(h)}`,
    );
  }
  if (h.frame !== frame) throw new Error(`${id}: reference frame "${h.frame}", not "${frame}"`);
  return h;
}

/** Rows of the CSV table between $$SOE and $$EOE: "JDTDB, Calendar Date (TDB), X, Y, Z,". */
function parseVectors(result) {
  const table = /\$\$SOE\s*([\s\S]*?)\s*\$\$EOE/.exec(result);
  if (!table) throw new Error('no $$SOE…$$EOE table in the Horizons result');
  return table[1].split('\n').map((line) => {
    const [jd, calendar, x, y, z] = line.split(',').map((cell) => cell.trim());
    const row = { jd: Number(jd), calendar: calendar?.replace(/^A\.D\. /, ''), x, y, z };
    for (const key of ['x', 'y', 'z']) row[key] = Number(row[key]);
    if (![row.jd, row.x, row.y, row.z].every(Number.isFinite) || !row.calendar) {
      throw new Error(`unreadable row: ${line}`);
    }
    return row;
  });
}

const ECLIPTIC = 'Ecliptic of J2000.0';
const scanParams = {
  ...COMMON,
  START_TIME: `'${start}'`,
  STOP_TIME: `'${stop}'`,
  STEP_SIZE: `'${step}'`,
};

const results = [];
const icrf = [];
const headers = {};
let signature;
for (const { id, name } of BODIES) {
  const dates = scan ? null : [...EPOCHS, ...WORST[id].map((day) => `${day}T00:00:00Z`)];
  const body = await query(id, scan ? scanParams : { ...COMMON, ...tlist(dates) });
  signature = body.signature;
  headers[id] = header(id, body.result, ECLIPTIC);
  const rows = parseVectors(body.result);
  if (dates && rows.length !== new Set(dates).size) {
    throw new Error(`${id}: ${rows.length} rows for ${new Set(dates).size} dates`);
  }
  for (const row of rows) results.push({ id, name, ...row });
  if (!scan) {
    await sleep(500);
    const eq = await query(id, { ...COMMON, REF_PLANE: "'FRAME'", ...tlist(ICRF_EPOCHS) });
    header(id, eq.result, 'ICRF');
    for (const row of parseVectors(eq.result)) icrf.push({ id, name, ...row });
  }
  console.log(
    `${String(id).padEnd(4)} ${name.padEnd(8)} ${rows.length} rows  (${headers[id].source})`,
  );
  await sleep(500);
}

const fixture = {
  query: {
    api: API,
    params: scan ? scanParams : { ...COMMON, TLIST_TYPE: "'JD'" },
    commands: BODIES.map(({ id }) => id),
    timeScale: 'TDB',
    frame: 'heliocentric ecliptic J2000 (IAU 1976 obliquity 84381.448″), geometric, AU',
    signature,
    headers,
    ...(scan ? {} : { epochs: EPOCHS, worst: WORST, icrfEpochs: ICRF_EPOCHS }),
  },
  fetchedAt: new Date().toISOString(),
  results,
  ...(scan ? {} : { icrf }),
};

const out = scan
  ? resolve(scanFile)
  : resolve(import.meta.dirname, '../tests/fixtures/horizons.json');
let text = JSON.stringify(fixture, null, scan ? undefined : 2) + '\n';
if (!scan) {
  // Write the fixture the way the repo's Prettier would, so `npm run format:check` stays clean.
  try {
    const prettier = await import('prettier');
    text = await prettier.format(text, { ...(await prettier.resolveConfig(out)), parser: 'json' });
  } catch {
    // Prettier is a dev dependency; without it the plain JSON is just as valid.
  }
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, text);
console.log(`\n${results.length} positions${scan ? '' : ` + ${icrf.length} in ICRF`} → ${out}`);
