// Every lettered value in View A and the key plan, for every body, every drawn row and the drawing
// sizes of thirteen windows (desktop from 1024×768 to 2560×1440, phones from 320×568 to an iPad held
// upright, and phones held sideways): no other line may run through the lettering or come within a
// stroke's breadth of it, unless a mask interrupts it there. Then the ring radii, the dipole, the values drawn always
// and View A turned any way. The views draw in Node into a recording DrawList; letter() is wrapped so
// that each label's strokes are known.

import { describe, expect, it, vi } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { BODY_IDS, type BodyId } from '../../src/data/index.ts';
import { bodyModel, keyPlanModel } from '../../src/data/model.ts';
import type { Box, LabelPlacer } from '../../src/draw/labels.ts';
import type { LetterOpts } from '../../src/draw/lettering.ts';
import { DrawList, type Layer } from '../../src/draw/svg.ts';
import type { Vec2 } from '../../src/draw/vec.ts';
import { BodyView } from '../../src/views/body.ts';
import { KeyPlanView } from '../../src/views/keyplan.ts';

vi.mock('../../src/draw/lettering.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/draw/lettering.ts')>();
  return {
    ...mod,
    letter(dl: DrawList, s: string, x: number, y: number, o?: LetterOpts) {
      const rec = dl as DrawList & {
        begin?: (s: string, o?: LetterOpts) => void;
        end?: () => void;
      };
      rec.begin?.(s, o);
      try {
        return mod.letter(dl, s, x, y, o);
      } finally {
        rec.end?.();
      }
    },
  };
});

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

function svg(w: number, h: number): SVGSVGElement {
  const el = element();
  el.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h });
  return el as unknown as SVGSVGElement;
}

// ---- Recording ----------------------------------------------------------------------------------

