// The home page's schematic: NASA's poles of rotation, the radial scale, the symbols' sizes and how
// the links over them share the pointer.

import { describe, expect, it } from 'vitest';
import { J2000, orbitFrame, type Vec3 } from '../../src/astro/index.ts';
import { mainVal } from '../../src/data/index.ts';
import { orreryModel, poleAxis } from '../../src/data/orrery.ts';
import type { Vec2 } from '../../src/draw/vec.ts';
import {
  MIN_SYMBOL,
  linkRegion,
  schematicRadius,
  symbolDiameter,
  type LinkDisc,
} from '../../src/views/orrery.ts';

const model = orreryModel('2026-10-18');
const body = (id: string) => model.bodies.find((b) => b.id === id)!;
const degrees = (a: Vec3, b: Vec3) =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

describe('the bodies', () => {
  it('are the nine that circle the Sun, in NASA’s order', () => {
    expect(model.bodies.map((b) => b.id)).toEqual([
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
      'pluto',
    ]);
  });

  it('take their sizes from the main table', () => {
    for (const b of model.bodies)
      expect(String(b.diameter)).toBe(mainVal(b.id, 'diameter').text.replace(/,/g, ''));
    expect(model.dMax).toBe(body('jupiter').diameter);
  });

  it('show every wide ring edge and the innermost and outermost others, never a phantom one', () => {
    const rings = (id: string) => body(id).rings?.map((e) => e.r);
    expect(rings('jupiter')).toBeUndefined();
    // C inner, B inner, B outer, A inner, A outer, F.
    expect(rings('saturn')).toHaveLength(6);
    expect(body('saturn').opaque).toHaveLength(2);
    // Ring 6 and Epsilon.
    expect(body('uranus').rings).toEqual([
      { r: 41837, line: 'thin' },
      { r: 51149, line: 'wide' },
    ]);
    // LeVerrier and Adams.
    expect(rings('neptune')).toEqual([53200, 62933]);
  });
});

describe('poles of rotation', () => {
  for (const b of model.bodies)
    it(`${b.id}: NASA’s obliquity from the J2000 orbit normal, within 0.15°`, () => {
      const pole = poleAxis(b.id, J2000);
      expect(Math.hypot(...pole)).toBeCloseTo(1, 12);
      const obliquity = Number(mainVal(b.id, 'obliquity').text);
      expect(Math.abs(degrees(pole, orbitFrame(b.j2000).normal) - obliquity)).toBeLessThan(0.15);
    });

  it('positive poles point south of the ecliptic for exactly Venus, Uranus and Pluto', () => {
    expect(model.bodies.filter((b) => b.axis[2] < 0).map((b) => b.id)).toEqual([
      'venus',
      'uranus',
      'pluto',
    ]);
  });

  it('drift as NASA’s formulas say, Neptune’s with N', () => {
    const later = new Date('2100-01-01T12:00:00Z');
    // Earth: RA 0.00 − 0.641T, Dec 90.00 − 0.557T.
    expect(degrees(poleAxis('earth', J2000), poleAxis('earth', later))).toBeCloseTo(0.557, 2);
    expect(degrees(poleAxis('neptune', J2000), poleAxis('neptune', later))).toBeGreaterThan(0.1);
    // Constant poles stay put.
    expect(poleAxis('venus', later)).toEqual(poleAxis('venus', J2000));
  });
});

describe('the radial scale', () => {
  const R = 759;
  const r = (x: number) => schematicRadius(x, R, model.qMax);

  it('is set by Pluto’s aphelion, as printed', () => {
    expect(model.qMaxText).toBe(mainVal('pluto', 'aphelion').text);
    expect(r(model.qMax)).toBe(R);
  });

  it('keeps distances in order: q′ < Q′ for every body, Pluto’s q′ inside Neptune’s Q′', () => {
    for (const b of model.bodies) expect(r(b.orbit.q)).toBeLessThan(r(b.orbit.Q));
    expect(r(body('pluto').orbit.q)).toBeLessThan(r(body('neptune').orbit.Q));
    for (let i = 1; i < model.bodies.length - 1; i++)
      expect(r(model.bodies[i]!.orbit.q)).toBeGreaterThan(r(model.bodies[i - 1]!.orbit.Q));
  });
});

