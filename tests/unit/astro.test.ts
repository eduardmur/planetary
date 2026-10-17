// src/astro/ under test: Julian dates, Kepler's equation, orbit geometry, rotation poles, and the
// two-body model against JPL Horizons (tests/fixtures/horizons.json, from scripts/fetch-horizons.mjs).
//
// Every planetary number below is read off NASA's pages in data/raw/; the first test re-reads the
// pages to make sure the transcription is exact. The references the model is checked against are
// independent of it: JPL Horizons (positions, and its own equatorial ↔ ecliptic rotation), Meeus'
// worked examples, exact arithmetic for Kepler's equation, and formulas written out again here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  J2000,
  OBLIQUITY_J2000,
  aphelionDistance,
  centuriesSinceJ2000,
  dateFromJulian,
  daysSinceJ2000,
  eccentricAnomalyAt,
  eccentricAnomalyFromTrue,
  eclipticLonLat,
  julianDate,
  meanAnomalyAt,
  meanMotion,
  orbitFrame,
  orbitPointAtTrueAnomaly,
  orbitPolyline,
  perihelionDistance,
  poleToEcliptic,
  positionAt,
  radiusAt,
  solveKepler,
  toJulian,
  trueAnomaly,
  trueAnomalyAt,
  type MeanElements,
  type Vec3,
} from '../../src/astro/index.ts';

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

// ── NASA's numbers ──────────────────────────────────────────────────────────────────────────────

interface Body {
  /** JPL Horizons id of the body's centre. */
  id: number;
  name: string;
  /** The fact sheet in data/raw/. */
  page: string;
  /** "Mean Orbital Elements (J2000)", and the "Sidereal orbit period (days)" of "Orbital parameters". */
  el: MeanElements;
  /** "Orbital parameters" perihelion and aphelion, 10⁶ km: osculating values at JD 2459000.5. */
  perihelion: number;
  aphelion: number;
  /** "North Pole of Rotation" right ascension and declination at J2000 as printed, degrees.
   *  Pluto's sheet gives its "Positive Pole" instead. Neptune's adds a periodic term (below). */
  pole: [number, number];
  /** +1 if the pole above is the spin axis by the right-hand rule, −1 if it is the opposite end:
   *  Venus and Uranus turn backwards about their IAU north poles. */
  spin: 1 | -1;
  /** "Obliquity to orbit (deg)": spin axis (right-hand rule) to orbit normal. */
  obliquity: number;
}

// prettier-ignore
const BODIES: Body[] = [
  { id: 199, name: 'Mercury', page: 'mercuryfact.html',
    el: { a: 0.38709893, e: 0.20563069, i: 7.00487, node: 48.33167, peri: 77.45645, L: 252.25084, period: 87.969 },
    perihelion: 46.0, aphelion: 69.818, pole: [281.01, 61.414], spin: 1, obliquity: 0.034 },
  { id: 299, name: 'Venus', page: 'venusfact.html',
    el: { a: 0.72333199, e: 0.00677323, i: 3.39471, node: 76.68069, peri: 131.53298, L: 181.97973, period: 224.701 },
    perihelion: 107.48, aphelion: 108.941, pole: [272.76, 67.16], spin: -1, obliquity: 177.36 },
  { id: 399, name: 'Earth', page: 'earthfact.html',
    el: { a: 1.00000011, e: 0.01671022, i: 0.00005, node: -11.26064, peri: 102.94719, L: 100.46435, period: 365.256 },
    perihelion: 147.095, aphelion: 152.1, pole: [0, 90], spin: 1, obliquity: 23.44 },
  { id: 499, name: 'Mars', page: 'marsfact.html',
    el: { a: 1.52366231, e: 0.09341233, i: 1.85061, node: 49.57854, peri: 336.04084, L: 355.45332, period: 686.98 },
    perihelion: 206.65, aphelion: 249.261, pole: [317.681, 52.887], spin: 1, obliquity: 25.19 },
  { id: 599, name: 'Jupiter', page: 'jupiterfact.html',
    el: { a: 5.20336301, e: 0.04839266, i: 1.3053, node: 100.55615, peri: 14.75385, L: 34.40438, period: 4332.589 },
    perihelion: 740.595, aphelion: 816.363, pole: [268.057, 64.495], spin: 1, obliquity: 3.13 },
  { id: 699, name: 'Saturn', page: 'saturnfact.html',
    el: { a: 9.53707032, e: 0.0541506, i: 2.48446, node: 113.71504, peri: 92.43194, L: 49.94432, period: 10755.699 },
    perihelion: 1357.554, aphelion: 1506.527, pole: [40.589, 83.537], spin: 1, obliquity: 26.73 },
  { id: 799, name: 'Uranus', page: 'uranusfact.html',
    el: { a: 19.19126393, e: 0.04716771, i: 0.76986, node: 74.22988, peri: 170.96424, L: 313.23218, period: 30685.4 },
    perihelion: 2732.696, aphelion: 3001.39, pole: [257.311, -15.175], spin: -1, obliquity: 97.77 },
  { id: 899, name: 'Neptune', page: 'neptunefact.html',
    el: { a: 30.06896348, e: 0.00858587, i: 1.76917, node: 131.72169, peri: 44.97135, L: 304.88003, period: 60189.018 },
    perihelion: 4471.05, aphelion: 4558.857, pole: [299.36, 43.46], spin: 1, obliquity: 28.32 },
  { id: 999, name: 'Pluto', page: 'plutofact.html',
    el: { a: 39.48168677, e: 0.24880766, i: 17.14175, node: 110.30347, peri: 224.06676, L: 238.92881, period: 90560 },
    perihelion: 4434.987, aphelion: 7304.326, pole: [132.99, -6.16], spin: 1, obliquity: 119.51 },
];

const body = (name: string): Body => BODIES.find((b) => b.name === name)!;

/** Pluto's column of the main table (index.html), which is derived from the J2000 elements. */
const MAIN_TABLE_PLUTO = { distance: 5906.4, perihelion: 4436.8, aphelion: 7375.9 };

/** fact_notes.html, "Related Definitions": 1 AU = 149,597,870.7 km. */
const AU_KM = 149_597_870.7;

/** Neptune's pole at J2000 from its printed formula: RA = 299.36 + 0.70 sin N, Dec = 43.46 − 0.51 cos N,
 *  N = 357.85 + 52.316T degrees. */