interface Ink {
  layer: Layer;
  ref: string;
  pts: Vec2[];
  /** Filled polygon (arrowheads, dots, masks). */
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

class Recorder extends DrawList {
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

function dense(pts: Vec2[], step: number, closed = false): Vec2[] {
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

function hull(pts: Vec2[]): Vec2[] {
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

function inside(q: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!;
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b[0] - a[0],
    vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

const boxOf = (pts: Vec2[], pad = 0): Box => {
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
const meets = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

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

// ---- The sweep ----------------------------------------------------------------------------------

/** View A's and the key plan's sizes (CSS px) in a few windows, and the key plan inset in View A's
 *  pixels on desktop (measured on the built pages). */
const SIZES = {
  '1440x900': {
    a: { w: 1052, h: 793, inset: { x0: 712, y0: 497, x1: 1052, y1: 827 } },
    p: { w: 339, h: 287.3125 },
  },
  '1280x720': {
    a: { w: 892, h: 613, inset: { x0: 570.890625, y0: 388.203125, x1: 892, y1: 647 } },
    p: { w: 320.109375, h: 216.109375 },
  },
  '390x664': { a: { w: 374, h: 257.15625, inset: null }, p: { w: 374, h: 247.15625 } },
  '1920x1080': {
    a: { w: 1532, h: 973, inset: { x0: 1192, y0: 677, x1: 1532, y1: 1007 } },
    p: { w: 339, h: 287.3125 },
  },
  '1366x768': {
    a: { w: 978, h: 661, inset: { x0: 638, y0: 417, x1: 978, y1: 695 } },
    p: { w: 339, h: 235.3125 },
  },
  '1180x820': {
    a: { w: 792, h: 713, inset: { x0: 506.890625, y0: 448.203125, x1: 792, y1: 747 } },
    p: { w: 284.109375, h: 256.109375 },
  },
  '360x640': { a: { w: 344, h: 246.59375, inset: null }, p: { w: 344, h: 236.59375 } },
  '664x390': { a: { w: 356.390625, h: 299, inset: null }, p: { w: 356.390625, h: 289 } },
  '2560x1440': {
    a: { w: 2172, h: 1333, inset: { x0: 1832, y0: 1037, x1: 2172, y1: 1367 } },
    p: { w: 339, h: 287.3125 },
  },
  '1024x768': {
    a: { w: 636, h: 661, inset: { x0: 407.046875, y0: 417, x1: 636, y1: 695 } },
    p: { w: 227.953125, h: 235.3125 },
  },
  '320x568': { a: { w: 304, h: 214.90625, inset: null }, p: { w: 304, h: 204.53125 } },
  '844x390': { a: { w: 455.390625, h: 299, inset: null }, p: { w: 455.390625, h: 289 } },
  '834x1194': { a: { w: 818, h: 490.359375, inset: null }, p: { w: 818, h: 480.359375 } },
} as const;
type Size = keyof typeof SIZES;
const CHECKED = Object.keys(SIZES) as Size[];
const EPOCH = new Date('2026-10-18T00:00:00Z');

/** The rows each body draws, as render/body.ts marks them (⊢⊣). */
function drawnRows(id: BodyId): { key: string; shape: string }[] {
  const b = bodyModel(id);
  const plan = keyPlanModel(id);
  return PARAMS.filter((p) => p.shape.length)
    .filter((p) => p.key !== 'ringSystem' || b.rings)
    .filter((p) => p.key !== 'magneticField' || b.dipole)
    .filter((p) => plan.j2000 || (p.key !== 'orbitalPeriod' && p.key !== 'orbitalVelocity'))
    .map((p) => ({ key: p.key, shape: p.shape.join('') }));
}

type Drawn = { rec: Recorder; view: BodyView | KeyPlanView };
const drawOf = (v: BodyView | KeyPlanView, rec: Recorder) =>
  (v as unknown as { draw(dl: DrawList, now: number): void }).draw(rec, 0);

function drawViewA(id: BodyId, size: Size, key: string | null): Drawn {
  const s = SIZES[size].a;
  const v = new BodyView(svg(s.w, s.h), bodyModel(id));
  v.clock = () => 2500;
  v.clearInset = !!s.inset;
  v.inset = s.inset ? { ...s.inset } : null;
  v.measure();
  v.setFocus(key, { instant: true });
  const rec = new Recorder();
  drawOf(v, rec);
  return { rec, view: v };
}

function drawKeyPlan(id: BodyId, size: Size, key: string | null): Drawn {
  const s = SIZES[size].p;
  const v = new KeyPlanView(svg(s.w, s.h), keyPlanModel(id), EPOCH);
  v.setFocus(key, { instant: true });
  const rec = new Recorder();
  drawOf(v, rec);
  return { rec, view: v };
}

const report = (hits: Hit[]) =>
  hits.map((h) => `“${h.label}” [${h.ref}] × ${h.what} through=${h.through} d=${h.d}`);

/** Each state of one view of one body at one size, with what collides in it and what lettering
 *  falls outside the drawing. */
function sweep(view: 'A' | 'P', id: BodyId, size: Size): string[] {
  const out: string[] = [];
  const keys = drawnRows(id)
    .filter((r) => r.shape.includes(view))
    .map((r) => r.key);
  const { w, h } = SIZES[size][view === 'A' ? 'a' : 'p'];
  for (const key of [null, ...keys]) {
    const { rec } = view === 'A' ? drawViewA(id, size, key) : drawKeyPlan(id, size, key);
    for (const line of report(collisionsOf(rec))) out.push(`${key ?? 'idle'}: ${line}`);
    for (const l of rec.labels) {
      const b = boxOf(l.strokes.flat());
      if (b.x0 < 0 || b.y0 < 0 || b.x1 > w || b.y1 > h)
        out.push(`${key ?? 'idle'}: “${l.text}” runs out of the drawing`);
    }
  }
  return out;
}

describe('lettering in the drawings stays clear of the lines', () => {
  for (const size of CHECKED)
    for (const id of BODY_IDS) {
      it(`${id} at ${size}: View A`, () => expect(sweep('A', id, size)).toEqual([]));
      it(`${id} at ${size}: key plan`, () => expect(sweep('P', id, size)).toEqual([]));
    }
});

const GIANTS: BodyId[] = ['jupiter', 'saturn', 'uranus', 'neptune'];

describe('ring radii', () => {
  type Placer = LabelPlacer & { placed: Box[] };
  /** The ring values' boxes, and what each costs against everything drawn and lettered before. */
  function ringValues(id: BodyId, size: Size) {
    const proto = BodyView.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = proto.ringDims!;
    let out: { box: Box; cost: number }[] = [];
    proto.ringDims = function (this: BodyView, ...a: unknown[]) {
      const labels = a[1] as Placer;
      const n = labels.placed.length;
      const r = orig.apply(this, a);
      const boxes = labels.placed.splice(n);
      out = boxes.map((box) => ({ box, cost: labels.cost(box) }));
      labels.placed.push(...boxes);
      return r;
    };
    try {
      drawViewA(id, size, 'ringSystem');
    } finally {
      proto.ringDims = orig;
    }
    return out;
  }

  for (const size of CHECKED)
    for (const id of GIANTS)
      it(`${id} at ${size}: every value stands clear of the body, the lines and the other labels`, () => {
        const values = ringValues(id, size);
        expect(values.length).toBeGreaterThanOrEqual(2);
        expect(values.filter((v) => v.cost > 0)).toEqual([]);
      });

  it('a small drawing letters only the innermost and the outermost edge where all would crowd', () => {
    expect(ringValues('uranus', '390x664')).toHaveLength(2);
    expect(ringValues('saturn', '390x664')).toHaveLength(8);
    expect(ringValues('uranus', '1440x900')).toHaveLength(10);
  });
});

describe('the dipole', () => {
  for (const size of CHECKED)
    for (const id of ['earth', 'jupiter', 'uranus', 'neptune'] as BodyId[])
      it(`${id} at ${size}: keeps 2 px off the rotation period`, () => {
        const { rec } = drawViewA(id, size, 'magneticField');
        const rot = rec.labels.find((l) => l.ref === 'rotationPeriod')!;
        const dipole = rec.ink.filter((g) => g.ref === 'magneticField dipoleTilt');
        expect(dipole.length).toBeGreaterThan(0);
        let d = Infinity;
        for (const g of dipole)
          for (const q of dense(g.pts, 0.5, g.fill))
            for (const s of rot.strokes)
              for (let i = 1; i < s.length; i++) d = Math.min(d, segDist(q, s[i - 1]!, s[i]!));
        expect(d).toBeGreaterThanOrEqual(2);
      });
});

describe('values drawn always', () => {
  // A click on a row adds its details; the values already lettered stay where they are.
  const where = (rec: Recorder) =>
    rec.labels
      .filter((l) => ['diameter', 'obliquity', 'rotationPeriod'].includes(l.ref))
      .map(
        (l) =>
          `${l.text} ${boxOf(l.strokes.flat()).x0.toFixed(1)} ${boxOf(l.strokes.flat()).y0.toFixed(1)}`,
      );
  for (const size of CHECKED)
    for (const id of BODY_IDS)
      it(`${id} at ${size}: do not move when a row adds its details`, () => {
        const idle = where(drawViewA(id, size, null).rec);
        expect(idle.length).toBeGreaterThanOrEqual(4);
        for (const key of ['diameter', 'ringSystem', 'magneticField', 'rotationPeriod'])
          if (key === 'diameter' || drawnRows(id).some((r) => r.key === key))
            expect(where(drawViewA(id, size, key).rec), key).toEqual(idle);
      });
});

describe('View A turned', () => {
  // Any yaw at the home pitch, and any yaw in the orbit plane (where a drag leaves the view while
  // the obliquity is open): everything drawn stays in the view and off the key-plan inset.
  for (const size of ['1440x900', '1280x720', '390x664', '1180x820', '1024x768'] as Size[])
    for (const id of BODY_IDS)
      it(`${id} at ${size}: stays inside the view and clear of the key plan`, () => {
        const s = SIZES[size].a;
        const { view } = drawViewA(id, size, null);
        const v = view as BodyView;
        const out: string[] = [];
        for (const pitch of [20, 0])
          for (let yaw = 0; yaw < 360; yaw += 15) {
            v.camera.set({ yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 });
            const rec = new Recorder();
            drawOf(v, rec);
            const pts = [
              ...rec.ink.flatMap((g) => g.pts),
              ...rec.labels.flatMap((l) => l.strokes.flat()),
            ];
            const outside = pts.filter(
              (p) => p[0] < -0.5 || p[1] < -0.5 || p[0] > s.w + 0.5 || p[1] > s.h + 0.5,
            );
            const inset = s.inset
              ? pts.filter(
                  (p) =>
                    p[0] > s.inset!.x0 &&
                    p[1] > s.inset!.y0 &&
                    p[0] < s.inset!.x1 &&
                    p[1] < s.inset!.y1,
                )
              : [];
            if (outside.length || inset.length)
              out.push(
                `yaw ${yaw} pitch ${pitch}: ${outside.length} outside, ${inset.length} on the key plan`,
              );
          }
        expect(out).toEqual([]);
      });
});