describe('symbols', () => {
  it('are never under 6 px, and Jupiter’s is R/15', () => {
    for (const R of [195, 337, 759])
      for (const b of model.bodies) {
        const d = symbolDiameter(b.diameter, R, model.dMax);
        expect(d).toBeGreaterThanOrEqual(MIN_SYMBOL);
        if (b.id === 'jupiter') expect(d).toBeCloseTo(R / 15, 12);
      }
    expect(symbolDiameter(body('pluto').diameter, 195, model.dMax)).toBe(MIN_SYMBOL);
  });

  it('grow as the square root of NASA’s diameter', () => {
    const d = (id: string) => symbolDiameter(body(id).diameter, 759, model.dMax);
    expect(d('saturn') / d('jupiter')).toBeCloseTo(
      Math.sqrt(body('saturn').diameter / body('jupiter').diameter),
      12,
    );
  });
});

describe('the links over the bodies', () => {
  /** How far inside each link's region a point is, px (negative: outside). */
  const depths = (links: LinkDisc[], [x, y]: Vec2) =>
    links.map((p) => {
      const q: Vec2 = [x - p.at[0], y - p.at[1]];
      let d = p.reach - Math.hypot(...q);
      const poly = linkRegion(
        p,
        links.filter((o) => o !== p),
      );
      // The region is convex, its points counter-clockwise (x right, y up).
      for (const [i, a] of (poly ?? []).entries()) {
        const b = poly![(i + 1) % poly!.length]!;
        const cross = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
        d = Math.min(d, cross / Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      return d;
    });
  /** Every point of a grid round the links, 0.25 px apart. */
  function* grid(links: LinkDisc[]) {
    const x0 = Math.min(...links.map((p) => p.at[0] - p.reach)),
      x1 = Math.max(...links.map((p) => p.at[0] + p.reach)),
      y0 = Math.min(...links.map((p) => p.at[1] - p.reach)),
      y1 = Math.max(...links.map((p) => p.at[1] + p.reach));
    for (let x = x0; x <= x1; x += 0.25) for (let y = y0; y <= y1; y += 0.25) yield [x, y] as Vec2;
  }
  /** Which body's symbol holds a point that no other symbol covers, if any. */
  const symbolAt = (links: LinkDisc[], q: Vec2) => {
    const on = links.filter((p) => Math.hypot(q[0] - p.at[0], q[1] - p.at[1]) < p.r - 0.01);
    const near = links.filter((p) => Math.hypot(q[0] - p.at[0], q[1] - p.at[1]) < p.r + 0.01);
    return on.length === 1 && near.length === 1 ? on[0] : undefined;
  };

  it('are whole circles where they meet no other', () => {
    const a = { at: [0, 0] as Vec2, r: 7.5, reach: 13 };
    expect(linkRegion(a, [{ at: [40, 0], r: 7.5, reach: 13 }])).toBeNull();
  });

  // The Earth and Mercury 11.7 px apart (1280×720 on 2027-06-24), Venus and the Earth 20.5 px apart
  // (1440×900 on 2026-10-18), Mercury in front of Venus (1280×720 on 2027-04-04), and three at once.
  const cases: Record<string, LinkDisc[]> = {
    'unequal symbols apart': [
      { at: [100, 100], r: 6.7, reach: 12 },
      { at: [111.7, 100], r: 4.1, reach: 12 },
    ],
    'equal symbols apart': [
      { at: [100, 100], r: 7.4, reach: 13 },
      { at: [114.5, 114.5], r: 7.6, reach: 13 },
    ],
    'overlapping symbols': [
      { at: [100, 100], r: 4.1, reach: 12 },
      { at: [104, 104.9], r: 6.5, reach: 12 },
    ],
    'three symbols': [
      { at: [100, 100], r: 4.7, reach: 12 },
      { at: [112, 104], r: 7.5, reach: 13 },
      { at: [104, 116], r: 7.6, reach: 13 },
    ],
  };
  for (const [name, links] of Object.entries(cases))
    it(`never overlap, and each keeps the points of its own symbol: ${name}`, () => {
      let shared = 0,
        lost = 0,
        symbols = 0;
      for (const q of grid(links)) {
        const d = depths(links, q);
        if (d.filter((v) => v > 1e-6).length > 1) shared++;
        const s = symbolAt(links, q);
        if (s) {
          symbols++;
          const i = links.indexOf(s);
          if (d[i]! <= 1e-6 || d.some((v, j) => j !== i && v > -1e-6)) lost++;
        }
      }
      expect(symbols).toBeGreaterThan(1000);
      expect(shared).toBe(0);
      expect(lost).toBe(0);
    });

  it('cut equal symbols halfway between them', () => {
    const a = { at: [0, 0] as Vec2, r: 7.5, reach: 13 };
    const poly = linkRegion(a, [{ at: [20, 0], r: 7.5, reach: 13 }])!;
    expect(Math.max(...poly.map((q) => q[0]))).toBeCloseTo(10, 9);
    expect(Math.min(...poly.map((q) => q[0]))).toBeCloseTo(-13, 9);
  });
});
