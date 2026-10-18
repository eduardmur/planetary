// The home page's schematic of the solar system: the nine bodies that circle the Sun, with what the
// drawing needs for each (orbit, J2000 elements for positions, size, ring edges and pole of rotation).
// How they are drawn not to scale is views/orrery.ts's business.

import {
  centuriesSinceJ2000,
  poleToEcliptic,
  type Instant,
  type MeanElements,
  type Vec3,
} from '../astro/index.ts';
import type { OrbitShape } from '../views/keyplan.ts';
import { body, mainVal, needRow, num, row, type BodyId } from './index.ts';
import { bodyModel, systemBodies } from './model.ts';

export interface OrreryBody {
  id: BodyId;
  /** Main-table q and Q, inclination, and the J2000 node and perihelion longitude. */
  orbit: OrbitShape;
  /** J2000 mean elements, for the positions. */
  j2000: MeanElements;
  /** Equatorial diameter and polar radius, km (NASA). */
  diameter: number;
  polar: number;
  /** Ring edges drawn on the symbol, km: every wide edge, and the innermost and outermost edges. */
  rings?: { r: number; line: 'wide' | 'thin' }[];
  /** Opaque ring bands, km, which hide the body behind them. */
  opaque?: { inner: number; outer: number }[];
  /** Unit vector to the positive pole, ecliptic J2000. */
  axis: Vec3;
}

export interface OrreryModel {
  bodies: OrreryBody[];
  /** The largest aphelion, 10⁶ km: Pluto's, which sets the radial scale; and as NASA prints it. */
  qMax: number;
  qMaxText: string;
  /** The largest diameter, km: Jupiter's, whose symbol is the largest. */
  dMax: number;
}

// ---- Poles of rotation ---------------------------------------------------------------------------

/** NASA's pole formulas: a number, or a number plus or minus a multiple of T, sin N or cos N. */
const FORMULA = /^(-?\d+(?:\.\d+)?)(?:\s*([+-])\s*(\d+(?:\.\d+)?)\s*(T|sin N|cos N))?$/;
const DEG = Math.PI / 180;

/** Evaluate "281.010 - 0.033T", "299.36 + 0.70 sin N", "-15.175" (degrees) for T and N. */
function formula(text: string, T: number, N: number): number {
  const m = text.replace(/−/g, '-').trim().match(FORMULA);
  if (!m) throw new Error(`factsheet: cannot read the pole formula "${text}"`);
  const [, base, sign, k, term] = m;
  if (!sign) return Number(base);
  const x = term === 'T' ? T : term === 'sin N' ? Math.sin(N * DEG) : Math.cos(N * DEG);
  return Number(base) + (sign === '-' ? -1 : 1) * Number(k) * x;
}

/**
 * Unit vector to a body's positive pole of rotation (right-hand rule) at an instant, ecliptic J2000,
 * from the RA and Dec formulas on its fact sheet, with T in Julian centuries from J2000. Neptune's
 * pole moves with N, which its sheet defines too ("357.85 + 52.316T degrees").
 *
 * NASA's "North Pole of Rotation" is the IAU north pole. Venus and Uranus turn backwards about it
 * (negative rotation period), so their positive pole is the other end. Pluto's sheet gives the
 * "Positive Pole of Rotation" itself.
 */
export function poleAxis(id: BodyId, when: Instant): Vec3 {
  const T = centuriesSinceJ2000(when);
  const n = row(id, 'pole', 'nDefinition')?.body.text.replace(/\s*degrees$/, '');
  const N = n ? formula(n, T, 0) : 0;
  const at = (key: string) => formula(needRow(id, 'pole', key).body.text, T, N);
  const v = poleToEcliptic(at('ra'), at('dec'));
  const retrograde = num(mainVal(id, 'rotationPeriod'), `${id} rotation period`) < 0;
  const positive = body(id).poleCaption === 'Positive Pole of Rotation';
  return retrograde && !positive ? [-v[0], -v[1], -v[2]] : v;
}

// ---- The model -----------------------------------------------------------------------------------

/** The ring edges a symbol shows: the wide (opaque) ones, and the ring system's innermost and
 *  outermost edges. Phantom edges are too faint for a symbol. */
function symbolRings(id: BodyId): Pick<OrreryBody, 'rings' | 'opaque'> {
  const rings = bodyModel(id).rings;
  const edges = rings?.edges.filter((e) => e.line !== 'phantom') ?? [];
  if (!rings || !edges.length) return {};
  const radii = edges.map((e) => e.r);
  const ends = [Math.min(...radii), Math.max(...radii)];
  return {
    rings: edges
      .filter((e) => e.line === 'wide' || ends.includes(e.r))
      .map((e) => ({ r: e.r, line: e.line as 'wide' | 'thin' })),
    ...(rings.opaque.length ? { opaque: rings.opaque } : {}),
  };
}

/** The schematic's bodies in NASA's order, with their poles evaluated on the date of issue. */
export function orreryModel(issued: string): OrreryModel {
  const when = new Date(`${issued}T00:00:00Z`);
  const bodies: OrreryBody[] = systemBodies().map((s) => {
    const id = s.id as BodyId;
    const m = bodyModel(id);
    return {
      id,
      orbit: s.orbit,
      j2000: s.j2000,
      diameter: m.diameter,
      polar: m.polar,
      ...symbolRings(id),
      axis: poleAxis(id, when),
    };
  });
  const outer = bodies.reduce((a, b) => (b.orbit.Q > a.orbit.Q ? b : a));
  return {
    bodies,
    qMax: outer.orbit.Q,
    qMaxText: outer.orbit.QText,
    dMax: Math.max(...bodies.map((b) => b.diameter)),
  };
}
