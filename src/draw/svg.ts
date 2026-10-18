// Retained SVG output for a view. Each frame the view fills a DrawList in pixel coordinates; the scene
// turns it into one <path> per (line type, data reference) and one <text> per label, reusing elements so
// the DOM stays small and stable. Elements carry data-ref="<parameter key>" so a table row can light up
// ("redline") the geometry it describes.

import type { Vec2 } from './vec.ts';

/** Line types (ISO 128) and other marks, in paint order. CSS gives each its width and dash pattern. */
export const LAYERS = [
  'paper', // paper-coloured fills that mask what is behind a symbol
  'grid', // reference grids, ecliptic rings
  'hidden', // hidden lines, already cut into dashes in 3D
  'hidden-dash', // hidden lines dashed by CSS (screen-space pattern)
  'phantom', // reference objects: long dash, two dots
  'center', // centre lines and axes: long dash, dot
  'thin', // visible thin lines: graticule, rings, orbits
  'dim', // dimension, extension and leader lines
  'wide', // visible outlines
  'mark', // filled marks: arrowheads, points
  'mask', // paper-coloured patches that interrupt the lines under a label that has nowhere clear
  'halo', // paper-coloured strokes under lettering, so letters read over lines
  'text-s', // lettering, by cap height (see lettering.ts)
  'text-m',
  'text-l',
  'text-xl',
  'hit', // transparent wide strokes over referenced lines, so they are easy to point at
] as const;

export type Layer = (typeof LAYERS)[number];

const f = (n: number) => (Math.round(n * 10) / 10).toString();

export class DrawList {
  readonly strokes = new Map<string, string[]>();
  readonly fills = new Map<string, string[]>();

  private key(layer: Layer, ref: string) {
    return `${layer}|${ref}`;
  }

  polyline(pts: readonly Vec2[], layer: Layer, ref = '', closed = false) {
    if (pts.length < 2) return;
    const k = this.key(layer, ref);
    let arr = this.strokes.get(k);
    if (!arr) this.strokes.set(k, (arr = []));
    let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
    for (let i = 1; i < pts.length; i++) d += `L${f(pts[i]![0])} ${f(pts[i]![1])}`;
    if (closed) d += 'Z';
    arr.push(d);
  }

  line(a: Vec2, b: Vec2, layer: Layer, ref = '') {
    this.polyline([a, b], layer, ref);
  }

  /** A filled polygon (arrowheads, dots). */
  fill(pts: readonly Vec2[], ref = '', layer: Layer = 'mark') {
    if (pts.length < 3) return;
    const k = this.key(layer, ref);
    let arr = this.fills.get(k);
    if (!arr) this.fills.set(k, (arr = []));
    let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
    for (let i = 1; i < pts.length; i++) d += `L${f(pts[i]![0])} ${f(pts[i]![1])}`;
    arr.push(d + 'Z');
  }

  /** A small filled circle. */
  dot(c: Vec2, r: number, ref = '', layer: Layer = 'mark') {
    const k = this.key(layer, ref);
    let arr = this.fills.get(k);
    if (!arr) this.fills.set(k, (arr = []));
    arr.push(
      `M${f(c[0] - r)} ${f(c[1])}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`,
    );
  }
}

const NS = 'http://www.w3.org/2000/svg';

export class SvgScene {
  readonly root: SVGSVGElement | SVGGElement;
  private layers = new Map<Layer, SVGGElement>();
  private paths = new Map<string, SVGPathElement>();
  private hot: string | null = null;
  /** Mirror every referenced line into the hit layer (wide transparent strokes). */
  private hit: boolean;

  constructor(root: SVGSVGElement | SVGGElement, opts: { hit?: boolean } = {}) {
    this.root = root;
    this.hit = opts.hit ?? true;
    for (const l of LAYERS) {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `layer layer-${l}`);
      root.appendChild(g);
      this.layers.set(l, g);
    }
  }

  commit(list: DrawList) {
    const seen = new Set<string>();
    const put = (id: string, layer: Layer, ref: string, d: string) => {
      seen.add(id);
      let el = this.paths.get(id);
      if (!el) {
        el = document.createElementNS(NS, 'path');
        el.setAttribute('class', `ln ln-${layer}`);
        if (ref) el.setAttribute('data-ref', ref);
        if (ref && this.hot && ref.split(' ').includes(this.hot)) el.classList.add('hot');
        this.layers.get(layer)!.appendChild(el);
        this.paths.set(id, el);
      }
      if (el.getAttribute('d') !== d) el.setAttribute('d', d);
    };
    for (const [filled, map] of [
      [false, list.strokes],
      [true, list.fills],
    ] as const) {
      for (const [k, arr] of map) {
        const [layer, ref] = k.split('|') as [Layer, string];
        const d = arr.join('');
        put((filled ? 'f|' : 's|') + k, layer, ref, d);
        if (this.hit && ref && layer !== 'halo' && layer !== 'paper' && layer !== 'mask')
          put('h|' + k, 'hit', ref, d);
      }
    }
    for (const [id, el] of this.paths)
      if (!seen.has(id) && el.getAttribute('d')) el.setAttribute('d', '');
  }

  /** Light up everything drawn for a parameter key (null clears). */
  setHot(key: string | null) {
    this.hot = key;
    for (const el of this.root.querySelectorAll<SVGElement>('[data-ref]')) {
      const refs = el.getAttribute('data-ref')!.split(' ');
      el.classList.toggle('hot', key !== null && refs.includes(key));
    }
    this.root.classList.toggle('has-hot', key !== null);
  }

  /** Keys that this view can show, for the table to know which rows are linked to geometry. */
  refs(): Set<string> {
    const s = new Set<string>();
    for (const el of this.root.querySelectorAll<SVGElement>('[data-ref]'))
      for (const r of el.getAttribute('data-ref')!.split(' ')) s.add(r);
    return s;
  }
}
