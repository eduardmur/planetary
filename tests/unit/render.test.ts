// Properties of the hidden-line renderer over many view directions.

import { describe, expect, it } from 'vitest';
import { Camera } from '../../src/draw/camera.ts';
import { circle, splitCurve } from '../../src/draw/curves.ts';
import { isoNumber, measure } from '../../src/draw/lettering.ts';
import { facesCamera, graticule, hides, outline, type Spheroid } from '../../src/draw/spheroid.ts';
import { DEG, matMul, mulT, rotY, rotZ, type Vec3 } from '../../src/draw/vec.ts';

// Deterministic pseudo-random directions.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

function body(obliquity: number, spin: number, c = 0.9): Spheroid {
  return { a: 1, c, centre: [0, 0, 0], R: matMul(rotY(obliquity * DEG), rotZ(spin)) };
}

describe('spheroid hidden lines', () => {
  it('graticule splits are finite and land on the limb', () => {
    for (let n = 0; n < 300; n++) {
      const cam = new Camera({ yaw: rnd() * 2 * Math.PI, pitch: (rnd() - 0.5) * Math.PI });
      const s = body(rnd() * 180, rnd() * 6, 0.85 + rnd() * 0.15);
      const vb = mulT(s.R, cam.toCam);
      for (const g of graticule(s, 30 * DEG, 30 * DEG, 48)) {
        const runs = splitCurve({ ...g, at: g.body }, (q) => facesCamera(s, q, vb), null);
        for (const r of runs.visible) {
          for (const p of r) for (const x of p) expect(Number.isFinite(x)).toBe(true);
          // Run ends are on the visible side or on the limb (facing ≈ 0).
          const f = (q: Vec3) =>
            (q[0] * vb[0] + q[1] * vb[1]) / (s.a * s.a) + (q[2] * vb[2]) / (s.c * s.c);
          expect(f(r[0]!)).toBeGreaterThan(-1e-2);
          expect(f(r[r.length - 1]!)).toBeGreaterThan(-1e-2);
        }
      }
    }
  });

  it('a ring point behind the body is hidden, in front is not', () => {
    const s = body(0, 0, 1);
    // Camera looking along −Y toward the origin from +Y? toCam = (0,−1,0) at yaw 0, pitch 0.
    const cam = new Camera({ yaw: 0, pitch: 0 });
    expect(hides(s, [0, 2, 0], cam.toCam)).toBe(true); // behind (far side)
    expect(hides(s, [0, -2, 0], cam.toCam)).toBe(false); // in front
    expect(hides(s, [2, 2, 0], cam.toCam)).toBe(false); // beside
  });

  it('outline semi-axes: equatorial radius always, polar radius when the axis is square to the view', () => {
    const s = body(0, 0, 0.9);
    const side = outline(s, new Camera({ yaw: 0, pitch: 0 }));
    expect(side.rx).toBeCloseTo(1, 12);
    expect(side.ry).toBeCloseTo(0.9, 12);
    const top = outline(s, new Camera({ yaw: 0, pitch: 90 * DEG }));
    expect(top.ry).toBeCloseTo(1, 12);
  });

  it('closed curves keep a whole number of dashes', () => {
    const c = circle([0, 0, 0], [1, 0, 0], [0, 1, 0], 1, 64);
    const runs = splitCurve(c, () => false, { period: 0.3, on: 0.2 });
    expect(runs.visible).toHaveLength(0);
    expect(runs.hidden.length).toBe(Math.round((2 * Math.PI) / 0.3));
  });
});

describe('lettering', () => {
  it('groups digits with thin spaces from five digits up (ISO 80000-1)', () => {
    expect(isoNumber('120,536')).toBe('120 536');
    expect(isoNumber('6378.137')).toBe('6378.137');
    expect(isoNumber('16,298.')).toBe('16 298.');
    expect(isoNumber('-5832.5')).toBe('-5832.5');
    expect(isoNumber('~41,900')).toBe('~41 900');
  });
  it('measures every character it may draw', () => {
    for (const s of [
      'Ø12 756',
      'SØ12 104',
      '♈',
      '☊',
      '23.4°',
      '10⁶ km',
      '−17.2 h',
      'DIPOLE AXIS = ROTATION AXIS: 0.0°',
      'ORBIT PLANE = ECLIPTIC: 0.0°',
    ])
      expect(measure(s)).toBeGreaterThan(0);
  });
});
