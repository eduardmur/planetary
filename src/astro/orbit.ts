// Two-body orbits from NASA's "Mean Orbital Elements (J2000)".
//
// Frame — heliocentric ecliptic J2000: origin at the Sun's centre, x towards the vernal equinox
// (ecliptic longitude 0°, the "first point of Aries"), z towards the north ecliptic pole, y = z × x
// (longitude 90°). This is the frame NASA's elements are referred to and the one JPL Horizons calls
// "Ecliptic of J2000.0". Positions are [x, y, z] in AU.
//
// Units — angles are degrees at the API boundary, as NASA prints them, and radians inside. Times are
// an Instant: a Date (UTC) or a Julian date (see time.ts).
//
// Model — each body runs on a fixed Kepler ellipse. The fact sheets give the J2000 size, shape and
// orientation (a, e, i, Ω, ϖ) and where the body was at J2000 (L), but no element rates, so the
// ellipse is frozen and only the mean anomaly moves, at the sidereal mean motion 360°/period:
//
//   M(t) = L − ϖ + 360° · (t − J2000) / period      mean anomaly
//   ω    = ϖ − Ω                                     argument of perihelion, in the orbit plane
//
// Kepler's equation turns M into the eccentric anomaly E, and E gives the point on the ellipse.
//
// Accuracy — against JPL Horizons (DE441) every day from 1990 to 2060, heliocentric longitude is
// within 0.04° for Venus, Earth, Uranus, Neptune and Pluto and 0.09° for Mars; Jupiter and Saturn,
// which perturb each other (the "great inequality") in ways no fixed ellipse follows, reach 0.26°
// and 0.29°. Mercury's error grows about 0.075° per decade from J2000 (0.45° by 2060, 0.76° back
// in 1900) because its printed period, 87.969 d, is rounded. Latitude is within 0.05°, distance
// within 0.17%. Over 1900–2100 every body but Mercury stays within 0.32°. NASA's Earth elements
// are those of the Earth–Moon barycentre, which Earth's centre circles at 4 700 km (0.002°); that
// is inside the numbers above, which are for the bodies' centres. The table is in
// tests/unit/astro.test.ts. Good for drawings and "where is it now", not for a telescope.

import { solveKepler, trueAnomaly } from './kepler.ts';
import { daysSinceJ2000, type Instant } from './time.ts';

/** One body's "Mean Orbital Elements (J2000)" plus its sidereal period, as on the fact sheets. */
export interface MeanElements {
  /** Semimajor axis, AU. */
  a: number;
  /** Eccentricity, 0 ≤ e < 1. */
  e: number;
  /** Inclination of the orbit to the ecliptic J2000, degrees. */
  i: number;
  /** Longitude of the ascending node Ω, degrees: from the equinox along the ecliptic to where the
   *  orbit crosses it northwards. */
  node: number;
  /** Longitude of perihelion ϖ = Ω + ω, degrees: a "broken" angle, Ω along the ecliptic and then ω
   *  along the orbit from the node to perihelion. */
  peri: number;
  /** Mean longitude L = ϖ + M at J2000 (JD 2451545.0), degrees. */
  L: number;
  /** Sidereal orbit period, days ("Orbital parameters" table); sets the mean motion. */
  period: number;
}

/** A vector in the heliocentric ecliptic J2000 frame: [x, y, z]. */
export type Vec3 = [number, number, number];

/** Unit vectors (and the centre) that place an orbit's ellipse in the ecliptic frame. */
export interface OrbitFrame {
  /** From the Sun towards perihelion (true anomaly 0°): the major axis. */
  perihelionDir: Vec3;
  /** Along the minor axis, 90° ahead of perihelion in the direction of motion: normal × perihelionDir. */
  minorDir: Vec3;
  /** From the Sun towards the ascending node, in the ecliptic plane (z = 0): the line of nodes. */
  ascendingNodeDir: Vec3;
  /** The orbit's north pole: along the orbital angular momentum, at angle i from the ecliptic pole. */
  normal: Vec3;
  /** Centre of the ellipse, AU: −a·e·perihelionDir (the Sun sits at a focus). */
  centre: Vec3;
}

