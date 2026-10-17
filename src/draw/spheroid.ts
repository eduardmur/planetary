// An oblate spheroid (a planet) in a drawing: its orientation, which points of the scene it hides,
// its outline in an orthographic view, and the curves of its latitude/longitude graticule.

import type { Camera } from './camera.ts';
import type { Curve } from './curves.ts';
import { add, dot, mul, mulT, type Mat3, type Vec2, type Vec3 } from './vec.ts';

export interface Spheroid {
  /** Equatorial radius, scene units. */
  a: number;
  /** Polar radius, scene units. */
  c: number;
  centre: Vec3;
  /** Body → world rotation. Body +z is the rotation axis, north by the right-hand rule. */
  R: Mat3;
}

/** Body-frame point at parametric latitude/longitude (radians). */
export function surface(s: Spheroid, lat: number, lon: number): Vec3 {
  const cl = Math.cos(lat);
  return [s.a * cl * Math.cos(lon), s.a * cl * Math.sin(lon), s.c * Math.sin(lat)];
}

export const toWorld = (s: Spheroid, q: Vec3): Vec3 => add(s.centre, mul(s.R, q));
export const toBody = (s: Spheroid, p: Vec3): Vec3 =>
  mulT(s.R, [p[0] - s.centre[0], p[1] - s.centre[1], p[2] - s.centre[2]]);

/** Rotation axis in world coordinates. */
export const axisOf = (s: Spheroid): Vec3 => mul(s.R, [0, 0, 1]);

/**
 * Visibility of a point that lies ON the surface: the surface faces the camera there.
 * `vb` is the toward-camera direction already rotated into the body frame.
 */
export function facesCamera(s: Spheroid, qBody: Vec3, vb: Vec3): boolean {
  return (
    (qBody[0] * vb[0]) / (s.a * s.a) +
      (qBody[1] * vb[1]) / (s.a * s.a) +
      (qBody[2] * vb[2]) / (s.c * s.c) >
    0
  );
}

/**
 * Does the body hide a world point that is NOT on its surface (ring edge, orbit, phantom outline)?
 * True when the ray from the point toward the camera passes through the body, or the point is inside.
 */
export function hides(s: Spheroid, p: Vec3, toCam: Vec3): boolean {
  const q = toBody(s, p);
  const v = mulT(s.R, toCam);
  const ia = 1 / (s.a * s.a),
    ic = 1 / (s.c * s.c);
  const A = (v[0] * v[0] + v[1] * v[1]) * ia + v[2] * v[2] * ic;
  const B = 2 * ((q[0] * v[0] + q[1] * v[1]) * ia + q[2] * v[2] * ic);
  const C = (q[0] * q[0] + q[1] * q[1]) * ia + q[2] * q[2] * ic - 1;
  if (C < 0) return true; // inside
  const disc = B * B - 4 * A * C;
  // Both roots share a sign (C/A > 0); they are ahead of the point when their sum −B/A is positive.
  return disc > 0 && B < 0;
}

/** Ring-plane annuli that the body's own surface can be hidden behind (e.g. Saturn's A–C rings). */
export interface Annulus {
  inner: number;
  outer: number;
}

/** Is a body-frame surface point hidden by an opaque annulus in the body's equatorial plane? */
export function behindAnnulus(qBody: Vec3, vb: Vec3, rings: Annulus[]): boolean {
  if (Math.abs(vb[2]) < 1e-9) return false;
  const t = -qBody[2] / vb[2];
  if (t <= 0) return false;
  const x = qBody[0] + vb[0] * t,
    y = qBody[1] + vb[1] * t;
  const r = Math.hypot(x, y);
  for (const g of rings) if (r >= g.inner && r <= g.outer) return true;
  return false;
}

export interface Outline {
  /** Centre in screen-plane units. */
  centre: Vec2;
  /** Semi-axis perpendicular to the projected rotation axis (always the equatorial radius). */
  rx: number;
  /** Semi-axis along the projected rotation axis: √(a²cos²γ + c²sin²γ), γ = angle(view, axis). */
  ry: number;
  /** Screen angle of the projected rotation axis (radians, CCW from screen +x); ry lies along it. */
  angle: number;
}

/** Outline (limb) of the spheroid in an orthographic view: an ellipse. */
export function outline(s: Spheroid, cam: Camera): Outline {
  const ax = axisOf(s);
  const cosG = dot(ax, cam.toCam);
  const sin2 = Math.max(0, 1 - cosG * cosG);
  const ry = Math.sqrt(s.a * s.a * cosG * cosG + s.c * s.c * sin2);
  const p = cam.project(ax);
  const angle = Math.hypot(p[0], p[1]) < 1e-9 ? Math.PI / 2 : Math.atan2(p[1], p[0]);
  return { centre: cam.project(s.centre), rx: s.a, ry, angle };
}

export interface GraticuleCurve extends Curve {
  kind: 'meridian' | 'parallel' | 'equator';
  /** Body-frame point at u, for the facing test. */
  body: (u: number) => Vec3;
}

/**
 * Meridians every `stepLon` and parallels every `stepLat` (radians). `spin` is the body's current rotation
 * angle about its axis, applied by the caller through s.R; curves are built in the body frame.
 */
export function graticule(
  s: Spheroid,
  stepLat: number,
  stepLon: number,
  samples = 72,
): GraticuleCurve[] {
  const curves: GraticuleCurve[] = [];
  const nMer = Math.round((2 * Math.PI) / stepLon);
  for (let i = 0; i < nMer; i++) {
    const lon = i * stepLon;
    const body = (u: number) => surface(s, u, lon);
    curves.push({
      kind: 'meridian',
      body,
      at: (u) => toWorld(s, body(u)),
      u0: -Math.PI / 2,
      u1: Math.PI / 2,
      n: Math.ceil(samples / 2),
      speed: (s.a + s.c) / 2,
    });
  }
  const nPar = Math.round(Math.PI / 2 / stepLat);
  for (let j = -nPar + 1; j < nPar; j++) {
    const lat = j * stepLat;
    const body = (u: number) => surface(s, lat, u);
    curves.push({
      kind: j === 0 ? 'equator' : 'parallel',
      body,
      at: (u) => toWorld(s, body(u)),
      u0: 0,
      u1: 2 * Math.PI,
      n: samples,
      speed: Math.max(1e-6, s.a * Math.cos(lat)),
      closed: true,
    });
  }
  return curves;
}
