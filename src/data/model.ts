// Turns NASA's values into the models the drawings take. This is where the project's one rule is
// applied: every drawn size is the number NASA prints next to it (main table for the body, the orbit
// and the schedule; body pages and ring sheets only for what the main table does not give).

import type { MeanElements } from '../astro/index.ts';
import type { BodyModel, RingEdge } from '../views/body.ts';
import type { KeyPlanModel, OrbitShape } from '../views/keyplan.ts';
import { FACTS, body, mainVal, needRow, num, row, type BodyId, type Val } from './index.ts';
import type { Ring } from './types.ts';

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
 * rings phantom. Rows beyond about 2.6 planet radii would shrink the planet, and some rows would sit
 * on a drawn edge; the popover lists both (see ringList below). `why` says why a group of rows is not
 * drawn, where the reason is NASA's.
 */
const RING_PLAN: Partial<
  Record<
    BodyId,
    {
      edges: { name: string; end?: 'inner' | 'outer'; line: RingEdge['line']; label?: string }[];
      opaque: [string, string][];
      why?: Record<string, string>;
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
    why: { 'Arcs in Adams Ring': 'NASA gives no longitudes' },
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

/** The planned edges with the NASA row each comes from. */
function plannedEdges(id: BodyId) {
  return (RING_PLAN[id]?.edges ?? []).map((plan) => {
    const row = ringRow(id, plan.name);
    return { plan, row, ...ringRadius(row.radius, plan.end) };
  });
}

/**
 * The ring popover's list, which accounts for every row of NASA's ring sheet: each row is drawn, is
 * the same line as a drawn edge (Saturn's C outer edge is its B inner edge), has no radius (the
 * Cassini division), or is listed as not drawn by NASA's name and radius as printed.
 */
export interface RingList {
  /** The drawn edges in the plan's order (inner to outer), by NASA's name for the row ("Arago
   *  (1989N4R*)"); one end of a range keeps its label ("Main ring inner"). */
  drawn: RingEdge[];
  /** Rows beyond the outermost drawn edge: drawing them would shrink the planet. */
  beyond: string[];
  /** The other rows that are not drawn. A group of rows is one entry, with NASA's reason if any. */
  omitted: string[];
}

export function ringList(id: BodyId): RingList | undefined {
  const plan = RING_PLAN[id];
  const sheet = body(id).rings;
  if (!plan || !sheet) return undefined;
  const edges = plannedEdges(id);
  const drawn = edges.map(({ plan: e, row, r, text }) => ({
    name: e.end ? (e.label ?? row.name) : row.name,
    r,
    text,
    line: e.line,
  }));
  const used = new Set(edges.map((e) => e.row));
  const radii = new Set(edges.map((e) => e.r));
  const outermost = Math.max(...radii);
  // Rows in NASA's order, a group's rows together. Never matched by radius alone: Lassell has the
  // radius of LeVerrier, and Adams's arcs that of Adams.
  const items: Ring[][] = [];
  for (const r of sheet.rings) {
    const v = r.radius;
    if (/equator/i.test(r.name) || used.has(r) || (v.value === null && !v.range)) continue;
    if (/\bedge$/i.test(r.name) && v.value !== null && radii.has(v.value)) continue;
    const last = items.at(-1);
    if (r.group && last?.[0]?.group === r.group) last.push(r);
    else items.push([r]);
  }
  const radius = (r: Ring) => r.radius.text.replace(/\s*-\s*/, '–');
  const entry = (rows: Ring[]) => {
    const group = rows[0]!.group;
    const at = [...new Set(rows.map(radius))].join(', ');
    if (!group) return `${rows[0]!.name} ${at}`;
    const why = plan.why?.[group];
    return `${group} (${rows.map((r) => r.name).join(', ')}) ${at}${why ? `: ${why}` : ''}`;
  };
  const beyond: string[] = [];
  const omitted: string[] = [];
  for (const rows of items) {
    const outer = Math.max(...rows.map((r) => r.radius.range?.[1] ?? r.radius.value ?? 0));
    (outer > outermost + 1 ? beyond : omitted).push(entry(rows));
  }
  return { drawn, beyond, omitted };
}

function rings(id: BodyId): BodyModel['rings'] {
  const plan = RING_PLAN[id];
  const list = ringList(id);
  if (!plan || !list) return undefined;
  const edges: RingEdge[] = plannedEdges(id).map(({ plan: e, row, r, text }) => ({
    name: e.label ?? row.name,
    r,
    text,
    line: e.line,
  }));
  const opaque = plan.opaque.map(([a, b]) => ({
    inner: ringRadius(ringRow(id, a).radius, 'inner').r,
    outer: ringRadius(ringRow(id, b).radius, 'outer').r,
  }));
  return { edges, opaque, notDrawn: list.beyond };
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
