// The drawings as the sweeps see them (drawings-*.test.ts): View A and the key plan drawn in Node
// into a recording DrawList, at the sizes the built pages give them (tests/fixtures/drawing-sizes.json,
// which tests/e2e/drawings.spec.ts checks against the pages), and the rules their lettering keeps.
// Each sweep wraps letter() (vi.mock) so that the recording knows each label's strokes.

import { PARAMS } from '../../src/content/params.ts';
import type { BodyId } from '../../src/data/index.ts';
import { bodyModel, keyPlanModel } from '../../src/data/model.ts';
import type { Box } from '../../src/draw/labels.ts';
import type { LetterOpts } from '../../src/draw/lettering.ts';
import { DrawList, type Layer } from '../../src/draw/svg.ts';
import type { Vec2 } from '../../src/draw/vec.ts';
import { BodyView } from '../../src/views/body.ts';
import { KeyPlanView } from '../../src/views/keyplan.ts';
import SIZES from '../fixtures/drawing-sizes.json' with { type: 'json' };

export { SIZES };

// ---- A DOM just big enough for the views -------------------------------------------------------

function element(): Record<string, unknown> {
  return {
    attrs: {} as Record<string, string>,
    dataset: {},
    setAttribute(k: string, v: string) {
      (this.attrs as Record<string, string>)[k] = v;
    },
    getAttribute(k: string) {
      return (this.attrs as Record<string, string>)[k] ?? null;
    },
    appendChild: (c: unknown) => c,
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelectorAll: () => [],
  };
}
(globalThis as unknown as { document: unknown }).document = { createElementNS: element };

function svg(w: number, h: number, label?: string): SVGSVGElement {
  const el = element();
  el.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h });
  if (label) (el.setAttribute as (k: string, v: string) => void)('aria-label', label);
  return el as unknown as SVGSVGElement;
}

// ---- Recording ----------------------------------------------------------------------------------

interface Ink {
  layer: Layer;
  ref: string;
  pts: Vec2[];
  /** Filled polygon (arrowheads, dots). */
  fill: boolean;
}
interface Label {
  text: string;
  ref: string;
  strokes: Vec2[][];
}

const LINES = new Set<string>([
  'grid',
  'hidden',
  'hidden-dash',
  'phantom',
  'center',
  'thin',
  'dim',
  'wide',
  'mark',
]);

export class Recorder extends DrawList {
  readonly ink: Ink[] = [];
  readonly labels: Label[] = [];
  readonly masks: Vec2[][] = [];
  private cur: Label | null = null;
  begin(text: string, o?: LetterOpts) {
    this.cur = { text, ref: o?.ref ?? '', strokes: [] };
  }
  end() {
    if (this.cur?.strokes.length) this.labels.push(this.cur);
    this.cur = null;
  }
  override polyline(pts: readonly Vec2[], layer: Layer, ref = '', closed = false) {
    super.polyline(pts, layer, ref, closed);
    if (pts.length < 2) return;
    const p = pts.map((q) => [q[0], q[1]] as Vec2);
    if (closed) p.push(p[0]!);
    if (layer.startsWith('text-')) this.cur?.strokes.push(p);
    else if (LINES.has(layer)) this.ink.push({ layer, ref, pts: p, fill: false });
  }
  override fill(pts: readonly Vec2[], ref = '', layer: Layer = 'mark') {
    super.fill(pts, ref, layer);
    const p = pts.map((q) => [q[0], q[1]] as Vec2);
    if ((layer as string) === 'mask') this.masks.push(p);
    else if (LINES.has(layer)) this.ink.push({ layer, ref, pts: p, fill: true });
  }
  override dot(c: Vec2, r: number, ref = '', layer: Layer = 'mark') {
    super.dot(c, r, ref, layer);
    const p: Vec2[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      p.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
    if (LINES.has(layer)) this.ink.push({ layer, ref, pts: p, fill: true });
  }
}

// ---- Geometry -----------------------------------------------------------------------------------

export function dense(pts: Vec2[], step: number, closed = false): Vec2[] {
  const out: Vec2[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < m; k++)
      out.push([a[0] + ((b[0] - a[0]) * k) / m, a[1] + ((b[1] - a[1]) * k) / m]);
  }
  if (!closed) out.push(pts[pts.length - 1]!);
  return out;
}

export function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [],
    up: Vec2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function inside(q: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!;
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b[0] - a[0],
    vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

export const boxOf = (pts: Vec2[], pad = 0): Box => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
};
export const meets = (a: Box, b: Box) =>
  a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Clear space a label keeps from other ink, between centre lines: a narrow stroke's breadth (the
 *  outline is twice as wide). A value lettered along its own dimension line sits 3 px over it, and
 *  only the Ø's stroke comes nearer. */