function neptunePole(T: number): [number, number] {
  const N = (357.85 + 52.316 * T) * DEG;
  return [299.36 + 0.7 * Math.sin(N), 43.46 - 0.51 * Math.cos(N)];
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3) => scale(a, 1 / norm(a));
const dist = (a: Vec3, b: Vec3) => norm(sub(a, b));
/** Angle between two vectors, degrees (atan2 form: accurate near 0° and 180°). */
const angle = (a: Vec3, b: Vec3) => Math.atan2(norm(cross(a, b)), dot(a, b)) / DEG;
/** Difference of two angles in degrees, wrapped to (−180, 180]. */
const wrap180 = (deg: number) => deg - 360 * Math.ceil((deg - 180) / 360);

/** Ecliptic longitude/latitude (degrees) and distance, computed here independently of src/astro/. */
function spherical([x, y, z]: Vec3) {
  const r = Math.hypot(x, y, z);
  return { lon: Math.atan2(y, x) / DEG, lat: Math.asin(z / r) / DEG, r };
}

/** Rotation matrices about z and x by t radians, rows of columns: R·v for a column vector v. */
type Mat3 = [Vec3, Vec3, Vec3];
const Rz = (t: number): Mat3 => [
  [Math.cos(t), -Math.sin(t), 0],
  [Math.sin(t), Math.cos(t), 0],
  [0, 0, 1],
];
const Rx = (t: number): Mat3 => [
  [1, 0, 0],
  [0, Math.cos(t), -Math.sin(t)],
  [0, Math.sin(t), Math.cos(t)],
];
const matmul = (A: Mat3, B: Mat3): Mat3 =>
  A.map((row) =>
    [0, 1, 2].map((j) => row[0] * B[0][j]! + row[1] * B[1][j]! + row[2] * B[2][j]!),
  ) as Mat3;
const column = (A: Mat3, j: number): Vec3 => [A[0][j]!, A[1][j]!, A[2][j]!];

/**
 * Heliocentric ecliptic position by a second, separately written route (Meeus, Astronomical
 * Algorithms, ch. 30 and 33): M from the mean longitude in degrees, E by fixed-point iteration
 * E = M + e·sin E, ν by the half-angle formula, then the argument of latitude u = ω + ν turned
 * through i about the line of nodes and through Ω about the ecliptic pole.
 */
function meeusPosition(el: MeanElements, jd: number): Vec3 {
  const M = ((((el.L - el.peri + (360 / el.period) * (jd - 2451545.0)) % 360) + 360) % 360) * DEG;
  let E = M;
  for (let k = 0; k < 200; k++) E = M + el.e * Math.sin(E);
  const nu =
    2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  const r = el.a * (1 - el.e * Math.cos(E));
  const u = (el.peri - el.node) * DEG + nu;
  const O = el.node * DEG;
  const i = el.i * DEG;
  return [
    r * (Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(i)),
    r * (Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(i)),
    r * Math.sin(u) * Math.sin(i),
  ];
}

// Exact arithmetic for Kepler's equation. M, e and E are doubles, hence exact binary fractions;
// in 256-bit fixed point E − e·sin E − M is evaluated with no rounding worth the name (sin and cos
// by their Taylor series), so g/g′ is the true distance from E to the root, to first order.
const FIXED_BITS = 256n;
const FIXED_ONE = 1n << FIXED_BITS;
/** Exact for 2⁻²⁰⁴ ≤ |x| < 2⁷⁶⁷ (and 0); BigInt() throws on anything it cannot represent exactly. */
const fixed = (x: number) => BigInt(x * 2 ** 256);
const fixedMul = (a: bigint, b: bigint) => (a * b) >> FIXED_BITS;
function fixedSinCos(x: bigint): [bigint, bigint] {
  let term = FIXED_ONE; // xⁿ / n!
  let s = 0n;
  let c = 0n;
  for (let n = 0; term !== 0n; n++) {
    if (n > 0) term = fixedMul(term, x) / BigInt(n);
    if (n % 4 === 0) c += term;
    else if (n % 4 === 1) s += term;
    else if (n % 4 === 2) c -= term;
    else s -= term;
  }
  return [s, c];
}
/** E − E*, where E* is the exact root of Kepler's equation for this M and e. */
function keplerError(M: number, e: number, E: number): number {
  const [s, c] = fixedSinCos(fixed(E));
  const g = fixed(E) - fixedMul(fixed(e), s) - fixed(M);
  return Number(g) / Number(FIXED_ONE - fixedMul(fixed(e), c));
}

const RAW = new URL('../../data/raw/', import.meta.url);
const readPage = (file: string) => readFileSync(new URL(file, RAW), 'utf8');

/** The first number after `label`, skipping spaces, tags and &nbsp;; thousands commas dropped. */
function numberAfter(html: string, label: string): number {
  const at = html.indexOf(label);
  if (at < 0) throw new Error(`"${label}" not found`);
  const m = /^(?:\s|&nbsp;|<[^>]*>)*([-+]?[\d,]*\.?\d+)/.exec(html.slice(at + label.length));
  if (!m) throw new Error(`no number after "${label}"`);
  return Number(m[1]!.replace(/,/g, ''));
}

// ── the JPL Horizons fixture ────────────────────────────────────────────────────────────────────

interface HorizonsRow {
  id: number;
  name: string;
  /** Julian date, TDB. */
  jd: number;
  /** Horizons' calendar date for jd (TDB), e.g. "1990-Jan-01 00:00:00.0000". */
  calendar: string;
  x: number;
  y: number;
  z: number;
}
interface HorizonsHeader {
  target: string;
  center: string;
  site: string;
  frame: string;
  source: string;
}
interface HorizonsFile {
  query: {
    params: Record<string, string>;
    frame: string;
    headers: Record<string, HorizonsHeader>;
    /** Fixture only: the shared epochs, each body's worst-error dates, and the ICRF epochs. */
    epochs?: string[];
    worst?: Record<string, string[]>;
    icrfEpochs?: string[];
  };
  fetchedAt: string;
  results: HorizonsRow[];
  /** Fixture only: some of the same positions in Horizons' equatorial ICRF frame. */
  icrf?: HorizonsRow[];
}

const readHorizons = (url: URL | string): HorizonsFile => JSON.parse(readFileSync(url, 'utf8'));
const fixture = readHorizons(new URL('../fixtures/horizons.json', import.meta.url));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "1990-Jan-01 00:00:00.0000" read as if it were UTC (the model does not tell time scales apart). */
function calendarDate(calendar: string): Date {
  const m = /^(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}\.\d+)$/.exec(calendar);
  if (!m) throw new Error(`unreadable Horizons date "${calendar}"`);
  const [y, mon, d, hh, mm, ss] = m.slice(1) as string[];
  return new Date(
    Date.UTC(Number(y), MONTHS.indexOf(mon!), Number(d), Number(hh), Number(mm)) +
      Number(ss) * 1000,
  );
}

