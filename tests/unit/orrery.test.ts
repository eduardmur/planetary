// The home page's schematic: NASA's poles of rotation, the radial scale and the symbols' sizes.

import { describe, expect, it } from 'vitest';
import { J2000, orbitFrame, type Vec3 } from '../../src/astro/index.ts';
import { mainVal } from '../../src/data/index.ts';
import { orreryModel, poleAxis } from '../../src/data/orrery.ts';
import { MIN_SYMBOL, schematicRadius, symbolDiameter } from '../../src/views/orrery.ts';

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