const CLEAR = 1.3;
const clearOf = (layer: string, own = false) => (own ? 1 : layer === 'wide' ? CLEAR + 0.5 : CLEAR);

interface Hit {
  label: string;
  ref: string;
  what: string;
  /** Length (px) of the other ink inside the label's glyph hull. */
  through: number;
  /** Closest approach between centre lines, px. */
  d: number;
}

/** Every label that other ink runs through, or comes within CLEAR of. */
function collisionsOf(rec: Recorder): Hit[] {
  const hits = new Map<string, Hit>();
  // Masks interrupt lines and marks, never lettering (it is drawn over them).
  const masked = (g: { layer: string }, q: Vec2) =>
    g.layer !== 'text' && rec.masks.some((m) => inside(q, m));
  const others = (self: Label) => [
    ...rec.ink,
    ...rec.labels
      .filter((l) => l !== self)
      .flatMap((l) => l.strokes.map((s) => ({ layer: 'text', ref: l.ref, pts: s, fill: false }))),
  ];
  for (const lab of rec.labels) {
    const glyph = lab.strokes.flatMap((s) => (s.length > 1 ? dense(s, 0.4) : s));
    const H = hull(glyph);
    const bb = boxOf(glyph);
    const segs: [Vec2, Vec2][] = lab.strokes.flatMap((s) =>
      s.slice(1).map((b, i) => [s[i]!, b] as [Vec2, Vec2]),
    );
    for (const g of others(lab)) {
      const own = g.layer === 'dim' && !!lab.ref && g.ref === lab.ref;
      const clear = clearOf(g.layer, own);
      const pad = clear + 0.5;
      if (!meets(boxOf(g.pts), boxOf(glyph, pad))) continue;
      const pts = dense(g.pts, 0.5, g.fill).filter((q) => !masked(g, q));
      let through = 0,
        d = Infinity;
      for (const q of pts) {
        if (q[0] < bb.x0 - pad || q[0] > bb.x1 + pad || q[1] < bb.y0 - pad || q[1] > bb.y1 + pad)
          continue;
        if (H.length > 2 && inside(q, H)) through += 0.5;
        for (const [a, b] of segs) d = Math.min(d, segDist(q, a, b));
      }
      if (g.fill && glyph.some((q) => inside(q, g.pts) && !masked(g, q))) d = 0;
      if (!(through > 0 || d < clear)) continue;
      const k = `${lab.text}|${lab.ref}|${g.layer}|${g.ref}`;
      const h = hits.get(k);
      if (h) {
        h.through += through;
        h.d = Math.min(h.d, Math.round(d * 100) / 100);
      } else
        hits.set(k, {
          label: lab.text,
          ref: lab.ref,
          what: `${g.layer}|${g.ref}`,
          through,
          d: Math.round(d * 100) / 100,
        });
    }
  }
  return [...hits.values()];
}

/** Labels that read as one: within 3 px of each other, or side by side on one line (their lettering
 *  more than 3 px level with each other) less than 10 px apart. */
function crowdingOf(rec: Recorder): string[] {
  const out: string[] = [];
  const all = rec.labels.map((l) => ({
    l,
    b: boxOf(l.strokes.flat()),
    pts: l.strokes.flatMap((s) => dense(s, 0.4)),
    segs: l.strokes.flatMap((s) => s.slice(1).map((q, i) => [s[i]!, q] as [Vec2, Vec2])),
  }));
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i]!,
        B = all[j]!;
      const gx = Math.max(A.b.x0, B.b.x0) - Math.min(A.b.x1, B.b.x1);
      const gy = Math.max(A.b.y0, B.b.y0) - Math.min(A.b.y1, B.b.y1);
      if (gx > 12 || gy > 12) continue;
      let d = Infinity;
      for (const q of B.pts) for (const [a, b] of A.segs) d = Math.min(d, segDist(q, a, b));
      if (d < 3) out.push(`“${A.l.text}” and “${B.l.text}” ${d.toFixed(2)} px apart`);
      else if (gy < -3 && gx > -1 && gx < 10)
        out.push(`“${A.l.text}” and “${B.l.text}” side by side ${gx.toFixed(1)} px apart`);
    }
  return out;
}

/** Marks (dots, arrowheads) and outlines that a mask covers in part (paper that only meets the
 *  edge of a mark hides none of it). */
