// Single-stroke lettering (ISO 3098 type B in spirit): text drawn as pen strokes with the same ink as
// the lines, from the Hershey Sans glyphs in lettering-data.ts. Sizes are cap heights in px.

import { GLYPHS } from './lettering-data.ts';
import type { DrawList } from './svg.ts';
import type { Vec2 } from './vec.ts';

type Stroke = Vec2[];
interface Glyph {
  adv: number;
  strokes: Stroke[];
}

/** Letter spacing as a fraction of the Hershey advance (the source is a little loose for drawings). */
const TRACK = 0.88;
const SUPERSCALE = 0.62;

const SUP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
  '⁺': '+',
};
const SUB: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
};
const ALIAS: Record<string, string> = { '−': '-', '’': "'", '‘': "'", É: 'E' };

/** Glyphs that Hershey Sans lacks, drawn in the same cap-height units. */
const CUSTOM: Record<string, Glyph> = {
  // Thin space (number grouping) and narrow no-break space.
  ' ': { adv: 0.28, strokes: [] },
  ' ': { adv: 0.28, strokes: [] },
  // ♈ first point of Aries: two curls springing from a stem.
  '♈': {
    adv: 1.05,
    strokes: [arc(0.5, 0.0, 0.5, 0.62, 0), curl(0.5, 0.62, -1), curl(0.5, 0.62, 1)].flat(),
  },
  // ☊ ascending node: an arch with a small ring at each foot.
  '☊': {
    adv: 1.1,
    strokes: [ring(0.24, 0.12, 0.1), ring(0.86, 0.12, 0.1), archPts(0.55, 0.5, 0.31, 0.42)],
  },
  // ☉ Sun: a circle with a centre dot.
  '☉': { adv: 1.1, strokes: [ring(0.55, 0.5, 0.42), ring(0.55, 0.5, 0.04)] },
  // ⊥ perpendicular.
  '⊥': {
    adv: 0.95,
    strokes: [
      [
        [0.47, 0.0],
        [0.47, 0.9],
      ],
      [
        [0.12, 0.0],
        [0.82, 0.0],
      ],
    ],
  },
};

