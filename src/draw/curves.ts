// Parametric curves split into visible and hidden runs.
//
// A drawing is mostly curves on or around a body: meridians, parallels, ring edges, orbits. Each is
// sampled along its own parameter u, every sample is tested for visibility, and the exact place where a
// curve goes behind something is found by bisection on u. Hidden runs are cut into dashes in u, so the
// dashes stay attached to the geometry while it rotates instead of crawling along the line.

import type { Vec3 } from './vec.ts';

export interface Curve {
  /** Point in world coordinates at parameter u. */
  at: (u: number) => Vec3;
  u0: number;
  u1: number;
  /** Number of sampling steps between u0 and u1. */
  n: number;
  /** Approximate world length per unit of u (for dash lengths). */
  speed: number;
  /** True when at(u0) and at(u1) are the same point. */
  closed?: boolean;
}

export interface DashPattern {
  /** Dash + gap, in world units along the curve. */
  period: number;
  /** Dash length, in world units. */
  on: number;
}

export interface Runs {
  visible: Vec3[][];
  hidden: Vec3[][];
}

const BISECT = 9;

/** Sample `c`, split it where `vis` changes, and return visible runs and (optionally dashed) hidden runs. */
export function splitCurve(c: Curve, vis: (p: Vec3) => boolean, dash?: DashPattern | null): Runs {
  const out: Runs = { visible: [], hidden: [] };
  const du = (c.u1 - c.u0) / c.n;
  // Intervals [ua, ub] of u with a constant visibility state.
  const spans: { a: number; b: number; v: boolean }[] = [];
  let prevU = c.u0;
  let prevV = vis(c.at(prevU));
  let start = prevU;
  for (let i = 1; i <= c.n; i++) {
    const u = c.u0 + du * i;
    const v = vis(c.at(u));
    if (v !== prevV) {
      // Bisection for the switching point between prevU and u.
      let lo = prevU,
        hi = u;
      for (let k = 0; k < BISECT; k++) {
        const mid = (lo + hi) / 2;
        if (vis(c.at(mid)) === prevV) lo = mid;
        else hi = mid;
      }
      const cut = (lo + hi) / 2;
      spans.push({ a: start, b: cut, v: prevV });
      start = cut;
      prevV = v;
    }
    prevU = u;
  }
  spans.push({ a: start, b: c.u1, v: prevV });

  // On a closed curve the last and first spans meet at the seam.
  if (c.closed && spans.length > 1 && spans[0]!.v === spans[spans.length - 1]!.v) {
    const last = spans.pop()!;
    spans[0] = { a: last.a - (c.u1 - c.u0), b: spans[0]!.b, v: last.v };
  }

  for (const s of spans) {
    if (s.b - s.a <= 1e-12) continue;
    if (s.v) out.visible.push(sample(c, s.a, s.b, du));
    else if (!dash) out.hidden.push(sample(c, s.a, s.b, du));
    else {
      let period = dash.period / c.speed;
      const on = dash.on / c.speed;
      // On closed curves, fit a whole number of dashes so the pattern has no seam.
      if (c.closed) {
        const span = c.u1 - c.u0;
        period = span / Math.max(1, Math.round(span / period));
      }
      const k0 = Math.floor(s.a / period);
      for (let k = k0; k * period < s.b; k++) {
        const a = Math.max(s.a, k * period);
        const b = Math.min(s.b, k * period + on);
        if (b > a) out.hidden.push(sample(c, a, b, du));
      }
    }
  }
  return out;
}

/** Points of `c` from a to b at roughly the sampling step, always including both ends. */
function sample(c: Curve, a: number, b: number, du: number): Vec3[] {
  const steps = Math.max(1, Math.ceil((b - a) / du));
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) pts.push(c.at(wrap(c, a + ((b - a) * i) / steps)));
  return pts;
}

function wrap(c: Curve, u: number): number {
  if (!c.closed) return u;
  const span = c.u1 - c.u0;
  while (u < c.u0) u += span;
  while (u > c.u1) u -= span;
  return u;
}

/** A straight segment as a curve. */
export function segment(p: Vec3, q: Vec3, n = 1): Curve {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  return {
    at: (u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u],
    u0: 0,
    u1: 1,
    n,
    speed: d,
  };
}

/** A circle of radius r about `centre` in the plane spanned by unit vectors e1, e2. */
export function circle(centre: Vec3, e1: Vec3, e2: Vec3, r: number, n = 128): Curve {
  return {
    at: (u) => {
      const c = Math.cos(u) * r,
        s = Math.sin(u) * r;
      return [
        centre[0] + e1[0] * c + e2[0] * s,
        centre[1] + e1[1] * c + e2[1] * s,
        centre[2] + e1[2] * c + e2[2] * s,
      ];
    },
    u0: 0,
    u1: 2 * Math.PI,
    n,
    speed: r,
    closed: true,
  };
}