/** Model minus Horizons: longitude and latitude in degrees, distance in percent. */
function errors(el: MeanElements, row: HorizonsRow) {
  const model = spherical(positionAt(el, row.jd));
  const truth = spherical([row.x, row.y, row.z]);
  return {
    lon: wrap180(model.lon - truth.lon),
    lat: model.lat - truth.lat,
    r: (100 * (model.r - truth.r)) / truth.r,
  };
}

// Measured (model − Horizons), worst |error| per body. "epochs": the fixture's five shared dates
// (1990-01-01, J2000, 2026-10-17, 2040-06-01, 2060-01-01). "scan": every day 1990-01-01 … 2060-01-01;
// the dates of its worst errors are in the fixture too, so the rows below test the tolerances where
// they are tight (an hourly scan around Mercury's moves its peaks by under 0.2 %). "tol": the scan
// value plus 2 %, rounded up to two figures.
//
//            Δlon (deg)                Δlat (deg)                  Δr (%)
//            epochs  scan    tol       epochs  scan     tol        epochs  scan    tol
//   Mercury  0.158   0.453   0.47      0.0086  0.0450   0.046      0.066   0.139   0.15
//   Venus    0.038   0.038   0.04      0.0082  0.0121   0.013      0.004   0.0068  0.007
//   Earth    0.031   0.034   0.036     0.0077  0.0081   0.0084     0.006   0.0126  0.013
//   Mars     0.047   0.083   0.085     0.0063  0.0093   0.0096     0.025   0.056   0.058
//   Jupiter  0.229   0.257   0.27      0.0035  0.0055   0.0057     0.078   0.097   0.099
//   Saturn   0.290   0.291   0.3       0.0118  0.0163   0.017      0.153   0.164   0.17
//   Uranus   0.030   0.034   0.035     0.0041  0.0042   0.0043     0.065   0.068   0.07
//   Neptune  0.012   0.017   0.018     0.0021  0.0022   0.0023     0.033   0.037   0.039
//   Pluto    0.016   0.023   0.024     0.0039  0.0040   0.0041     0.026   0.035   0.036
//
// Wider, over 1900–2100 (a two-day scan): Mercury 0.76° (at 1900), Jupiter 0.31°, Saturn 0.29°,
// Mars 0.12°, the rest under 0.07°; latitude under 0.08°, distance under 0.24 %. Over 2020–2030:
// Mercury 0.23°, Jupiter 0.09°, the rest under 0.05°.
//
// Where the error comes from: Jupiter and Saturn pull on each other (the "great inequality"), which
// no fixed ellipse follows. Mercury's grows steadily, about 0.075° per decade away from J2000,
// because the printed period 87.969 d is rounded: 87.96926 d (the mean-longitude rate of the fit
// NASA's elements come from, which the sheets do not print) brings Mercury's 1990–2060 worst down
// to 0.050°. Latitude errors are mostly the along-track error times sin i; Earth's is the drift of
// its orbit plane away from the J2000 ecliptic, about 47″ per century.
const TOLERANCE: Record<string, { lon: number; lat: number; r: number }> = {
  Mercury: { lon: 0.47, lat: 0.046, r: 0.15 },
  Venus: { lon: 0.04, lat: 0.013, r: 0.007 },
  Earth: { lon: 0.036, lat: 0.0084, r: 0.013 },
  Mars: { lon: 0.085, lat: 0.0096, r: 0.058 },
  Jupiter: { lon: 0.27, lat: 0.0057, r: 0.099 },
  Saturn: { lon: 0.3, lat: 0.017, r: 0.17 },
  Uranus: { lon: 0.035, lat: 0.0043, r: 0.07 },
  Neptune: { lon: 0.018, lat: 0.0023, r: 0.039 },
  Pluto: { lon: 0.024, lat: 0.0041, r: 0.036 },
};

/** The one line the drawings print: within 0.5° in longitude, 0.05° in latitude and 0.2 % in
 *  distance of JPL Horizons, 1990–2060, for every body. */
const CLAIM = { lon: 0.5, lat: 0.05, r: 0.2 };

/** The span the tolerances and the claim are measured over. */
const SPAN = {
  from: julianDate(new Date('1990-01-01T00:00Z')),
  to: julianDate(new Date('2060-01-01T00:00Z')),
};

// ── tests ───────────────────────────────────────────────────────────────────────────────────────

describe('NASA values used in these tests', () => {
  it.each(BODIES)('$name matches data/raw/$page', (b) => {
    const html = readPage(b.page);
    const block = /Mean Orbital Elements \(J2000\)<\/h3>\s*<pre>([\s\S]*?)<\/pre>/
      .exec(html)?.[1]
      ?.toLowerCase();
    expect(block, 'Mean Orbital Elements block').toBeDefined();
    const elements = (label: string) => numberAfter(block!, label);
    expect({
      a: elements('semimajor axis (au)'),
      e: elements('orbital eccentricity'),
      i: elements('orbital inclination (deg)'),
      node: elements('longitude of ascending node (deg)'),
      peri: elements('longitude of perihelion (deg)'),
      L: elements('mean longitude (deg)'),
      period: numberAfter(html, 'Sidereal orbit period (days)'),
    }).toEqual(b.el);
    expect(numberAfter(html, 'Perihelion (10<sup>6</sup> km)')).toBe(b.perihelion);
    expect(numberAfter(html, 'Aphelion (10<sup>6</sup> km)')).toBe(b.aphelion);
    expect(numberAfter(html, 'Obliquity to orbit (deg)')).toBe(b.obliquity);
    const ra = /Right Ascension\s*:\s*([-+]?[\d.]+)/.exec(html)?.[1];
    const dec = /Declination\s*:\s*([-+]?[\d.]+)/.exec(html)?.[1];
    expect([Number(ra), Number(dec)]).toEqual(b.pole);
    expect(html.includes('Positive Pole of Rotation')).toBe(b.name === 'Pluto');
  });

  it("Pluto's column of the main table", () => {
    const rows = readPage('index.html').split('<tr>');
    const pluto = (label: string) => {
      const row = rows.find((tr) => tr.includes(`>${label}</a> (10<sup>6</sup> km)`));
      const cells = [...(row ?? '').matchAll(/<td align=center[^>]*>([^<]*)<\/td>/g)];
      expect(cells, label).toHaveLength(10); // Mercury … Pluto, with the Moon
      return Number(cells[9]![1]!.replace(/,/g, ''));
    };
    expect({
      distance: pluto('Distance from Sun'),
      perihelion: pluto('Perihelion'),
      aphelion: pluto('Aphelion'),
    }).toEqual(MAIN_TABLE_PLUTO);
  });

  it('the astronomical unit', () => {
    expect(readPage('fact_notes.html')).toContain('149,597,870.7 km');
  });
});

