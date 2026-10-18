// Greedy label placement: each label names an anchor point and the positions it may take around it,
// in order of preference; it takes the first one that does not overlap labels already placed or the
// given obstacles, or the least-overlapping one. Widths are exact (single-stroke lettering metrics),
// and drawn lines are kept as exact segments with the clearance each asks for.
//
// Where nothing is clear, a label may move further out on a leader, and as a last resort the lines
// under it give way (ISO 128 and 129-1: lettering is never crossed by a line; the line is interrupted).

import { dimText } from './dims.ts';
import { CAP, letter, measure, type TextSize } from './lettering.ts';
import type { DrawList } from './svg.ts';
import type { Vec2 } from './vec.ts';

export type Spot = 'r' | 'l' | 't' | 'b' | 'tr' | 'tl' | 'br' | 'bl';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Obstacles only: how much a label minds sitting on it (default 1). */
  w?: number;
}

/** A placed label's box, and what it sits on (0: nothing). */
export interface Placed extends Box {
  cost: number;
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
  /** When no spot is clear, also try these multiples of the gap, with a leader back to the anchor. */
  reach?: number[];
  /** When nothing is clear at all, interrupt the lines under the label rather than letter over them. */
  mask?: boolean;
}

export interface AlongOpts {
  ref?: string;
  size?: TextSize;
  /** Fractions along the line to try, in order of preference (outside 0–1: beyond its ends). */
  at?: number[];
  mask?: boolean;
}

/** What had been registered at some moment, to drop what came after (see LabelPlacer.drop()). */
export interface Mark {
  boxes: number;
  lines: number;
}

/** A place a label could take, what it would cost, and its leader, if any. */
interface Cand {
  r: LabelReq;
  box: Box;
  cost: number;
  leader?: [Vec2, Vec2];
}

/** A drawn line: labels keep `pad` px off it, and mind it by `w`. */
interface Seg {
  /** Its place in the order lines were registered (see Mark). */
  i: number;
  a: Vec2;
  b: Vec2;
  pad: number;
  w: number;
  live: boolean;
}

/** Middle first, then either side of it (ISO 129-1 allows a value off-centre). */
const ALONG = [0.5, 0.32, 0.68, 0.18, 0.82];

/**
 * Fractions along a dimension line q1 → q2 to try for its value, from the middle outward in small
 * steps, as far as the value stays `keep` px clear of the ends (where the arrowheads are).
 */
export function spreadAlong(
  q1: Vec2,
  q2: Vec2,
  text: string,
  keep: number,
  size: TextSize = 'm',
): number[] {
  const len = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]);
  const room = 0.5 - ((measure(text) * CAP[size]) / 2 + keep) / len;
  const step = Math.max(0.02, 3 / len);
  const out = [0.5];
  for (let s = step; s <= room + 1e-9; s += step) out.push(0.5 - s, 0.5 + s);
  return out;
}

export function textBox(text: string, size: TextSize = 'm'): { w: number; h: number } {
  const h = CAP[size];
  return { w: measure(text) * h, h: h * 1.35 };
}

/** How dimText() turns and lifts a value on a line along `dir`: its angle (radians, clockwise on the
 *  page), the text's "up" and the distance from the line to the middle of its capitals. */
function dimTurn(dir: Vec2, size: TextSize) {
  let deg = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  if (deg > 60) deg -= 180;
  if (deg <= -120) deg += 180;
  const ang = (deg * Math.PI) / 180;
  const up: Vec2 = [Math.sin(ang), -Math.cos(ang)];
  return { ang, up, lift: CAP[size] / 2 + 3 };
}

const SPOTS: Spot[] = ['r', 'tr', 'br', 'l', 'tl', 'bl', 't', 'b'];

/** Clear space kept between two labels, px. */
const GAP = 5;
/** A leader may touch what it points at: its first few pixels are not counted against it. */
const LEADER_FREE = 4;
/** Cell size of the index of lines, px. */
const CELL = 24;
/** How far round a label the lines give way, where they must: past the reach of a pen stroke. */
const MASK = 2;