function maskedMarksOf(rec: Recorder): string[] {
  const out: string[] = [];
  const marks = rec.ink.filter(
    (g) => g.fill || (g.ref === 'diameter' && (g.layer === 'wide' || g.layer === 'hidden')),
  );
  const under = (q: Vec2, m: Vec2[]) =>
    inside(q, m) && m.every((a, i) => segDist(q, a, m[(i + 1) % m.length]!) > 0.05);
  for (const g of marks) {
    const b = boxOf(g.pts);
    const pts = dense(g.pts, 0.25, g.fill);
    for (const m of rec.masks)
      if (meets(b, boxOf(m)) && pts.some((q) => under(q, m))) {
        out.push(`a mask over ${g.fill ? 'a mark' : 'the outline'} of ${g.ref || 'no row'}`);
        break;
      }
  }
  return out;
}

// ---- The sweep ----------------------------------------------------------------------------------

/** View A's and the key plan's sizes (CSS px) in the windows the sweep covers, and the key-plan inset
 *  in View A's pixels on desktop, as the built pages give them. */
export type Size = keyof typeof SIZES;
export const CHECKED = Object.keys(SIZES) as Size[];
const EPOCH = new Date('2026-10-18T00:00:00Z');
/** Every two months over two years: the planets move round their orbits, and the date with them. */
export const DATES = Array.from(
  { length: 12 },
  (_, i) => new Date(EPOCH.getTime() + Math.round(i * 60.875) * 86_400_000),
);

/** The rows each body draws, as render/body.ts marks them (⊢⊣). */
export function drawnRows(id: BodyId): { key: string; shape: string }[] {
  const b = bodyModel(id);
  const plan = keyPlanModel(id);
  return PARAMS.filter((p) => p.shape.length)
    .filter((p) => p.key !== 'ringSystem' || b.rings)
    .filter((p) => p.key !== 'magneticField' || b.dipole)
    .filter((p) => plan.j2000 || (p.key !== 'orbitalPeriod' && p.key !== 'orbitalVelocity'))
    .map((p) => ({ key: p.key, shape: p.shape.join('') }));
}

type Drawn = { rec: Recorder; view: BodyView | KeyPlanView };
export const drawOf = (v: BodyView | KeyPlanView, rec: Recorder) =>
  (v as unknown as { draw(dl: DrawList, now: number): void }).draw(rec, 0);

export function viewA(id: BodyId, size: Size, label?: string): BodyView {
  const s = SIZES[size].a;
  const v = new BodyView(svg(s.w, s.h, label), bodyModel(id));
  v.clock = () => 2500;
  v.clearInset = !!s.inset;
  v.inset = s.inset ? { ...s.inset } : null;
  v.measure();
  return v;
}

export function drawViewA(id: BodyId, size: Size, key: string | null): Drawn {
  const v = viewA(id, size);
  v.setFocus(key, { instant: true });
  const rec = new Recorder();
  drawOf(v, rec);
  return { rec, view: v };
}

export function drawKeyPlan(id: BodyId, size: Size, key: string | null, epoch = EPOCH): Drawn {
  const s = SIZES[size].p;
  const v = new KeyPlanView(svg(s.w, s.h), keyPlanModel(id), epoch);
  v.setFocus(key, { instant: true });
  const rec = new Recorder();
  drawOf(v, rec);
  return { rec, view: v };
}

const report = (hits: Hit[]) =>
  hits.map((h) => `“${h.label}” [${h.ref}] × ${h.what} through=${h.through} d=${h.d}`);

/** What is wrong with the lettering of one drawing w × h px. */
export function faults(rec: Recorder, w: number, h: number): string[] {
  const out = [...report(collisionsOf(rec)), ...crowdingOf(rec), ...maskedMarksOf(rec)];
  for (const l of rec.labels) {
    const b = boxOf(l.strokes.flat());
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > w || b.y1 > h)
      out.push(`“${l.text}” runs out of the drawing`);
  }
  return out;
}

/** Each state of one view of one body at one size (the key plan on a given date), with what is wrong
 *  with its lettering. */
export function sweep(view: 'A' | 'P', id: BodyId, size: Size, epoch = EPOCH): string[] {
  const out: string[] = [];
  const keys = drawnRows(id)
    .filter((r) => r.shape.includes(view))
    .map((r) => r.key);
  const { w, h } = SIZES[size][view === 'A' ? 'a' : 'p'];
  for (const key of [null, ...keys]) {
    const { rec } = view === 'A' ? drawViewA(id, size, key) : drawKeyPlan(id, size, key, epoch);
    for (const line of faults(rec, w, h)) out.push(`${key ?? 'idle'}: ${line}`);
  }
  return out;
}
