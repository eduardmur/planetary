// Greedy label placement: each label names an anchor point and the positions it may take around it,
// in order of preference; it takes the first one that does not overlap labels already placed or the
// given obstacles, or the least-overlapping one. Widths are exact (single-stroke lettering metrics).

import { CAP, letter, measure, type TextSize } from './lettering.ts';
import type { DrawList } from './svg.ts';

export type Spot = 'r' | 'l' | 't' | 'b' | 'tr' | 'tl' | 'br' | 'bl';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LabelReq {
  x: number;
  y: number;
  text: string;
  size?: TextSize;
  ref?: string;
  /** Candidate spots around the anchor, in order of preference. */
  spots?: Spot[];
  /** Distance from the anchor, px. */
  gap?: number;
}

export function textBox(text: string, size: TextSize = 'm'): { w: number; h: number } {
  const h = CAP[size];
  return { w: measure(text) * h, h: h * 1.35 };
}

const SPOTS: Spot[] = ['r', 'tr', 'br', 'l', 'tl', 'bl', 't', 'b'];

/** Clear space kept between two labels, px. */
const GAP = 5;
const grow = (b: Box, d: number): Box => ({
  x0: b.x0 - d,
  y0: b.y0 - d,
  x1: b.x1 + d,
  y1: b.y1 + d,
});

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

export class LabelPlacer {
  readonly placed: Box[] = [];
  private bounds: Box;
  readonly obstacles: Box[];
  constructor(bounds: Box, obstacles: Box[] = []) {
    this.bounds = bounds;
    this.obstacles = obstacles;
  }

  /** Reserve an area so later labels avoid it. */
  block(b: Box) {
    this.placed.push(b);
  }

  /** True when a box touches no placed label and no obstacle. */
  free(b: Box): boolean {
    for (const p of this.placed) if (overlap(grow(b, GAP), p) > 0) return false;
    for (const o of this.obstacles) if (overlap(b, o) > 0) return false;
    return true;
  }

  /** Keep labels off a drawn line: small boxes every few pixels along it. */
  line(pts: readonly (readonly [number, number])[], pad = 2.5, step = 6) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!,
        [bx, by] = pts[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n,
          y = ay + ((by - ay) * k) / n;
        this.obstacles.push({ x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad });
      }
    }
  }

  /** How badly a box would sit: overlap with labels and obstacles (from the `from`-th on), and area
   *  outside the bounds. */
  cost(box: Box, from = 0): number {
    let cost = 0;
    for (const p of this.placed) cost += overlap(grow(box, GAP), p) * 4;
    for (let i = from; i < this.obstacles.length; i++) cost += overlap(box, this.obstacles[i]!);
    const inside = {
      x0: Math.max(box.x0, this.bounds.x0),
      y0: Math.max(box.y0, this.bounds.y0),
      x1: Math.min(box.x1, this.bounds.x1),
      y1: Math.min(box.y1, this.bounds.y1),
    };
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    const kept = Math.max(0, inside.x1 - inside.x0) * Math.max(0, inside.y1 - inside.y0);
    return cost + (area - kept) * 8;
  }

  /** The box a label would take at one spot. */
  boxFor(r: LabelReq, spot: Spot): Box {
    const { w, h } = textBox(r.text, r.size ?? 'm');
    return boxAt(r.x, r.y, w, h, r.gap ?? 6, spot);
  }

  /** Place a label at the best of several anchors, each with its own spots. */
  placeAny(dl: DrawList, reqs: LabelReq[]): Box {
    let best: { r: LabelReq; spot: Spot; cost: number } | null = null;
    for (const r of reqs)
      for (const spot of r.spots ?? SPOTS) {
        const cost = this.cost(this.boxFor(r, spot));
        if (cost === 0) return this.place(dl, { ...r, spots: [spot] });
        if (!best || cost < best.cost - 1e-6) best = { r, spot, cost };
      }
    return this.place(dl, { ...best!.r, spots: [best!.spot] });
  }

  place(dl: DrawList, r: LabelReq): Box {
    const size = r.size ?? 'm';
    const spots = r.spots ?? SPOTS;
    let best: { box: Box; cost: number } | null = null;
    for (const spot of spots) {
      const box = this.boxFor(r, spot);
      const cost = this.cost(box);
      if (!best || cost < best.cost - 1e-6) best = { box, cost };
      if (cost === 0) break;
    }
    const b = best!.box;
    this.placed.push(b);
    letter(dl, r.text, b.x0, (b.y0 + b.y1) / 2, { size, valign: 'middle', ref: r.ref ?? '' });
    return b;
  }
}

function boxAt(x: number, y: number, w: number, h: number, g: number, s: Spot): Box {
  const d = g * 0.7;
  switch (s) {
    case 'r':
      return { x0: x + g, y0: y - h / 2, x1: x + g + w, y1: y + h / 2 };
    case 'l':
      return { x0: x - g - w, y0: y - h / 2, x1: x - g, y1: y + h / 2 };
    case 't':
      return { x0: x - w / 2, y0: y - g - h, x1: x + w / 2, y1: y - g };
    case 'b':
      return { x0: x - w / 2, y0: y + g, x1: x + w / 2, y1: y + g + h };
    case 'tr':
      return { x0: x + d, y0: y - d - h, x1: x + d + w, y1: y - d };
    case 'tl':
      return { x0: x - d - w, y0: y - d - h, x1: x - d, y1: y - d };
    case 'br':
      return { x0: x + d, y0: y + d, x1: x + d + w, y1: y + d + h };
    case 'bl':
      return { x0: x - d - w, y0: y + d, x1: x - d, y1: y + d + h };
  }
}

/** Bounding box of a set of pixel points, grown by `pad`. */
export function bbox(pts: readonly (readonly [number, number])[], pad = 0): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** Candidate label spots that point away from a centre along (dx, dy). */
export function spotsToward(dx: number, dy: number): Spot[] {
  const a = Math.atan2(dy, dx);
  const order: Spot[] = ['r', 'br', 'b', 'bl', 'l', 'tl', 't', 'tr'];
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  // Nearest first; the far side only when everything nearer is taken.
  return [0, 1, 7, 2, 6, 3, 5, 4].map((k) => order[(i + k) % 8]!);
}