function ring(cx: number, cy: number, r: number): Stroke {
  const s: Stroke = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * 2 * Math.PI;
    s.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return s;
}
function archPts(cx: number, cy: number, rx: number, ry: number): Stroke {
  const s: Stroke = [];
  for (let i = 0; i <= 16; i++) {
    const t = Math.PI * (1.08 - (i / 16) * 1.16);
    s.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return s;
}
function arc(x0: number, y0: number, x1: number, y1: number, _: number): Stroke[] {
  return [
    [
      [x0, y0],
      [x1, y1],
    ],
  ];
}
function curl(x: number, y: number, dir: number): Stroke[] {
  const s: Stroke = [];
  // From the stem top, out and up, round and back down.
  for (let i = 0; i <= 14; i++) {
    const t = Math.PI * (i / 14) * 1.25;
    const cx = x + dir * 0.22,
      cy = y + 0.18;
    s.push([cx - dir * Math.cos(t) * 0.22, cy + Math.sin(t) * 0.2]);
  }
  return [s];
}

const cache = new Map<string, Glyph | null>();

function glyph(ch: string): Glyph | null {
  if (cache.has(ch)) return cache.get(ch)!;
  let g: Glyph | null = CUSTOM[ch] ?? null;
  if (!g) {
    const src = GLYPHS[ALIAS[ch] ?? ch];
    if (src) {
      const [adv, enc] = src;
      g = {
        adv,
        strokes: enc
          ? enc.split('|').map((s) => s.split(' ').map((p) => p.split(',').map(Number) as Vec2))
          : [],
      };
    }
  }
  cache.set(ch, g);
  return g;
}

interface Run {
  g: Glyph;
  scale: number;
  rise: number;
}

function layout(s: string): { runs: Run[]; width: number; left: number } {
  const runs: Run[] = [];
  let width = 0;
  for (const ch of s) {
    let base = ch,
      scale = 1,
      rise = 0;
    if (SUP[ch]) {
      base = SUP[ch]!;
      scale = SUPERSCALE;
      rise = 0.52;
    } else if (SUB[ch]) {
      base = SUB[ch]!;
      scale = SUPERSCALE;
      rise = -0.2;
    }
    const g = glyph(base) ?? glyph('?')!;
    runs.push({ g, scale, rise });
    width += g.adv * scale * TRACK;
  }
  // Hershey glyphs carry their spacing on the left; trim the first glyph's bearing for alignment.
  const first = runs[0];
  const left = first ? leftBearing(first.g) * first.scale : 0;
  return { runs, width: width - left, left };
}

function leftBearing(g: Glyph): number {
  let m = Infinity;
  for (const s of g.strokes) for (const p of s) m = Math.min(m, p[0]);
  return Number.isFinite(m) ? m * TRACK : 0;
}

/** Width of `s` in cap heights. */
export function measure(s: string): number {
  return layout(s).width;
}

export type TextSize = 's' | 'm' | 'l' | 'xl';

/** Cap heights (px) per size; strokes are styled per size in CSS. */
export const CAP: Record<TextSize, number> = { s: 6.6, m: 8, l: 10, xl: 20 };

export interface LetterOpts {
  size?: TextSize;
  anchor?: 'start' | 'middle' | 'end';
  /** Where y sits: the baseline, the middle of the capitals, or their top. */
  valign?: 'base' | 'middle' | 'top';
  /** Clockwise rotation in degrees about (x, y), as in SVG. */
  rotate?: number;
  ref?: string;
  /** Draw a paper-coloured halo under the letters so they read over lines. */
  halo?: boolean;
}

/** Letter `s` at (x, y) into the draw list. Returns the four corners of its box (px). */
export function letter(dl: DrawList, s: string, x: number, y: number, o: LetterOpts = {}): Vec2[] {
  const size = o.size ?? 'm';
  const h = CAP[size];
  const { runs, width, left } = layout(s);
  const w = width * h;
  const dx = o.anchor === 'middle' ? -w / 2 : o.anchor === 'end' ? -w : 0;
  const dy = o.valign === 'middle' ? h / 2 : o.valign === 'top' ? h : 0;
  const rot = ((o.rotate ?? 0) * Math.PI) / 180;
  const c = Math.cos(rot),
    sn = Math.sin(rot);
  const T = (px: number, py: number): Vec2 => {
    // Local (px right, py down) → rotated about (x, y).
    const lx = px + dx,
      ly = py + dy;
    return [x + lx * c - ly * sn, y + lx * sn + ly * c];
  };
  let pen = -left;
  const ref = o.ref ?? '';
  const layer = `text-${size}` as const;
  for (const r of runs) {
    for (const st of r.g.strokes) {
      const pts = st.map(([u, v]) =>
        T((pen + u * TRACK * r.scale) * h, -(v * r.scale + r.rise) * h),
      );
      if (pts.length === 1) pts.push([pts[0]![0] + 0.01, pts[0]![1]]);
      dl.polyline(pts, layer, ref);
      if (o.halo !== false) dl.polyline(pts, 'halo', ref);
    }
    pen += r.g.adv * TRACK * r.scale;
  }
  const top = -h * 1.05,
    bot = h * 0.3;
  return [T(0, top), T(w, top), T(w, bot), T(0, bot)];
}

/** Group digits with thin spaces (ISO 80000-1): "12,756" → "12 756", "6378.137" → "6 378.137". */
export function isoNumber(s: string): string {
  return s.replace(/\d[\d,]*(\.\d+)?/g, (m) => {
    const [int, frac] = m.replace(/,/g, '').split('.');
    if (!int || int.length < 5) return frac !== undefined ? `${int}.${frac}` : (int ?? m);
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return frac !== undefined ? `${grouped}.${frac}` : grouped;
  });
}