describe('time', () => {
  it('J2000 is JD 2451545.0, 2000-01-01 12:00 UTC', () => {
    const noon = new Date(Date.UTC(2000, 0, 1, 12));
    expect(J2000).toBe(2451545.0);
    expect(julianDate(noon)).toBe(J2000);
    expect(daysSinceJ2000(noon)).toBe(0);
    expect(dateFromJulian(J2000).toISOString()).toBe('2000-01-01T12:00:00.000Z');
  });

  it('known Julian dates', () => {
    expect(julianDate(new Date(0))).toBe(2440587.5); // 1970-01-01T00:00Z
    // Meeus, Astronomical Algorithms, example 7.a: 1957 October 4.81 (Sputnik 1) = JD 2436116.31.
    expect(julianDate(new Date(Date.UTC(1957, 9, 4, 19, 26, 24)))).toBeCloseTo(2436116.31, 8);
    expect(julianDate(new Date('2026-10-17T00:00:00Z'))).toBe(2461330.5);
    // Meeus, ch. 7, the Gregorian dates of his table of examples
    for (const [iso, jd] of [
      ['1999-01-01T00:00:00Z', 2451179.5],
      ['1987-01-27T00:00:00Z', 2446822.5],
      ['1987-06-19T12:00:00Z', 2446966.0],
      ['1988-01-27T00:00:00Z', 2447187.5],
      ['1988-06-19T12:00:00Z', 2447332.0],
      ['1900-01-01T00:00:00Z', 2415020.5],
      ['1600-01-01T00:00:00Z', 2305447.5],
      ['1600-12-31T00:00:00Z', 2305812.5],
    ] as const) {
      expect(julianDate(new Date(iso)), iso).toBe(jd);
    }
  });

  it("agrees with Horizons' own calendar ↔ JD conversion", () => {
    for (const row of [...fixture.results, ...(fixture.icrf ?? [])]) {
      expect(julianDate(calendarDate(row.calendar)), row.calendar).toBe(row.jd);
    }
  });

  it('days and centuries since J2000, from a Date or a JD', () => {
    const date = new Date('2100-01-01T12:00:00Z');
    expect(daysSinceJ2000(date)).toBe(36525);
    expect(centuriesSinceJ2000(date)).toBe(1);
    expect(daysSinceJ2000(J2000 - 0.5)).toBe(-0.5);
    expect(daysSinceJ2000(date)).toBeCloseTo(daysSinceJ2000(julianDate(date)), 9);
    expect(toJulian(2461330.5)).toBe(2461330.5);
    expect(toJulian(date)).toBe(julianDate(date));
  });

  it("NASA's osculating epoch, JD 2459000.5, is 2020-05-31", () => {
    // fact_notes.html prints "Julian Date 2459000.5 (11 June 2020)"; 11 June is JD 2459011.5.
    expect(dateFromJulian(2459000.5).toISOString()).toBe('2020-05-31T00:00:00.000Z');
    expect(readPage('fact_notes.html')).toContain('Julian Date 2459000.5 (11 June 2020)');
  });

  it('dateFromJulian inverts julianDate to the millisecond', () => {
    for (const iso of [
      '1957-10-04T19:26:24.000Z',
      '1990-01-01T00:00:00.000Z',
      '2026-10-17T13:37:42.123Z',
      '2060-01-01T00:00:00.001Z',
    ]) {
      expect(dateFromJulian(julianDate(new Date(iso))).toISOString()).toBe(iso);
    }
  });
});