const grow = (b: Box, d: number): Box => ({
  x0: b.x0 - d,
  y0: b.y0 - d,
  x1: b.x1 + d,
  y1: b.y1 + d,
});

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Length of the segment a → b inside the rectangle [x0, x1] × [y0, y1] (Liang–Barsky). */
function clipLength(a: Vec2, b: Vec2, x0: number, y0: number, x1: number, y1: number): number {
  let t0 = 0,
    t1 = 1;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dy, a[1] - y0],
    [dy, y1 - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return 0;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return 0;
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

/** How much of a line's band (its clearance either side) a box covers, about in px². */
const bandIn = (s: Seg, b: Box) =>
  clipLength(s.a, s.b, b.x0 - s.pad, b.y0 - s.pad, b.x1 + s.pad, b.y1 + s.pad) * 2 * s.pad * s.w;

export class LabelPlacer {
  readonly placed: Box[] = [];
  private bounds: Box;
  /** Areas to keep labels off (a body's disc, an inset, a mark). */
  readonly obstacles: Box[];
  /** Lines to keep labels off. */
  private readonly lines: Seg[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly seen: number[] = [];
  private query = 0;

  constructor(bounds: Box, obstacles: Box[] = []) {
    this.bounds = bounds;
    this.obstacles = obstacles;
  }

  /** Reserve an area so later labels avoid it. */
  block(b: Box) {
    this.placed.push(b);
  }

  /** Keep labels `pad` px off a drawn polyline, minding it by `w`. (Lines are kept whole: no step is
   *  needed any more, and `_step` is only for callers that still give one.) */
  line(pts: readonly (readonly [number, number])[], pad = 2.5, _step = 6, w = 1) {
    for (let i = 1; i < pts.length; i++) {
      const a: Vec2 = [pts[i - 1]![0], pts[i - 1]![1]],
        b: Vec2 = [pts[i]![0], pts[i]![1]];
      const k = this.lines.length;
      this.lines.push({ i: k, a, b, pad, w, live: true });
      const cx0 = Math.floor((Math.min(a[0], b[0]) - pad) / CELL),
        cx1 = Math.floor((Math.max(a[0], b[0]) + pad) / CELL),
        cy0 = Math.floor((Math.min(a[1], b[1]) - pad) / CELL),
        cy1 = Math.floor((Math.max(a[1], b[1]) + pad) / CELL);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cx * 65536 + cy;
          let c = this.cells.get(key);
          if (!c) this.cells.set(key, (c = []));
          c.push(k);
        }
    }
  }

  /** The live lines whose bands may reach into a box. */
  private near(b: Box): Seg[] {
    const q = ++this.query;
    const out: Seg[] = [];
    for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++)
      for (let cy = Math.floor(b.y0 / CELL); cy <= Math.floor(b.y1 / CELL); cy++)
        for (const k of this.cells.get(cx * 65536 + cy) ?? []) {
          if (this.seen[k] === q) continue;
          this.seen[k] = q;
          const s = this.lines[k]!;
          if (s.live) out.push(s);
        }
    return out;
  }

  /** What has been registered so far. */
  mark(): Mark {
    return { boxes: this.obstacles.length, lines: this.lines.length };
  }

  /** Forget the obstacles and lines registered between two marks (by default, since `from`). */
  drop(from: Mark, to: Mark = this.mark()) {
    this.obstacles.splice(from.boxes, to.boxes - from.boxes);
    for (let i = from.lines; i < to.lines; i++) this.lines[i]!.live = false;
  }

  /** True when a box touches no placed label, no obstacle and no line's band. */
  free(b: Box): boolean {
    return this.cost(b) === 0;
  }

  /** Whether a point is on a line, an obstacle or a label (those registered between the two marks
   *  `except` aside). */
  blocked(p: Vec2, except?: [Mark, Mark]): boolean {
    const inBox = (o: Box) => p[0] >= o.x0 && p[0] <= o.x1 && p[1] >= o.y0 && p[1] <= o.y1;
    if (this.placed.some(inBox)) return true;
    if (
      this.obstacles.some(
        (o, i) => !(except && i >= except[0].boxes && i < except[1].boxes) && inBox(o),
      )
    )
      return true;
    const at = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    return this.near(at).some((s) => {
      if (except && s.i >= except[0].lines && s.i < except[1].lines) return false;
      return clipLength(s.a, s.b, p[0] - s.pad, p[1] - s.pad, p[0] + s.pad, p[1] + s.pad) > 0;
    });
  }

  /** How badly a box would sit: overlap with labels, obstacles and lines, and area outside the
   *  bounds. Against lines and obstacles the box counts a pixel larger: a few strokes reach just
   *  past the lettering's advance (°) or below its line (parentheses). */
  cost(box: Box): number {
    let cost = 0;
    for (const p of this.placed) cost += overlap(grow(box, GAP), p) * 4;
    return cost + this.onInk(box) + this.outside(box);
  }

  /** The part of cost() that lines and obstacles make: what a mask would have to hide. */
  onInk(box: Box): number {
    let cost = 0;
    const ink = grow(box, 1);
    for (const o of this.obstacles) cost += overlap(ink, o) * (o.w ?? 1);
    for (const s of this.near(ink)) cost += bandIn(s, ink);
    return cost;
  }

  /** Area of a box outside the bounds, weighted as cost() weighs it. */
  private outside(box: Box): number {
    const inside = {
      x0: Math.max(box.x0, this.bounds.x0),
      y0: Math.max(box.y0, this.bounds.y0),
      x1: Math.min(box.x1, this.bounds.x1),
      y1: Math.min(box.y1, this.bounds.y1),
    };
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    const kept = Math.max(0, inside.x1 - inside.x0) * Math.max(0, inside.y1 - inside.y0);
    return (area - kept) * 8;
  }

  /**
   * The cost of a w × h label centred at (cx, cy) and turned by `ang` (radians, clockwise on the
   * page), with `margin` px all round: lines and obstacles are measured in the label's own frame, so
   * a turned value can sit close beside a turned line; labels and bounds against its upright box.
   */
  costTurned(cx: number, cy: number, ang: number, w: number, h: number, margin = 1.5): number {
    const box = turnedBox(cx, cy, ang, w, h, margin);
    let cost = this.onInkTurned(cx, cy, ang, w, h, margin);
    for (const p of this.placed) cost += overlap(grow(box, GAP), p) * 4;
    return cost + this.outside(box);
  }

  /** The part of costTurned() that lines and obstacles make. */
  private onInkTurned(
    cx: number,
    cy: number,
    ang: number,
    w: number,
    h: number,
    margin = 1.5,
  ): number {
    const hw = w / 2 + margin,
      hh = h / 2 + margin;
    const c = Math.cos(ang),
      s = Math.sin(ang);
    const ac = Math.abs(c),
      as = Math.abs(s);
    const box = turnedBox(cx, cy, ang, w, h, margin);
    /** A point in the label's frame. */
    const local = (p: Vec2): Vec2 => {
      const dx = p[0] - cx,
        dy = p[1] - cy;
      return [dx * c + dy * s, -dx * s + dy * c];
    };
    let cost = 0;
    for (const o of this.obstacles) {
      const [u, v] = local([(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2]);
      const rx = (o.x1 - o.x0) / 2,
        ry = (o.y1 - o.y0) / 2;
      const ru = rx * ac + ry * as,
        rv = rx * as + ry * ac;
      const du = Math.min(hw + ru - Math.abs(u), 2 * ru, 2 * hw),
        dv = Math.min(hh + rv - Math.abs(v), 2 * rv, 2 * hh);
      if (du > 0 && dv > 0) cost += du * dv * (o.w ?? 1);
    }
    for (const g of this.near(box)) {
      const len = clipLength(
        local(g.a),
        local(g.b),
        -hw - g.pad,
        -hh - g.pad,
        hw + g.pad,
        hh + g.pad,
      );
      cost += len * 2 * g.pad * g.w;
    }
    return cost;
  }

  /** What a leader from a to b would cross: lines, obstacles and labels, past its first few
   *  pixels. */
  leaderCost(a: Vec2, b: Vec2): number {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= LEADER_FREE) return 0;
    const from: Vec2 = [
      a[0] + ((b[0] - a[0]) * LEADER_FREE) / len,
      a[1] + ((b[1] - a[1]) * LEADER_FREE) / len,
    ];
    const box = {
      x0: Math.min(from[0], b[0]),
      y0: Math.min(from[1], b[1]),
      x1: Math.max(from[0], b[0]),
      y1: Math.max(from[1], b[1]),
    };
    let cost = 0;
    // Lines it crosses: the part of the leader within each line's band.
    for (const s of this.near(grow(box, 4))) {
      const n = Math.max(1, Math.ceil(len / 2));
      for (let i = 0; i <= n; i++) {
        const p: Vec2 = [
          from[0] + ((b[0] - from[0]) * i) / n,
          from[1] + ((b[1] - from[1]) * i) / n,
        ];
        if (clipLength(s.a, s.b, p[0] - s.pad, p[1] - s.pad, p[0] + s.pad, p[1] + s.pad) > 0)
          cost += 2 * s.pad * s.w;
      }
    }
    for (const o of this.obstacles)
      cost += clipLength(from, b, o.x0, o.y0, o.x1, o.y1) * 2 * (o.w ?? 1);
    for (const p of this.placed) cost += clipLength(from, b, p.x0, p.y0, p.x1, p.y1) * 8;
    return cost;
  }

  /** The box a label would take at one spot, `k` times its gap from the anchor. */
  boxFor(r: LabelReq, spot: Spot, k = 1): Box {
    const { w, h } = textBox(r.text, r.size ?? 'm');
    return boxAt(r.x, r.y, w, h, (r.gap ?? 6) * k, spot);
  }

  /**
   * Place a label at the best of several anchors, each with its own spots: the first clear spot, in
   * order; else, for requests that may reach, the first clear spot further out on a leader; else the
   * cheapest of all, over a mask if the request asks for one.
   */
  placeAny(dl: DrawList, reqs: LabelReq[]): Placed {
    return this.commit(dl, this.pick(reqs));
  }

  /** Like placeAny(), over groups of requests in order of preference: the first group with a clear
   *  place has it; failing all, the cheapest place of any (the earlier group on a tie). */
  placeFirst(dl: DrawList, groups: LabelReq[][]): Placed {
    let best: Cand | null = null;
    for (const g of groups) {
      const c = this.pick(g);
      if (!best || c.cost < best.cost - 1e-6) best = c;
      if (c.cost === 0) break;
    }
    return this.commit(dl, best!);
  }

  private pick(reqs: LabelReq[]): Cand {
    let best: Cand | null = null;
    const take = (c: Cand) => {
      if (!best || c.cost < best.cost - 1e-6) best = c;
      return best.cost === 0;
    };
    search: {
      for (const r of reqs)
        for (const spot of r.spots ?? SPOTS) {
          const box = this.boxFor(r, spot);
          if (take({ r, box, cost: this.cost(box) })) break search;
        }
      const ks = [...new Set(reqs.flatMap((r) => r.reach ?? []))].sort((a, b) => a - b);
      for (const k of ks)
        for (const r of reqs) {
          if (!r.reach?.includes(k)) continue;
          for (const spot of r.spots ?? SPOTS) {
            const box = this.boxFor(r, spot, k);
            const leader = leaderTo([r.x, r.y], box);
            const cost = this.cost(box) + this.leaderCost(...leader);
            if (take({ r, box, cost, leader })) break search;
          }
        }
    }
    const c = best as Cand | null;
    if (!c) throw new Error('placeAny: nothing to place');
    return c;
  }

  private commit(dl: DrawList, c: Cand): Placed {
    const size = c.r.size ?? 'm';
    const ref = c.r.ref ?? '';
    if (c.cost > 0 && c.r.mask && this.onInk(c.box) > 0) this.mask(dl, corners(c.box), MASK);
    this.placed.push(c.box);
    if (c.leader) {
      dl.line(c.leader[0], c.leader[1], 'dim', ref);
      this.line(c.leader, 1);
    }
    letter(dl, c.r.text, c.box.x0, (c.box.y0 + c.box.y1) / 2, { size, valign: 'middle', ref });
    return { ...c.box, cost: c.cost };
  }

  place(dl: DrawList, r: LabelReq): Placed {
    return this.placeAny(dl, [r]);
  }

  /**
   * Where a dimension value along the line q1 → q2 would go, lettered as dimText() letters it (over
   * the line, readable from the bottom or the right): the first of the fractions `at` along the line
   * where it is clear, else the cheapest. Values in parentheses stand a little higher, clear of their
   * own line.
   */
  along(
    q1: Vec2,
    q2: Vec2,
    text: string,
    o: AlongOpts = {},
  ): { mid: Vec2; t: number; cost: number; ink: number } {
    const size = o.size ?? 'm';
    const dir: Vec2 = [q2[0] - q1[0], q2[1] - q1[1]];
    const { ang, up, lift } = dimTurn(dir, size);
    const raise = text.startsWith('(') ? 1.5 : 0;
    const w = measure(text) * CAP[size];
    let best: { mid: Vec2; t: number; cost: number; ink: number } | null = null;
    for (const t of o.at ?? ALONG) {
      const mid: Vec2 = [q1[0] + dir[0] * t + up[0] * raise, q1[1] + dir[1] * t + up[1] * raise];
      const c: Vec2 = [mid[0] + up[0] * lift, mid[1] + up[1] * lift];
      const cost = this.costTurned(c[0], c[1], ang, w, CAP[size]);
      if (!best || cost < best.cost - 1e-6)
        best = { mid, t, cost, ink: this.onInkTurned(c[0], c[1], ang, w, CAP[size]) };
      if (cost === 0) break;
    }
    return best!;
  }

  /** Letter a dimension value where along() puts it; if nowhere is clear, the lines under it give
   *  way (unless `mask` is false), but never its own dimension line. Returns its upright box (as
   *  placed), where along the line it went, and its turned outline. */
  placeAlong(
    dl: DrawList,
    q1: Vec2,
    q2: Vec2,
    text: string,
    o: AlongOpts = {},
  ): Placed & { t: number; quad: Vec2[] } {
    const size = o.size ?? 'm';
    const { mid, t, cost, ink } = this.along(q1, q2, text, o);
    const dir: Vec2 = [q2[0] - q1[0], q2[1] - q1[1]];
    const quad = dimText(dl, mid, dir, text, o.ref ?? '', size);
    if (ink > 0 && o.mask !== false) {
      const { ang, up, lift } = dimTurn(dir, size);
      const a: Vec2 = [Math.cos(ang), Math.sin(ang)];
      const c: Vec2 = [mid[0] + up[0] * lift, mid[1] + up[1] * lift];
      // Down to 1.5 px under the baseline only: the value's own line, 3 px under it, stays whole.
      const hw = (measure(text) * CAP[size]) / 2 + MASK,
        top = CAP[size] / 2 + MASK,
        bottom = -(CAP[size] / 2 + 1.5);
      const at = (u: number, v: number): Vec2 => [
        c[0] + a[0] * u + up[0] * v,
        c[1] + a[1] * u + up[1] * v,
      ];
      this.mask(dl, [at(-hw, bottom), at(hw, bottom), at(hw, top), at(-hw, top)], 0);
    }
    const box = bbox(quad, 1);
    this.placed.push(box);
    return { ...box, cost, t, quad };
  }

  /** Interrupt the lines under a label: a paper-coloured patch over the quadrilateral `quad` (a box's
   *  corners, in order), `grow` px larger all round. */
  mask(dl: DrawList, quad: Vec2[], grow = 1) {
    dl.fill(
      quad.map((p, i) => {
        // Out along both edges that meet at this corner.
        const prev = quad[(i + quad.length - 1) % quad.length]!,
          next = quad[(i + 1) % quad.length]!;
        const u = unitOf([p[0] - next[0], p[1] - next[1]]),
          v = unitOf([p[0] - prev[0], p[1] - prev[1]]);
        return [p[0] + (u[0] + v[0]) * grow, p[1] + (u[1] + v[1]) * grow] as Vec2;
      }),
      '',
      'mask',
    );
  }
}

