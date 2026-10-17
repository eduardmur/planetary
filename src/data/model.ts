// Turns NASA's values into the models the drawings take. This is where the project's one rule is
// applied: every drawn size is the number NASA prints next to it (main table for the body, the orbit
// and the schedule; body pages and ring sheets only for what the main table does not give).

import type { MeanElements } from '../astro/index.ts';
import type { BodyModel, RingEdge } from '../views/body.ts';
import type { KeyPlanModel, OrbitShape } from '../views/keyplan.ts';
import { FACTS, body, mainVal, needRow, num, row, type BodyId, type Val } from './index.ts';

const SUN_ORBITING: BodyId[] = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];

// ---- Rings -------------------------------------------------------------------------------------

/**
 * Which rows of NASA's ring sheets are drawn, and with which line type. Line types follow NASA's
 * optical depth: opaque main rings wide, rings of optical depth around 0.01 or more narrow, fainter
 * rings phantom. Rows beyond about 2.6 planet radii would shrink the planet; they are listed in a
 * note instead (see notDrawn below).
 */
const RING_PLAN: Partial<
  Record<
    BodyId,
    {
      edges: { name: string; end?: 'inner' | 'outer'; line: RingEdge['line']; label?: string }[];
      opaque: [string, string][];
    }
  >
> = {
  saturn: {
    edges: [
      { name: 'D inner edge', line: 'phantom' },
      { name: 'C inner edge', line: 'thin' },
      { name: 'B inner edge', line: 'wide' },
      { name: 'B outer edge', line: 'wide' },
      { name: 'A inner edge', line: 'wide' },
      { name: 'Encke gap', line: 'thin' },
      { name: 'A outer edge', line: 'wide' },
      { name: 'F ring', line: 'thin' },
    ],
    opaque: [
      ['B inner edge', 'B outer edge'],
      ['A inner edge', 'A outer edge'],
    ],
  },
  jupiter: {
    edges: [
      { name: 'Halo', end: 'inner', line: 'phantom', label: 'Halo inner' },
      { name: 'Main Ring', end: 'inner', line: 'phantom', label: 'Main ring inner' },
      { name: 'Main Ring', end: 'outer', line: 'phantom', label: 'Main ring outer' },
    ],
    opaque: [],
  },
  uranus: {
    edges: [
      ...['6', '5', '4', 'Alpha', 'Beta', 'Eta', 'Gamma', 'Delta', 'Lambda'].map((name) => ({
        name,
        line: 'thin' as const,
      })),
      { name: 'Epsilon', line: 'wide' as const },
    ],
    opaque: [],
  },
  neptune: {
    edges: [
      { name: 'Galle', line: 'phantom', label: 'Galle' },
      { name: 'LeVerrier', line: 'thin', label: 'LeVerrier' },
      { name: 'Arago', line: 'phantom', label: 'Arago' },
      { name: 'Adams', line: 'thin', label: 'Adams' },
    ],
    opaque: [],
  },
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function ringRow(id: BodyId, name: string) {
  const sheet = body(id).rings;
  if (!sheet) throw new Error(`factsheet: ${id} has no ring sheet`);
  const want = norm(name);
  const r =
    sheet.rings.find((x) => norm(x.name) === want) ??
    sheet.rings.find((x) => norm(x.name).startsWith(want));
  if (!r) throw new Error(`factsheet: ${id} ring "${name}" not found`);
  return r;
}

/** One end of a ring row's radius: its number and its printed text (keeping "~"). */
function ringRadius(v: Val, end: 'inner' | 'outer' | undefined): { r: number; text: string } {
  if (v.range) {
    const parts = v.text.split(/\s*-\s*/);
    return end === 'outer'
      ? { r: v.range[1], text: parts[1] ?? v.text }
      : { r: v.range[0], text: parts[0] ?? v.text };
  }
  return { r: num(v, 'ring radius'), text: v.text };
}

function rings(id: BodyId): BodyModel['rings'] {
  const plan = RING_PLAN[id];
  if (!plan) return undefined;
  const edges: RingEdge[] = plan.edges.map((e) => {
    const rr = ringRow(id, e.name);
    const { r, text } = ringRadius(rr.radius, e.end);
    return { name: e.label ?? rr.name, r, text, line: e.line };
  });
  const opaque = plan.opaque.map(([a, b]) => ({
    inner: ringRadius(ringRow(id, a).radius, 'inner').r,
    outer: ringRadius(ringRow(id, b).radius, 'outer').r,
  }));
  // Every ring-sheet row beyond the outermost drawn edge, by NASA's name and radius text.
  const outermost = Math.max(...edges.map((e) => e.r));
  const notDrawn = (body(id).rings?.rings ?? [])
    .filter((r) => !/equator/i.test(r.name) && !r.group)
    .filter((r) => (r.radius.range?.[1] ?? r.radius.value ?? 0) > outermost + 1)
    .map((r) => `${r.name} ${r.radius.text.replace(/\s*-\s*/, '–')}`);
  return { edges, opaque, notDrawn };
}

// ---- Magnetic dipole ---------------------------------------------------------------------------

function magRow(id: BodyId, re: RegExp) {
  return body(id).magnetosphere?.find((r) => re.test(r.label));
}

function dipole(id: BodyId): BodyModel['dipole'] {
  const field = mainVal(id, 'magneticField').text;
  if (!/^yes/i.test(field)) return undefined;
  const offset = magRow(id, /dipole offset/i);
  const note = offset
    ? `OFFSET ${offset.body.text.toUpperCase().replace(/R([A-Z])$/, (_, c: string) => `R${c.toLowerCase()}`)} · DIRECTION NOT GIVEN`
    : undefined;
  const tilt = magRow(id, /dipole tilt/i);
  if (tilt) {
    const t = num(tilt.body, `${id} dipole tilt`);
    const s = tilt.body.text.replace(/\s*degrees?$/i, '');
    if (t === 0)
      return {
        tilt: null,
        label: `DIPOLE AXIS = ROTATION AXIS: ${s}°`,
        ...(note ? { note } : {}),
      };
    return { tilt: t, label: `${s}°`, ...(note ? { note } : {}) };
  }
  // Earth gives no tilt row; derive it from the geocentric dipole latitude, and say so.
  const geo = magRow(id, /geocentric dipole/i);
  const lat = geo?.body.text.match(/([\d.]+)\s*N/);
  if (lat) {
    const t = 90 - Number(lat[1]);
    return { tilt: t, label: `(${t.toFixed(2)}°) = 90° − ${lat[1]}°`, ...(note ? { note } : {}) };
  }
  return undefined;
}

// ---- Bodies --------------------------------------------------------------------------------------

export function bodyModel(id: BodyId): BodyModel {
  const d = mainVal(id, 'diameter');
  const obl = mainVal(id, 'obliquity');
  const rot = mainVal(id, 'rotationPeriod');
  const polar = needRow(id, 'bulk', 'polarRadius').body;
  const flat = row(id, 'bulk', 'flattening')?.body;
  const core = row(id, 'bulk', 'coreRadius')?.body;
  const m: BodyModel = {
    id,
    name: body(id).name,
    diameter: num(d, `${id} diameter`),
    diameterText: d.text,
    polar: num(polar, `${id} polar radius`),
    polarText: polar.text,
    spherical: flat?.value === 0,
    obliquity: num(obl, `${id} obliquity`),
    obliquityText: obl.text,
    rotation: num(rot, `${id} rotation period`),
    rotationText: rot.text,
  };
  if (core?.value)
    m.core = { r: core.value, text: core.text, ...(core.note ? { note: core.note } : {}) };
  const r = rings(id);
  if (r) m.rings = r;
  const dp = dipole(id);
  if (dp) m.dipole = dp;
  return m;
}

// ---- Orbits --------------------------------------------------------------------------------------

function j2000(id: BodyId): MeanElements | undefined {
  const b = body(id);
  if (!b.elements) return undefined;
  const el = (k: string) => num(b.elements!.find((r) => r.key === k)?.body, `${id} elements.${k}`);
  return {
    a: el('semimajorAxisAU'),
    e: el('eccentricity'),
    i: el('inclination'),
    node: el('ascendingNode'),
    peri: el('perihelionLongitude'),
    L: el('meanLongitude'),
    period: num(needRow(id, 'orbital', 'siderealPeriod').body, `${id} sidereal period`),
  };
}

export function orbitShape(id: BodyId): OrbitShape {
  const q = mainVal(id, 'perihelion');
  const Q = mainVal(id, 'aphelion');
  const a = mainVal(id, 'distanceFromSun');
  const e = mainVal(id, 'orbitalEccentricity');
  const i = mainVal(id, 'orbitalInclination');
  const el = j2000(id);
  const shape: OrbitShape = {
    q: num(q, `${id} perihelion`),
    Q: num(Q, `${id} aphelion`),
    qText: q.text,
    QText: Q.text,
    aText: a.text,
    eText: e.text,
    i: num(i, `${id} inclination`),
    iText: i.text,
  };
  if (el) {
    shape.node = el.node;
    shape.peri = el.peri;
  }
  return shape;
}

export function keyPlanModel(id: BodyId): KeyPlanModel {
  const moon = id === 'moon';
  const el = j2000(id);
  const m: KeyPlanModel = {
    name: body(id).name,
    orbit: orbitShape(id),
    centre: moon ? 'EARTH' : 'SUN',
    apsides: moon ? ['PERIGEE', 'APOGEE'] : ['PERIHELION', 'APHELION'],
  };
  if (el) m.j2000 = el;
  if (!moon && id !== 'earth') m.earth = orbitShape('earth');
  return m;
}

/** A body that circles the Sun: its orbit as drawn and its J2000 elements for positions. */
export interface SystemBody {
  id: string;
  name: string;
  orbit: OrbitShape;
  j2000: MeanElements;
}

export function systemBodies(): SystemBody[] {
  return SUN_ORBITING.map((id) => ({
    id,
    name: body(id).name,
    orbit: orbitShape(id),
    j2000: j2000(id)!,
  }));
}

export const RETRIEVED = FACTS.retrieved;