/**
 * Obliquity of the ecliptic at J2000, the IAU 1976 value 84381.448″ = 23.4392911°, in degrees.
 *
 * The one astronomical number in src/astro/ that NASA's pages do not print (the rest is theirs, or
 * units: the day, the Julian century, the Julian date of 1970-01-01). It is not a property of a
 * planet but the constant that defines the ecliptic J2000 frame against the equatorial (RA/Dec) one:
 * NASA gives the poles of rotation in RA/Dec and the orbits in ecliptic coordinates, and this angle
 * is the rotation between the two. JPL Horizons defines its ecliptic frame with exactly this value.
 * NASA's "Obliquity to orbit 23.44" for Earth is the physical axial tilt rounded to 0.01°, 2.6″ away.
 */
export const OBLIQUITY_J2000 = 84381.448 / 3600;

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

/** x mod 360, in [0, 360). */
function wrap360(deg: number): number {
  const x = deg - 360 * Math.floor(deg / 360);
  return x === 360 ? 0 : x;
}

/** Columns of the rotation from the perifocal frame (x to perihelion, z along the orbit normal) to
 *  the ecliptic frame: R = Rz(Ω)·Rx(i)·Rz(ω). */
function axes(el: MeanElements): { P: Vec3; Q: Vec3; W: Vec3 } {
  const node = el.node * DEG;
  const argPeri = (el.peri - el.node) * DEG;
  const incl = el.i * DEG;
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const cw = Math.cos(argPeri);
  const sw = Math.sin(argPeri);
  const ci = Math.cos(incl);
  const si = Math.sin(incl);
  return {
    P: [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si],
    Q: [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si],
    W: [sO * si, -cO * si, ci],
  };
}

/** The point x·P + y·Q of the orbit plane, in the ecliptic frame. */
function inPlane(P: Vec3, Q: Vec3, x: number, y: number): Vec3 {
  return [x * P[0] + y * Q[0], x * P[1] + y * Q[1], x * P[2] + y * Q[2]];
}

/** Mean anomaly in radians, [0, 2π). */
function meanAnomalyRad(el: MeanElements, when: Instant): number {
  const turns = (el.L - el.peri) / 360 + daysSinceJ2000(when) / el.period;
  return TAU * (turns - Math.floor(turns));
}

function eccentricAnomalyRad(el: MeanElements, when: Instant): number {
  return solveKepler(meanAnomalyRad(el, when), el.e);
}

/** Mean motion n = 360° / period, degrees per day. */
export function meanMotion(el: MeanElements): number {
  return 360 / el.period;
}

/** Mean anomaly M = L − ϖ + n·(t − J2000), degrees in [0, 360). */
export function meanAnomalyAt(el: MeanElements, when: Instant): number {
  return wrap360(meanAnomalyRad(el, when) / DEG);
}

/** Eccentric anomaly E, degrees in [0, 360): the angle at the ellipse centre, from perihelion, to
 *  the point of the auxiliary circle above the body. */
export function eccentricAnomalyAt(el: MeanElements, when: Instant): number {
  return wrap360(eccentricAnomalyRad(el, when) / DEG);
}

/** True anomaly ν, degrees in [0, 360): the angle at the Sun from perihelion to the body. */
export function trueAnomalyAt(el: MeanElements, when: Instant): number {
  return wrap360(trueAnomaly(eccentricAnomalyRad(el, when), el.e) / DEG);
}

/** Distance from the Sun, AU: r = a·(1 − e·cos E). */
export function radiusAt(el: MeanElements, when: Instant): number {
  return el.a * (1 - el.e * Math.cos(eccentricAnomalyRad(el, when)));
}

/** Heliocentric ecliptic J2000 position, AU, of the body at an instant (two-body propagation). */
export function positionAt(el: MeanElements, when: Instant): Vec3 {
  const E = eccentricAnomalyRad(el, when);
  const { P, Q } = axes(el);
  const b = el.a * Math.sqrt(1 - el.e * el.e);
  return inPlane(P, Q, el.a * (Math.cos(E) - el.e), b * Math.sin(E));
}

/** Point of the orbit at true anomaly ν (degrees), AU: r = a·(1 − e²) / (1 + e·cos ν) from the Sun. */
export function orbitPointAtTrueAnomaly(el: MeanElements, nu: number): Vec3 {
  const v = nu * DEG;
  const { P, Q } = axes(el);
  const r = (el.a * (1 - el.e * el.e)) / (1 + el.e * Math.cos(v));
  return inPlane(P, Q, r * Math.cos(v), r * Math.sin(v));
}