describe('solveKepler', () => {
  const ECCENTRICITIES = [
    0, 1e-9, 0.00677323, 0.01671022, 0.0934, 0.2056, 0.25, 0.2488, 0.5, 0.9, 0.99, 0.999999,
  ];
  const residual = (M: number, e: number) => {
    const E = solveKepler(M, e);
    return E - e * Math.sin(E) - M;
  };

  it('leaves E − e·sin E − M at the rounding floor, with |E − M| ≤ e, for M over ±2 turns', () => {
    for (const e of ECCENTRICITIES) {
      for (let k = -800; k <= 800; k++) {
        const M = (k * Math.PI) / 200;
        const E = solveKepler(M, e);
        const floor = 4 * Number.EPSILON * Math.max(1, Math.abs(M));
        expect(Math.abs(E - e * Math.sin(E) - M), `e=${e} M=${M}`).toBeLessThanOrEqual(floor);
        expect(Math.abs(E - M), `e=${e} M=${M}`).toBeLessThanOrEqual(e + 1e-15);
      }
    }
  });

  // The exact root for every e = 0, 0.01, …, 0.98, 0.98999… and M over a turn, with M next to
  // perihelion and aphelion: E may differ from it only by what rounding in E − e·sin E − M forces,
  // ε·max(|E|, |M|) over the slope 1 − e·cos E (measured worst 1.30 of that over a 1000 × 4800 sweep).
  it('is as close to the exact root as rounding allows, for every e < 0.99', () => {
    const Ms = Array.from({ length: 360 }, (_, k) => (TAU * (k + 1)) / 360); // M = 0 is exact
    for (let p = -30; p <= -1; p++) {
      const d = 10 ** p;
      Ms.push(d, Math.PI - d, Math.PI + d, TAU - d);
    }
    let worst = 0;
    let worstAt = '';
    for (let k = 0; k <= 99; k++) {
      const e = k < 99 ? k / 100 : 0.9899999999999999;
      for (const M of Ms) {
        const E = solveKepler(M, e);
        const floor = (Number.EPSILON * Math.max(Math.abs(E), M)) / (1 - e * Math.cos(E));
        const ratio = Math.abs(keplerError(M, e, E)) / floor;
        if (ratio > worst) [worst, worstAt] = [ratio, `e=${e} M=${M}`];
      }
    }
    expect(worst, worstAt).toBeLessThan(1.5);
  });

  it('returns M itself for a circle', () => {
    for (const M of [0, 1e-300, 0.1, Math.PI, 5, -7, 1000]) expect(solveKepler(M, 0)).toBe(M);
  });

  it("matches Meeus' worked examples (Astronomical Algorithms, ch. 30)", () => {
    expect(solveKepler(5 * DEG, 0.1) / DEG).toBeCloseTo(5.554589, 6); // example 30.a
    expect(solveKepler(2 * DEG, 0.99) / DEG).toBeCloseTo(32.361007, 6); // example 30.b
  });

  it('agrees with plain bisection at e = 0.25', () => {
    const e = 0.25;
    for (const M of [0.001, 0.3, 1, 2, 3, Math.PI, 4, 5.5, 6.28]) {
      let lo = M - e;
      let hi = M + e;
      for (let k = 0; k < 200; k++) {
        const mid = 0.5 * (lo + hi);
        if (mid - e * Math.sin(mid) < M) lo = mid;
        else hi = mid;
      }
      expect(Math.abs(solveKepler(M, e) - 0.5 * (lo + hi)), `M=${M}`).toBeLessThan(1e-14);
    }
  });

  it('stays accurate next to perihelion, M near 0 and near 2π', () => {
    for (const e of [0.25, 0.9, 0.999999]) {
      for (const d of [1e-300, 1e-100, 1e-15, 1e-12, 1e-9, 1e-6, 1e-3]) {
        for (const M of [d, -d, TAU - d, TAU + d]) {
          expect(Math.abs(residual(M, e)), `e=${e} M=${M}`).toBeLessThan(1e-12);
        }
        // E → M/(1 − e) as M → 0: the slope of Kepler's equation at perihelion
        if (d <= 1e-12) expect(Math.abs((solveKepler(d, e) * (1 - e)) / d - 1)).toBeLessThan(1e-6);
      }
      expect(solveKepler(0, e)).toBe(0);
      expect(solveKepler(TAU, e)).toBe(TAU);
      expect(solveKepler(Math.PI, e)).toBeCloseTo(Math.PI, 15);
    }
  });

  it('keeps the revolution count and the symmetry: E(M + 2π) = E(M) + 2π, E(−M) = −E(M)', () => {
    for (const e of [0.0167, 0.2488, 0.9]) {
      for (const M of [0.2, 1.5, 3, 4.5, 6]) {
        expect(solveKepler(M + TAU, e) - TAU).toBeCloseTo(solveKepler(M, e), 13);
        expect(solveKepler(M - 3 * TAU, e) + 3 * TAU).toBeCloseTo(solveKepler(M, e), 12);
        expect(solveKepler(-M, e)).toBe(-solveKepler(M, e));
      }
    }
    expect(Math.abs(residual(1000, 0.2056))).toBeLessThan(1e-12);
  });

  it('increases with M', () => {
    for (const e of [0.2488, 0.999999]) {
      let previous = -Infinity;
      for (let k = -1000; k <= 3000; k++) {
        const E = solveKepler(k * 0.00631, e);
        expect(E).toBeGreaterThan(previous);
        previous = E;
      }
    }
  });

  it('rejects eccentricities outside [0, 1) and passes NaN through', () => {
    for (const e of [-0.1, 1, 1.5, Number.NaN]) expect(() => solveKepler(1, e)).toThrow(RangeError);
    expect(solveKepler(Number.NaN, 0.1)).toBeNaN();
  });
});

describe('trueAnomaly', () => {
  it('is 0 at perihelion, π at aphelion, and E itself for a circle', () => {
    for (const e of [0, 0.2056, 0.9]) {
      expect(trueAnomaly(0, e)).toBe(0);
      expect(trueAnomaly(Math.PI, e)).toBeCloseTo(Math.PI, 15);
    }
    for (const E of [0.3, 2, -4, 9]) expect(trueAnomaly(E, 0)).toBe(E);
  });

  it('satisfies tan(ν/2) = √((1 + e)/(1 − e))·tan(E/2), keeps E’s revolution, and inverts', () => {
    for (const e of [0.0167, 0.2056, 0.2488, 0.9, 0.999]) {
      for (let k = -700; k <= 700; k++) {
        const E = k * 0.0123;
        const nu = trueAnomaly(E, e);
        const halfAngle =
          2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
        expect(Math.abs(wrap180((nu - halfAngle) / DEG))).toBeLessThan(1e-10);
        expect(Math.abs(nu - E)).toBeLessThan(Math.PI);
        expect(eccentricAnomalyFromTrue(nu, e)).toBeCloseTo(E, 11);
        // the same distance from the Sun both ways: a(1 − e·cos E) = a(1 − e²)/(1 + e·cos ν)
        expect(1 - e * Math.cos(E)).toBeCloseTo((1 - e * e) / (1 + e * Math.cos(nu)), 11);
      }
    }
  });
});

