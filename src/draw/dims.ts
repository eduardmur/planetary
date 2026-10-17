// Dimensioning marks in pixel space (ISO 129-1): closed filled arrowheads, dimension lines with
// extension lines, dimensions along projected 3D arcs, leaders and centre marks. Text is placed by the
// caller (lettering.ts) so that it can join the label layout.

import { CAP, letter, type TextSize } from './lettering.ts';
import type { DrawList } from './svg.ts';
import type { Vec2 } from './vec.ts';

/** Arrowhead: closed, filled, 30° included angle. */
export const ARROW = { len: 8, half: 2.15 };

export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const mul2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const len2 = (a: Vec2) => Math.hypot(a[0], a[1]);
export const unit2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0];
};
export const perp2 = (a: Vec2): Vec2 => [-a[1], a[0]];

/** Filled arrowhead with its tip at `tip`, pointing along `dir`. */
export function arrowhead(dl: DrawList, tip: Vec2, dir: Vec2, ref = '', size = ARROW) {
  const d = unit2(dir);
  const n = perp2(d);
  const base = sub2(tip, mul2(d, size.len));
  dl.fill([tip, add2(base, mul2(n, size.half)), sub2(base, mul2(n, size.half))], ref);
}

/**
 * Linear dimension between two feature points (px), with the dimension line offset sideways by
 * `offset` px (positive = to the left of p1→p2 in screen space, i.e. along perp(p2 − p1)).
 * Extension lines leave a small gap at the feature and overshoot the dimension line.
 */
export function linearDim(dl: DrawList, p1: Vec2, p2: Vec2, offset: number, ref = '') {
  const d = unit2(sub2(p2, p1));
  const n = perp2(d);
  const side = Math.sign(offset) || 1;
  const gap = 3,
    over = 4;
  const q1 = add2(p1, mul2(n, offset));
  const q2 = add2(p2, mul2(n, offset));
  if (Math.abs(offset) > gap) {
    dl.line(add2(p1, mul2(n, gap * side)), add2(q1, mul2(n, over * side)), 'dim', ref);
    dl.line(add2(p2, mul2(n, gap * side)), add2(q2, mul2(n, over * side)), 'dim', ref);
  }
  if (len2(sub2(q2, q1)) > 2 * ARROW.len + 4) {
    dl.line(q1, q2, 'dim', ref);
    arrowhead(dl, q1, mul2(d, -1), ref);
    arrowhead(dl, q2, d, ref);
  } else {
    // Too short for the arrows inside: put them outside, pointing in.
    const ext = ARROW.len + 8;
    dl.line(sub2(q1, mul2(d, ext)), add2(q2, mul2(d, ext)), 'dim', ref);
    arrowhead(dl, q1, d, ref);
    arrowhead(dl, q2, mul2(d, -1), ref);
  }
}

/** A dimension drawn along a polyline (e.g. a projected 3D arc), with arrowheads as asked. */
export function pathDim(
  dl: DrawList,
  pts: Vec2[],
  ref = '',
  arrows: 'both' | 'end' | 'none' = 'both',
) {
  if (pts.length < 2) return;
  dl.polyline(pts, 'dim', ref);
  const n = pts.length;
  if (len2(sub2(pts[n - 1]!, pts[0]!)) < ARROW.len * 1.5) return;
  const endDir = sub2(pts[n - 1]!, pts[Math.max(0, n - 3)]!);
  const startDir = sub2(pts[0]!, pts[Math.min(n - 1, 2)]!);
  if (arrows === 'both' || arrows === 'end') arrowhead(dl, pts[n - 1]!, endDir, ref);
  if (arrows === 'both') arrowhead(dl, pts[0]!, startDir, ref);
}

/** Centre mark: a small cross. */
export function centreMark(dl: DrawList, c: Vec2, size = 6, ref = '') {
  dl.line([c[0] - size, c[1]], [c[0] + size, c[1]], 'thin', ref);
  dl.line([c[0], c[1] - size], [c[0], c[1] + size], 'thin', ref);
}

/** Graphic scale bar: alternating segments with lettered ends, `len` px for `value` units. */
export function scaleBar(
  dl: DrawList,
  x: number,
  y: number,
  len: number,
  parts: number,
  ref = '',
): void {
  const h = 3;
  dl.line([x, y], [x + len, y], 'thin', ref);
  dl.line([x, y + h], [x + len, y + h], 'thin', ref);
  for (let i = 0; i <= parts; i++)
    dl.line([x + (len * i) / parts, y - 2], [x + (len * i) / parts, y + h + 2], 'thin', ref);
  for (let i = 0; i < parts; i += 2) {
    const a = x + (len * i) / parts,
      b = x + (len * (i + 1)) / parts;
    dl.fill(
      [
        [a, y],
        [b, y],
        [b, y + h],
        [a, y + h],
      ],
      ref,
    );
  }
}

/** A "nice" scale-bar length (1, 2 or 5 × 10ⁿ) close to `target`. */
export function niceLength(target: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const m = target / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

/**
 * Value text for a dimension line through `mid` along `dir` (px): parallel to the line, above it (ISO
 * 129-1 method 1), turned so it reads from the bottom or the right. Returns the text's corners.
 */
export function dimText(
  dl: DrawList,
  mid: Vec2,
  dir: Vec2,
  text: string,
  ref = '',
  size: TextSize = 'm',
): Vec2[] {
  // Readable from the bottom or the right (ISO 129-1): steep values read bottom-to-top.
  let ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  if (ang > 60) ang -= 180;
  if (ang <= -120) ang += 180;
  const r = (ang * Math.PI) / 180;
  // The text's own "up" after rotation (screen y grows downward).
  const up: Vec2 = [Math.sin(r), -Math.cos(r)];
  const lift = CAP[size] / 2 + 3;
  return letter(dl, text, mid[0] + up[0] * lift, mid[1] + up[1] * lift, {
    anchor: 'middle',
    valign: 'middle',
    rotate: ang,
    ref,
    size,
  });
}