/** The upright box round a w × h label centred at (cx, cy), turned by `ang`, with a margin. */
function turnedBox(cx: number, cy: number, ang: number, w: number, h: number, margin: number): Box {
  const hw = w / 2 + margin,
    hh = h / 2 + margin;
  const ac = Math.abs(Math.cos(ang)),
    as = Math.abs(Math.sin(ang));
  const bw = ac * hw + as * hh,
    bh = as * hw + ac * hh;
  return { x0: cx - bw, y0: cy - bh, x1: cx + bw, y1: cy + bh };
}

const unitOf = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-9 ? [v[0] / l, v[1] / l] : [0, 0];
};

const corners = (b: Box): Vec2[] => [
  [b.x0, b.y0],
  [b.x1, b.y0],
  [b.x1, b.y1],
  [b.x0, b.y1],
];

/** A leader from an anchor to a label's box, stopping just short of the box. */
function leaderTo(a: Vec2, box: Box): [Vec2, Vec2] {
  const n: Vec2 = [
    Math.max(box.x0, Math.min(a[0], box.x1)),
    Math.max(box.y0, Math.min(a[1], box.y1)),
  ];
  const l = Math.hypot(n[0] - a[0], n[1] - a[1]) || 1;
  const back = Math.min(1.5, l / 2);
  return [a, [n[0] - ((n[0] - a[0]) / l) * back, n[1] - ((n[1] - a[1]) / l) * back]];
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