/**
 * The orbit as a closed polyline: n segments, n + 1 points at E = 360°·k/n for k = 0 … n, so the
 * first point is perihelion and the last repeats it exactly. Even steps in eccentric anomaly put the
 * points closest together at both ends of the major axis, where the ellipse bends most, and treat
 * perihelion and aphelion alike (even time steps would crowd aphelion; even true anomaly, perihelion).
 */
export function orbitPolyline(el: MeanElements, n = 360): Vec3[] {
  if (!Number.isInteger(n) || n < 3) {
    throw new RangeError(`orbitPolyline: n must be an integer ≥ 3, got ${n}`);
  }
  const { P, Q } = axes(el);
  const b = el.a * Math.sqrt(1 - el.e * el.e);
  const points: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const E = (TAU * k) / n;
    points.push(inPlane(P, Q, el.a * (Math.cos(E) - el.e), b * Math.sin(E)));
  }
  points.push([...points[0]!]);
  return points;
}

/**
 * Directions that place the orbit's ellipse in the ecliptic frame, plus its centre.
 *
 * perihelionDir, minorDir and normal are orthonormal and right-handed (perihelionDir × minorDir =
 * normal); ascendingNodeDir lies in both the ecliptic and the orbit plane. When i ≈ 0 the line of
 * nodes is undefined: Earth's i = 0.00005° (0.18″) makes its Ω = −11.26064° a fitting artefact, and
 * so is its ω; only their sum ϖ, which fixes perihelion, means anything, and positions depend on Ω
 * only through it. Don't draw Earth's node line.
 */
export function orbitFrame(el: MeanElements): OrbitFrame {
  const { P, Q, W } = axes(el);
  const node = el.node * DEG;
  const ae = el.a * el.e;
  return {
    perihelionDir: P,
    minorDir: Q,
    ascendingNodeDir: [Math.cos(node), Math.sin(node), 0],
    normal: W,
    centre: [-ae * P[0], -ae * P[1], -ae * P[2]],
  };
}

/** Perihelion distance q = a·(1 − e), AU. */
export function perihelionDistance(el: MeanElements): number {
  return el.a * (1 - el.e);
}

/** Aphelion distance Q = a·(1 + e), AU. */
export function aphelionDistance(el: MeanElements): number {
  return el.a * (1 + el.e);
}

/**
 * Unit vector of a rotation pole given as equatorial J2000 right ascension and declination
 * (degrees), as on the fact sheets' "North Pole of Rotation", in the ecliptic J2000 frame.
 *
 * The equatorial unit vector (cos δ·cos α, cos δ·sin α, sin δ) is rotated about the shared x axis
 * (the equinox) by the obliquity ε = OBLIQUITY_J2000:
 *   x' = x,  y' = y·cos ε + z·sin ε,  z' = −y·sin ε + z·cos ε.
 * Earth's pole (α = 0°, δ = 90°) comes out 23.44° from the ecliptic pole, towards longitude 90°.
 * For the poles that drift, evaluate NASA's formula first, e.g. α = 317.681 − 0.106·T with T from
 * centuriesSinceJ2000.
 *
 * Which end is which: NASA's "North Pole" is the IAU north pole, the end on the north side of the
 * solar system's plane. Venus and Uranus turn backwards about it (negative rotation periods), so
 * their spin axis by the right-hand rule, from which NASA measures "Obliquity to orbit" (177.36°,
 * 97.77°), is the negated vector. Pluto's sheet gives the "Positive Pole", the right-hand-rule end
 * itself, which points south of the ecliptic.
 */
export function poleToEcliptic(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const eps = OBLIQUITY_J2000 * DEG;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  return [x, y * Math.cos(eps) + z * Math.sin(eps), -y * Math.sin(eps) + z * Math.cos(eps)];
}

/** Ecliptic longitude (degrees, [0, 360)), latitude (degrees, [−90, 90]) and length of a vector. */
export function eclipticLonLat(v: Vec3): { lon: number; lat: number; r: number } {
  const [x, y, z] = v;
  const r = Math.hypot(x, y, z);
  return {
    lon: wrap360(Math.atan2(y, x) / DEG),
    lat: r === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, z / r))) / DEG,
    r,
  };
}
