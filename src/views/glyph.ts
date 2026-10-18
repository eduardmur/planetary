// A body as a symbol: its outline (keeping NASA's polar flattening), a 30° graticule, the main ring
// edges and the rotation axis to the positive pole, drawn about (0, 0) at a radius in px that is not to
// scale. Detail drops out as the symbol shrinks. The axis is fixed in space: symbols do not spin.

import type { Camera } from '../draw/camera.ts';
import { circle, splitCurve } from '../draw/curves.ts';
import { arrowhead, sub2, unit2 } from '../draw/dims.ts';
import { bbox, type Box } from '../draw/labels.ts';
import {
  behindAnnulus,
  facesCamera,
  graticule,
  hides,
  toWorld,
  type Spheroid,
} from '../draw/spheroid.ts';
import type { DrawList } from '../draw/svg.ts';
import { DEG, cross, mulT, norm, scale, type Vec2, type Vec3 } from '../draw/vec.ts';
import { limbCurve } from './body.ts';

export interface GlyphModel {
  /** Equatorial diameter and polar radius, km. */
  diameter: number;
  polar: number;
  /** Ring edges, km, and the opaque bands that hide the body behind them. */
  rings?: { r: number; line: 'wide' | 'thin' }[];
  opaque?: { inner: number; outer: number }[];
  /** Unit vector to the positive pole, in the camera's world frame. */
  axis: Vec3;
}

/** Wide pen, CSS px (approx.): the outline is stroked half of it inside the radius. */
const PEN = 1.7;
/** Radii (px) from which the graticule (and every ring edge), the axis and its arrowhead are drawn. */
const GRATICULE = 9;
const AXIS = 6;
const ARROW = 12;
/** Hidden lines: dashes of 2 px every 3 px, at any size. */
const DASH = { period: 3, on: 2 };

/**
 * The ring edges a symbol of radius r px can show apart. Under the graticule's size the edges would
 * run together, so only the extent of the opaque (wide) rings is kept, or else the outermost edge.
 */
function ringsAt(rings: NonNullable<GlyphModel['rings']>, r: number) {
  if (r >= GRATICULE) return rings;
  const wide = rings.filter((e) => e.line === 'wide');
  const radii = (wide.length ? wide : rings).map((e) => e.r);
  const keep = wide.length ? [Math.min(...radii), Math.max(...radii)] : [Math.max(...radii)];
  return rings.filter((e) => keep.includes(e.r));
}

/**
 * Draw a body of radius r px about (0, 0), seen by `cam`, every line referenced as `ref`, over a
 * paper disc that masks what is behind it. Returns the box of everything drawn, px.
 */
export function drawGlyph(dl: DrawList, m: GlyphModel, cam: Camera, r: number, ref: string): Box {
  const R = m.diameter / 2;
  const a = m.axis;
  // Body frame: x in the ecliptic plane, z along the axis.
  const e1: Vec3 = Math.hypot(a[0], a[1]) > 1e-9 ? norm(cross(a, [0, 0, 1])) : [1, 0, 0];
  const e2 = cross(a, e1);
  const s: Spheroid = {
    a: 1,
    c: m.polar / R,
    centre: [0, 0, 0],
    R: [e1[0], e2[0], a[0], e1[1], e2[1], a[1], e1[2], e2[2], a[2]],
  };
  const vb = mulT(s.R, cam.toCam);
  const P = (p: Vec3): Vec2 => {
    const q = cam.project(p);
    return [q[0] * r, -q[1] * r];
  };
  const opaque = (m.opaque ?? []).map((g) => ({ inner: g.inner / R, outer: g.outer / R }));
  const behindRings = (q: Vec3) => opaque.length > 0 && behindAnnulus(q, vb, opaque);
  // Dash lengths in the symbol's units (its radius is 1).
  const dash = { period: DASH.period / r, on: DASH.on / r };
  const drawn: Vec2[] = [];

  dl.dot([0, 0], r + 2, '', 'paper');

  if (r >= GRATICULE) {
    for (const g of graticule(s, 30 * DEG, 30 * DEG, 72)) {
      const runs = splitCurve(
        { ...g, at: g.body },
        (q) => facesCamera(s, q, vb) && !behindRings(q),
        null,
      );
      for (const run of runs.visible)
        dl.polyline(
          run.map((q) => P(toWorld(s, q))),
          g.kind === 'equator' ? 'center' : 'thin',
          ref,
        );
    }
  }

  // Ring edges in the equatorial plane, dashed where the body hides them.
  for (const edge of ringsAt(m.rings ?? [], r)) {
    const c = circle([0, 0, 0], e1, e2, edge.r / R, 160);
    const runs = splitCurve(c, (p) => !hides(s, p, cam.toCam), dash);
    for (const run of runs.visible) {
      const pts = run.map(P);
      drawn.push(...pts);
      dl.polyline(pts, edge.line, ref);
    }
    for (const run of runs.hidden) dl.polyline(run.map(P), 'hidden', ref);
  }

  // The outline's outer edge sits on the radius: stroke it half a pen inside.
  const inner = Math.max(0.5, (r - PEN / 2) / r);
  const limb = splitCurve(limbCurve(s, vb), (q) => !behindRings(q), dash);
  const Pi = (q: Vec3) => P(toWorld(s, scale(q, inner)));
  for (const run of limb.visible) {
    const pts = run.map(Pi);
    drawn.push(...pts);
    dl.polyline(pts, 'wide', ref);
  }
  for (const run of limb.hidden) {
    const pts = run.map(Pi);
    drawn.push(...pts);
    dl.polyline(pts, 'hidden', ref);
  }

  // Axis, 0.4 r past each pole, with an arrowhead at the positive one.
  if (r >= AXIS) {
    const L = s.c + 0.4;
    const top = P(scale(a, L)),
      bot = P(scale(a, -L));
    drawn.push(top, bot);
    dl.line(bot, top, 'center', ref);
    if (r >= ARROW) arrowhead(dl, top, unit2(sub2(top, bot)), ref, { len: 6, half: 1.7 });
  }
  return bbox(drawn);
}