describe('orbit geometry', () => {
  it.each(BODIES)('$name: orbitFrame is orthonormal and right-handed', ({ el }) => {
    const {
      perihelionDir: P,
      minorDir: Q,
      normal: W,
      ascendingNodeDir: N,
      centre,
    } = orbitFrame(el);
    for (const v of [P, Q, W, N]) expect(norm(v)).toBeCloseTo(1, 15);
    expect(dot(P, Q)).toBeCloseTo(0, 15);
    expect(dot(P, W)).toBeCloseTo(0, 15);
    expect(dot(Q, W)).toBeCloseTo(0, 15);
    expect(dist(cross(P, Q), W)).toBeLessThan(1e-15);
    // the line of nodes lies in the ecliptic and in the orbit plane, the normal is i from the pole
    expect(N[2]).toBe(0);
    expect(dot(N, W)).toBeCloseTo(0, 15);
    expect(W[2]).toBeCloseTo(Math.cos(el.i * DEG), 15);
    expect(angle(W, [0, 0, 1])).toBeCloseTo(el.i, 9);
    // perihelion is ω = ϖ − Ω past the node, in the direction of motion
    expect(
      wrap180(Math.atan2(dot(cross(N, P), W), dot(N, P)) / DEG - (el.peri - el.node)),
    ).toBeCloseTo(0, 9);
    expect(dist(centre, scale(P, -el.a * el.e))).toBeLessThan(1e-15);
  });

  it.each(BODIES)('$name: orbitFrame is the rotation Rz(Ω)·Rx(i)·Rz(ϖ − Ω)', ({ el }) => {
    // orbit plane → ecliptic: turn by ω in the plane, tilt by i about the node line, turn by Ω
    const R = matmul(matmul(Rz(el.node * DEG), Rx(el.i * DEG)), Rz((el.peri - el.node) * DEG));
    const { perihelionDir, minorDir, normal } = orbitFrame(el);
    expect(dist(perihelionDir, column(R, 0))).toBeLessThan(1e-15);
    expect(dist(minorDir, column(R, 1))).toBeLessThan(1e-15);
    expect(dist(normal, column(R, 2))).toBeLessThan(1e-15);
  });

  it.each(BODIES)(
    '$name: orbitPolyline is the closed ellipse with the Sun at a focus',
    ({ el }) => {
      const n = 360;
      const points = orbitPolyline(el, n);
      const { perihelionDir: P, normal: W, centre } = orbitFrame(el);
      const otherFocus = scale(centre, 2);
      expect(points).toHaveLength(n + 1);
      expect(points[n]).toEqual(points[0]);
      expect(dist(points[0]!, scale(P, perihelionDistance(el)))).toBeLessThan(1e-14 * el.a);
      expect(dist(points[n / 2]!, scale(P, -aphelionDistance(el)))).toBeLessThan(1e-14 * el.a);
      for (const p of points) {
        expect(Math.abs(dot(p, W))).toBeLessThan(1e-14 * el.a);
        expect(norm(p) + dist(p, otherFocus)).toBeCloseTo(2 * el.a, 12);
      }
      expect(() => orbitPolyline(el, 2)).toThrow(RangeError);
    },
  );

  it.each(BODIES)('$name: orbitPointAtTrueAnomaly', ({ el }) => {
    const { perihelionDir: P, ascendingNodeDir: N } = orbitFrame(el);
    const argPeri = el.peri - el.node;
    expect(dist(orbitPointAtTrueAnomaly(el, 0), scale(P, perihelionDistance(el)))).toBeLessThan(
      1e-14 * el.a,
    );
    expect(dist(orbitPointAtTrueAnomaly(el, 180), scale(P, -aphelionDistance(el)))).toBeLessThan(
      1e-13 * el.a,
    );
    // at the ascending node it crosses the ecliptic northwards along N, and 90° later it is
    // highest above it, at r·sin i
    const atNode = orbitPointAtTrueAnomaly(el, -argPeri);
    expect(Math.abs(atNode[2])).toBeLessThan(1e-14 * el.a);
    expect(angle(atNode, N)).toBeCloseTo(0, 6);
    expect(orbitPointAtTrueAnomaly(el, 1 - argPeri)[2]).toBeGreaterThan(0);
    const highest = orbitPointAtTrueAnomaly(el, 90 - argPeri);
    expect(highest[2]).toBeCloseTo(norm(highest) * Math.sin(el.i * DEG), 13);
  });

  it.each(BODIES)('$name: positionAt, the anomalies and radiusAt agree', ({ el }) => {
    for (const jd of [J2000 - 12345.6, J2000, J2000 + 9781.25, J2000 + 21915]) {
      const p = positionAt(el, jd);
      const M = meanAnomalyAt(el, jd);
      const E = eccentricAnomalyAt(el, jd);
      const nu = trueAnomalyAt(el, jd);
      for (const angleDeg of [M, E, nu]) {
        expect(angleDeg).toBeGreaterThanOrEqual(0);
        expect(angleDeg).toBeLessThan(360);
      }
      expect(wrap180(E - (el.e * Math.sin(E * DEG)) / DEG - M)).toBeCloseTo(0, 9);
      expect(dist(p, orbitPointAtTrueAnomaly(el, nu))).toBeLessThan(1e-11 * el.a);
      expect(norm(p)).toBeCloseTo(radiusAt(el, jd), 12);
      expect(dist(positionAt(el, jd + el.period), p)).toBeLessThan(1e-9 * el.a);
    }
    // the elements' own epoch: M = L − ϖ, then n = 360°/period per day
    expect(wrap180(meanAnomalyAt(el, J2000) - (el.L - el.peri))).toBeCloseTo(0, 10);
    expect(meanMotion(el) * el.period).toBeCloseTo(360, 12);
    const day = wrap180(meanAnomalyAt(el, J2000 + 1) - meanAnomalyAt(el, J2000));
    expect(day).toBeCloseTo(meanMotion(el), 10);
    // a Date is the same instant as its JD
    expect(dist(positionAt(el, new Date('2026-10-17T00:00:00Z')), positionAt(el, 2461330.5))).toBe(
      0,
    );
  });

  it.each(BODIES)('$name: positionAt agrees with a separately written formula', ({ el }) => {
    // ±110 years around J2000, in steps that sample every part of every orbit
    for (let d = -40000; d <= 40000; d += 37.3) {
      expect(dist(positionAt(el, J2000 + d), meeusPosition(el, J2000 + d)), `${d}`).toBeLessThan(
        2e-12 * el.a,
      );
    }
  });

  it('eclipticLonLat', () => {
    expect(eclipticLonLat([1, 0, 0])).toEqual({ lon: 0, lat: 0, r: 1 });
    const south = eclipticLonLat([0, -2, 0]);
    expect(south.lon).toBeCloseTo(270, 12);
    expect(south.r).toBe(2);
    expect(eclipticLonLat([0, 0, 3]).lat).toBeCloseTo(90, 12);
    expect(eclipticLonLat([0.1, -1e-18, 0]).lon).toBeLessThan(360);
    const v: Vec3 = [-0.3, 0.4, -0.1];
    const ours = spherical(v);
    const theirs = eclipticLonLat(v);
    expect(theirs.lon).toBeCloseTo(ours.lon, 12);
    expect(theirs.lat).toBeCloseTo(ours.lat, 12);
    expect(theirs.r).toBeCloseTo(ours.r, 15);
  });
});

describe('poleToEcliptic', () => {
  const eps = OBLIQUITY_J2000 * DEG;

  it('turns the equatorial frame into the ecliptic one about the equinox, by 84381.448″', () => {
    expect(OBLIQUITY_J2000).toBe(84381.448 / 3600);
    expect(dist(poleToEcliptic(0, 0), [1, 0, 0])).toBeLessThan(1e-15);
    expect(dist(poleToEcliptic(90, 0), [0, Math.cos(eps), -Math.sin(eps)])).toBeLessThan(1e-15);
    // Earth's pole leans 23.44° from the ecliptic pole, towards ecliptic longitude 90°: latitude
    // 90° − ε = 66.56°
    expect(dist(poleToEcliptic(0, 90), [0, Math.sin(eps), Math.cos(eps)])).toBeLessThan(1e-15);
    expect(eclipticLonLat(poleToEcliptic(0, 90)).lat).toBeCloseTo(90 - OBLIQUITY_J2000, 12);
    // the ecliptic pole itself is at RA 270°, Dec 90° − ε
    expect(dist(poleToEcliptic(270, 90 - OBLIQUITY_J2000), [0, 0, 1])).toBeLessThan(1e-15);
    // the June solstice point, RA 90° and Dec +ε, lies on the ecliptic at longitude 90°
    expect(dist(poleToEcliptic(90, OBLIQUITY_J2000), [0, 1, 0])).toBeLessThan(1e-15);
    for (const [ra, dec] of [
      [12, 34],
      [281.01, 61.414],
      [257.311, -15.175],
    ] as const) {
      expect(norm(poleToEcliptic(ra, dec))).toBeCloseTo(1, 15);
    }
  });

  // Horizons gives the same heliocentric vectors in its equatorial ICRF frame and in its ecliptic
  // one. Their RA/Dec, through poleToEcliptic, must land on the ecliptic direction: a check of the
  // axis, the sign and the size of the rotation by JPL's own definition of the ecliptic frame.
  it("reproduces Horizons' own equatorial → ecliptic rotation", () => {
    const icrf = fixture.icrf ?? [];
    expect(icrf).toHaveLength(BODIES.length * 2);
    for (const eq of icrf) {
      const ecl = fixture.results.find((row) => row.id === eq.id && row.jd === eq.jd)!;
      expect(ecl, `${eq.name} ${eq.calendar}`).toBeDefined();
      // the rotation is about x, so x and the length are the same in both frames
      expect(eq.x).toBe(ecl.x);
      expect(norm([eq.x, eq.y, eq.z]) / norm([ecl.x, ecl.y, ecl.z])).toBeCloseTo(1, 14);
      const r = norm([eq.x, eq.y, eq.z]);
      const ra = Math.atan2(eq.y, eq.x) / DEG;
      const dec = Math.asin(eq.z / r) / DEG;
      expect(dist(poleToEcliptic(ra, dec), unit([ecl.x, ecl.y, ecl.z])), eq.name).toBeLessThan(
        1e-14,
      );
    }
  });

  // With orbitFrame's normal, the printed poles must give back NASA's printed "Obliquity to orbit":
  // a check of the frame rotation, its sign, and the pole conventions. Within 0.01° (the printed
  // precision) for all but Pluto, whose 119.51° is 0.096° from what its printed pole and J2000
  // orbit give (NASA's "Inclination of equator", 57.47°, is not 180° minus it either).
  it.each(BODIES)("$name: pole and orbit give NASA's obliquity", (b) => {
    const [ra, dec] = b.name === 'Neptune' ? neptunePole(0) : b.pole;
    const spinAxis = scale(poleToEcliptic(ra, dec), b.spin);
    const obliquity = angle(spinAxis, orbitFrame(b.el).normal);
    expect(Math.abs(obliquity - b.obliquity)).toBeLessThan(b.name === 'Pluto' ? 0.1 : 0.01);
  });

  it("NASA's pole formulas take T from centuriesSinceJ2000", () => {
    // Mars: RA = 317.681 − 0.106T, Dec = 52.887 − 0.061T; by 2026-10-17 (T = 0.268) the pole has
    // moved 0.024°
    const T = centuriesSinceJ2000(new Date('2026-10-17T00:00:00Z'));
    expect(T).toBeCloseTo(9785.5 / 36525, 15);
    const [ra, dec] = body('Mars').pole;
    expect(
      angle(poleToEcliptic(ra - 0.106 * T, dec - 0.061 * T), poleToEcliptic(ra, dec)),
    ).toBeCloseTo(0.0237, 4);
  });
});

describe('positionAt against JPL Horizons', () => {
  const julianOf = (iso: string) => julianDate(new Date(iso));

  it('the fixture: heliocentric (Sun centre), ecliptic J2000, geometric, AU, TDB', () => {
    const { params, headers } = fixture.query;
    expect(params['CENTER']).toBe("'500@10'");
    expect(params['REF_PLANE']).toBe("'ECLIPTIC'");
    expect(params['REF_SYSTEM']).toBe("'J2000'");
    expect(params['OUT_UNITS']).toBe("'AU-D'");
    expect(params['VEC_CORR']).toBe("'NONE'");
    expect(params['TIME_TYPE']).toBe("'TDB'");
    for (const b of BODIES) {
      // what Horizons says it computed, as printed in its header
      expect(headers[b.id], b.name).toMatchObject({
        target: `${b.name} (${b.id})`,
        center: 'Sun (10)',
        site: 'BODY CENTER',
        frame: 'Ecliptic of J2000.0',
      });
    }
    // and what the numbers say: Earth stays in the ecliptic (in the equatorial frame its z would
    // reach 0.4 AU), and every body is between its perihelion and aphelion distance in AU. (The
    // Sun's centre rather than the barycentre shows in Earth's Δr below: the two are up to 0.01 AU
    // apart, 70 times Earth's distance tolerance.)
    for (const row of fixture.results) {
      if (row.name === 'Earth') expect(Math.abs(row.z), row.calendar).toBeLessThan(2e-4);
      const { el } = body(row.name);
      const r = norm([row.x, row.y, row.z]);
      expect(r).toBeGreaterThan(el.a * (1 - el.e) * 0.99);
      expect(r).toBeLessThan(el.a * (1 + el.e) * 1.01);
    }
  });

  it("the fixture: every body at the shared epochs and at its scan's worst dates", () => {
    const { epochs, worst } = fixture.query;
    expect(epochs).toEqual([
      '1990-01-01T00:00:00Z',
      '2000-01-01T12:00:00Z',
      '2026-10-17T00:00:00Z',
      '2040-06-01T00:00:00Z',
      '2060-01-01T00:00:00Z',
    ]);
    for (const b of BODIES) {
      const days = worst?.[b.id] ?? [];
      expect(days, b.name).toHaveLength(3);
      const want = [...epochs!.map(julianOf), ...days.map((d) => julianOf(`${d}T00:00:00Z`))];
      const have = fixture.results.filter((row) => row.id === b.id).map((row) => row.jd);
      expect(
        have.toSorted((p, q) => p - q),
        b.name,
      ).toEqual([...new Set(want)].toSorted((p, q) => p - q));
    }
    expect(fixture.results.every((row) => row.jd >= SPAN.from && row.jd <= SPAN.to)).toBe(true);
  });

  it('per-body tolerances stay under the claim the drawings print (0.5°, 0.05°, 0.2 %)', () => {
    for (const b of BODIES) {
      const t = TOLERANCE[b.name]!;
      expect(t.lon).toBeLessThanOrEqual(CLAIM.lon);
      expect(t.lat).toBeLessThanOrEqual(CLAIM.lat);
      expect(t.r).toBeLessThanOrEqual(CLAIM.r);
    }
  });

  it.each(fixture.results)('$name $calendar', (row) => {
    const b = BODIES.find(({ id }) => id === row.id)!;
    const t = TOLERANCE[b.name]!;
    const err = errors(b.el, row);
    expect(Math.abs(err.lon), 'Δlon (deg)').toBeLessThan(t.lon);
    expect(Math.abs(err.lat), 'Δlat (deg)').toBeLessThan(t.lat);
    expect(Math.abs(err.r), 'Δr (%)').toBeLessThan(t.r);
  });

  // The tolerances are not loose where it matters: at each body's worst dates the error is within
  // 10 % of its tolerance (the 2 % margin plus rounding up to two figures).
  it.each(BODIES)('$name: the worst fixture rows sit just under the tolerances', (b) => {
    const worst = { lon: 0, lat: 0, r: 0 };
    for (const row of fixture.results.filter(({ id }) => id === b.id)) {
      const err = errors(b.el, row);
      worst.lon = Math.max(worst.lon, Math.abs(err.lon));
      worst.lat = Math.max(worst.lat, Math.abs(err.lat));
      worst.r = Math.max(worst.r, Math.abs(err.r));
    }
    const t = TOLERANCE[b.name]!;
    expect(worst.lon / t.lon, 'Δlon').toBeGreaterThan(0.9);
    expect(worst.lat / t.lat, 'Δlat').toBeGreaterThan(0.9);
    expect(worst.r / t.r, 'Δr').toBeGreaterThan(0.9);
  });
});

describe('perihelion and aphelion, a·(1 ∓ e)', () => {
  // NASA's "Orbital parameters" are osculating values at JD 2459000.5 (2020-05-31), not the 250-year
  // mean orbit, so they differ from a·(1 ∓ e) of the J2000 elements. Measured (q, Q): Mercury
  // +0.003%, −0.001%; Venus −0.004, +0.001; Earth +0.002, −0.002; Mars −0.003, −0.013; Jupiter
  // +0.020, −0.034; Saturn −0.596, −0.169; Uranus +0.105, +0.167; Neptune −0.255, −0.482; Pluto
  // +0.041, +0.980. (Pluto's osculating a is 39.236 AU against the mean 39.482.)
  it.each(BODIES)('$name: within 1% of the "Orbital parameters" values', (b) => {
    const q = (perihelionDistance(b.el) * AU_KM) / 1e6;
    const Q = (aphelionDistance(b.el) * AU_KM) / 1e6;
    expect(Math.abs(q / b.perihelion - 1)).toBeLessThan(0.01);
    expect(Math.abs(Q / b.aphelion - 1)).toBeLessThan(0.01);
  });

  // The only perihelion and aphelion NASA prints from the J2000 elements are Pluto's in the main
  // table (index.html); every other printed value, Pluto's own sheet included, is the 2020 one.
  it("matches the J2000-derived values: Pluto's main-table column, to its 0.1 × 10⁶ km", () => {
    const { el } = body('Pluto');
    expect(Math.abs((el.a * AU_KM) / 1e6 - MAIN_TABLE_PLUTO.distance)).toBeLessThan(0.05);
    expect(
      Math.abs((perihelionDistance(el) * AU_KM) / 1e6 - MAIN_TABLE_PLUTO.perihelion),
    ).toBeLessThan(0.05);
    expect(Math.abs((aphelionDistance(el) * AU_KM) / 1e6 - MAIN_TABLE_PLUTO.aphelion)).toBeLessThan(
      0.05,
    );
  });
});

// The fixture has each body's worst dates of a one-day scan. To repeat the scan (any step and
// range; only 1990–2060 is held to the tolerances):
//   node scripts/fetch-horizons.mjs --scan /tmp/scan.json
//   HORIZONS_SCAN=/tmp/scan.json npx vitest run tests/unit/astro.test.ts
const SCAN = process.env['HORIZONS_SCAN'];
describe.runIf(SCAN)('positionAt against a Horizons scan (HORIZONS_SCAN)', () => {
  let scan: HorizonsRow[] | undefined;
  it.each(BODIES)('$name stays within its tolerance at every scanned date, 1990–2060', (b) => {
    scan ??= readHorizons(SCAN!).results;
    const rows = scan.filter((row) => row.id === b.id && row.jd >= SPAN.from && row.jd <= SPAN.to);
    expect(rows.length).toBeGreaterThan(0);
    type Worst = { value: number; on: string };
    const worst: Record<'lon' | 'lat' | 'r', Worst> = {
      lon: { value: 0, on: '' },
      lat: { value: 0, on: '' },
      r: { value: 0, on: '' },
    };
    for (const row of rows) {
      const err = errors(b.el, row);
      for (const k of ['lon', 'lat', 'r'] as const) {
        if (Math.abs(err[k]) > worst[k].value)
          worst[k] = { value: Math.abs(err[k]), on: row.calendar };
      }
    }
    const t = TOLERANCE[b.name]!;
    const where = `worst on ${worst.lon.on} / ${worst.lat.on} / ${worst.r.on}`;
    expect(worst.lon.value, `Δlon (deg), ${where}`).toBeLessThan(t.lon);
    expect(worst.lat.value, `Δlat (deg), ${where}`).toBeLessThan(t.lat);
    expect(worst.r.value, `Δr (%), ${where}`).toBeLessThan(t.r);
    // the fixture still holds the worst dates (else update WORST in scripts/fetch-horizons.mjs)
    for (const k of ['lon', 'lat', 'r'] as const) {
      const inFixture = Math.max(
        ...fixture.results
          .filter(({ id }) => id === b.id)
          .map((row) => Math.abs(errors(b.el, row)[k])),
      );
      expect(inFixture, `${k}: fixture misses the scan's worst, ${where}`).toBeGreaterThan(
        worst[k].value / 1.02,
      );
    }
  });
});
