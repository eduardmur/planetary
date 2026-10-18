// VIEW A of a body sheet: the body as a drafted spheroid, spinning at the set's time scale.
//
// World frame: Z is the normal to the body's orbit plane. The rotation axis is tilted from Z by NASA's
// obliquity toward +X, so at the home orientation (looking along +Y, 20° above the orbit plane) the
// obliquity is drawn almost at true size, and exactly when the obliquity is in focus (the camera then
// comes down to the orbit plane). The axis runs to the positive pole (right-hand rule), and the body
// turns counter-clockwise about it at |rotation period|: Venus, Uranus and Pluto turn clockwise seen
// from the north side of their orbits because their positive poles point "down".
//
// Some details are drawn only while their row is selected: the polar semi-axis and the core with the
// diameter, the ring radii with the ring system, the dipole with the magnetic field.

import { Camera, type Orientation } from '../draw/camera.ts';
import { circle, splitCurve, type Curve } from '../draw/curves.ts';
import {
  ARROW,
  arrowhead,
  len2,
  linearDim,
  niceLength,
  pathDim,
  scaleBar,
  sub2,
  unit2,
} from '../draw/dims.ts';
import {
  LabelPlacer,
  bbox,
  spotsToward,
  spreadAlong,
  textBox,
  type Box,
  type LabelReq,
  type Spot,
} from '../draw/labels.ts';
import { isoNumber, letter } from '../draw/lettering.ts';
import {
  behindAnnulus,
  facesCamera,
  graticule,
  hides,
  toWorld,
  type Annulus,
  type Spheroid,
} from '../draw/spheroid.ts';
import type { DrawList, Layer } from '../draw/svg.ts';
import {
  DEG,
  cross,
  dot,
  matMul,
  mul,
  mulT,
  norm,
  rotAxis,
  rotY,
  rotZ,
  scale,
  sub,
  add,
  type Vec2,
  type Vec3,
} from '../draw/vec.ts';
import { View } from './view.ts';

/** One ring edge as drawn: radius in km and NASA's printed strings. */
export interface RingEdge {
  name: string;
  r: number;
  text: string;
  /** Line type, chosen from NASA's optical depth (see data/model.ts). */
  line: 'wide' | 'thin' | 'phantom';
}

export interface BodyModel {
  id: string;
  name: string;
  /** Main-table Diameter: the equatorial diameter that sizes the outline. */
  diameter: number;
  diameterText: string;
  /** Body-page polar radius; dimensioned with the diameter, where the flattening is visible. */
  polar: number;
  polarText: string;
  /** Spherical (NASA flattening 0): dimension as SØ. */
  spherical: boolean;
  /** Main-table Obliquity to Orbit, degrees, right-hand-rule pole. */
  obliquity: number;
  obliquityText: string;
  /** Main-table Rotation Period, hours, as printed (negative = retrograde). */
  rotation: number;
  rotationText: string;
  /** Body-page core radius (Earth, Mars), drawn with the diameter. */
  core?: { r: number; text: string; note?: string };
  rings?: {
    edges: RingEdge[];
    /** Opaque bands (km) that hide the body behind them. */
    opaque: { inner: number; outer: number }[];
    /** NASA ring rows outside the drawn edges, as "name radius" text, for the sheet's notes. */
    notDrawn: string[];
  };
  /** Magnetic dipole: drawn on demand. tilt null = coincides with the axis. */
  dipole?: { tilt: number | null; label: string; note?: string };
}

/** Same orientation for VIEW A on every sheet: 20° above the orbit plane, axis plane square on. */
export const BODY_HOME: Orientation = { yaw: 0, pitch: 20 * DEG };
/** The view in which the obliquity is true size: in the orbit plane, axis plane square on. */
const TRUE_OBLIQUITY: Orientation = { yaw: 0, pitch: 0 };
/** Spin time scale for the whole set: one second of real time is one hour. */
export const HOURS_PER_SECOND = 1;
/** Flattening below this is a pixel at screen scale, so the polar semi-axis is not dimensioned. */
export const VISIBLE_FLATTENING = 0.01;
/** Below this drawing radius (px) the graphic scale is left out rather than overprinted. */
const SMALL = 90;
/** Margin kept between the drawing and the edges of its area, px. */
const MARGIN = 10;

/** Geometry of the reference lines and dimensions, in equatorial radii. */
function layout(m: BodyModel) {
  const c = m.polar / (m.diameter / 2);
  const rArc = c + 0.55; // obliquity arc: clear of the spin arrow and the axis tip
  return {
    c,
    rArc,
    axisPos: Math.max(c + 0.34, rArc + 0.08), // positive pole side, to carry the arc
    axisNeg: c + 0.1, // stops short of the diameter dimension
    normal: rArc + 0.1,
    trace: 1.42,
    dimOffset: 1.22, // diameter dimension line, beyond the outline
    hub: c + 0.2, // spin arrow centre on the axis
    spinR: 0.17,
  };
}

export class BodyView extends View {
  readonly m: BodyModel;
  private t0 = performance.now();
  /** Fixed clock for captures (ms since the view started), or null for real time. */
  clock: (() => number) | null = null;
  paused = false;
  private pausedAt = 0;
  private lastSpin = Number.NaN;
  /** Parameter in focus, for details drawn on demand. */
  focus: string | null = null;
  /** Keep clear of the key-plan inset; its rectangle in this view's pixels. */
  clearInset = false;
  inset: Box | null = null;
  /** Where the view was before the obliquity turned it into the orbit plane, to turn back to. */
  private beforeObliquity: Orientation | null = null;
  /** The reader turned the view while the obliquity was in focus: leave it where they put it. */
  private keepTurn = false;

  constructor(svg: SVGSVGElement, m: BodyModel) {
    super(svg, BODY_HOME, { turntable: true });
    this.m = m;
    this.onDrag = () => {
      if (this.focus !== 'obliquity') return;
      this.beforeObliquity = null;
      this.keepTurn = true;
    };
    this.measure();
  }

  protected override animated() {
    return !this.paused;
  }

  /** Skip frames until the spin has moved the outline by a quarter of a pixel (Venus: ~1 per s). */
  protected override stale(now: number) {
    if (this.paused) return false;
    const s = this.spin(now);
    return !(Math.abs(s - this.lastSpin) * this.k < 0.25);
  }

  setPaused(p: boolean) {
    if (p === this.paused) return;
    const now = performance.now();
    if (p) this.pausedAt = now;
    else this.t0 += now - this.pausedAt;
    this.paused = p;
    this.redraw();
  }

  /** Light up a parameter's geometry and draw its details; `instant` turns without animating. */
  setFocus(key: string | null, { instant = false } = {}) {
    const was = this.focus;
    this.focus = key;
    this.scene.setHot(key);
    // The obliquity is true size only in the orbit plane: go there while it is in focus.
    if (key === 'obliquity' && was !== key) {
      this.beforeObliquity = { yaw: this.camera.yaw, pitch: this.camera.pitch };
      this.turn(TRUE_OBLIQUITY, { ms: 700, instant });
    } else if (was === 'obliquity' && key !== was) {
      if (!this.keepTurn) this.turn(this.beforeObliquity ?? BODY_HOME, { ms: 700, instant });
      this.beforeObliquity = null;
      this.keepTurn = false;
    }
    this.redraw();
  }

  protected extent() {
    return { radius: 1.75, fill: 0.9 };
  }

  /**
   * Fit the drawing's footprint (the home orientation, and the rings turned any way) into the free
   * area: the whole view, or, with the key-plan inset, the larger of the areas left of it and above it.
   */
  override measure() {
    super.measure();
    if (!this.m) return;
    const fp = this.footprint();
    const W = this.w,
      H = this.h;
    const areas: Box[] = [{ x0: 0, y0: 0, x1: W, y1: H }];
    if (this.clearInset && this.inset) {
      areas.length = 0;
      areas.push(
        { x0: 0, y0: 0, x1: this.inset.x0, y1: H },
        { x0: 0, y0: 0, x1: W, y1: this.inset.y0 },
      );
    }
    let best: { k: number; ox: number; oy: number } | null = null;
    for (const a of areas) {
      const aw = a.x1 - a.x0 - 2 * MARGIN,
        ah = a.y1 - a.y0 - 2 * MARGIN;
      if (aw <= 0 || ah <= 0) continue;
      const k = Math.min(aw / (fp.x1 - fp.x0), ah / (fp.y1 - fp.y0));
      if (best && k <= best.k) continue;
      // Screen-plane x grows right, y grows up; pixels flip y.
      const ox = a.x0 + MARGIN + (aw - (fp.x1 - fp.x0) * k) / 2 - fp.x0 * k;
      const oy = a.y0 + MARGIN + (ah - (fp.y1 - fp.y0) * k) / 2 + fp.y1 * k;
      best = { k, ox, oy };
    }
    if (best) {
      this.k = best.k;
      this.ox = best.ox;
      this.oy = best.oy;
    }
    this.redraw();
  }

  /**
   * Bounding box (screen-plane units, y up) of everything drawn at the home orientation, and of the
   * outer ring at every turn the reader can give it: any yaw at the home pitch, or in the orbit plane
   * (where the obliquity keeps the view while it is turned). Turned, the other lines stay within the
   * reach of the orbit's trace; the rings sweep further, and would run out of the view.
   */
  private footprint(): Box {
    const m = this.m;
    const L = layout(m);
    const cam = new Camera(BODY_HOME);
    const eps = m.obliquity * DEG;
    const axis: Vec3 = [Math.sin(eps), 0, Math.cos(eps)];
    const pts: Vec3[] = [];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * 2 * Math.PI;
      pts.push(add(scale(cam.right, Math.cos(t)), scale(cam.up, Math.sin(t))));
    }
    for (let i = 0; i <= 24; i++) {
      const t = (eps * i) / 24;
      pts.push([Math.sin(t) * (L.rArc + 0.1), 0, Math.cos(t) * (L.rArc + 0.1)]);
    }
    const outer = m.rings ? Math.max(...m.rings.edges.map((e) => e.r)) / (m.diameter / 2) : 0;
    const ring: Vec3[] = [];
    if (outer) {
      const e1 = norm(cross(axis, [0, 1, 0]));
      const e2 = norm(cross(axis, e1));
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * 2 * Math.PI;
        ring.push(
          scale([...e1].map((v, j) => v * Math.cos(t) + e2[j]! * Math.sin(t)) as Vec3, outer),
        );
      }
      pts.push(...ring);
    }
    pts.push(scale(axis, L.axisPos + 0.12), scale(axis, -L.axisNeg));
    pts.push([0, 0, L.normal], [0, 0, -L.trace], [L.trace, 0, 0], [-L.trace, 0, 0]);
    const p = pts.map((q) => cam.project(q));
    // In the orbit plane the orbit normal stands at its full length, at any yaw.
    p.push([0, L.normal], [0, -L.normal]);
    // The view at yaw + 180° is not the mirror image of the view at yaw: sample the whole turn.
    for (const pitch of [BODY_HOME.pitch, TRUE_OBLIQUITY.pitch])
      for (let d = 0; d < 360; d += 15) {
        const c = new Camera({ yaw: d * DEG, pitch });
        for (const q of ring) p.push(c.project(q));
      }
    const b = {
      x0: Math.min(...p.map((q) => q[0])),
      x1: Math.max(...p.map((q) => q[0])),
      y0: Math.min(...p.map((q) => q[1])),
      y1: Math.max(...p.map((q) => q[1])),
    };
    // Room for the diameter dimension and its value beyond the outline on the negative-pole side,
    // and for labels at the ends.
    const room = L.dimOffset + 0.22;
    const neg = cam.project(scale(axis, -1));
    if (Math.abs(neg[1]) >= Math.abs(neg[0])) {
      if (neg[1] < 0) b.y0 = Math.min(b.y0, -room);
      else b.y1 = Math.max(b.y1, room);
    } else if (neg[0] < 0) b.x0 = Math.min(b.x0, -room);
    else b.x1 = Math.max(b.x1, room);
    const pad = 0.12;
    return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  }

  /** Spin angle (radians) about the body's own +z axis. */
  spin(now: number) {
    const ms = this.clock ? this.clock() : (this.paused ? this.pausedAt : now) - this.t0;
    const hours = (ms / 1000) * HOURS_PER_SECOND;
    return (2 * Math.PI * hours) / Math.abs(this.m.rotation);
  }

  protected draw(dl: DrawList, now: number) {
    const m = this.m;
    const L = layout(m);
    const cam = this.camera;
    const R = m.diameter / 2;
    const eps = m.obliquity * DEG;
    const axis: Vec3 = [Math.sin(eps), 0, Math.cos(eps)];
    const spin = this.spin(now);
    this.lastSpin = spin;
    const s: Spheroid = { a: 1, c: L.c, centre: [0, 0, 0], R: matMul(rotY(eps), rotZ(spin)) };
    const vb = mulT(s.R, cam.toCam);
    const opaque: Annulus[] = (m.rings?.opaque ?? []).map((g) => ({
      inner: g.inner / R,
      outer: g.outer / R,
    }));
    const P = (q: Vec3): Vec2 => this.px(toWorld(s, q));
    const visibleOnSurface = (q: Vec3) =>
      facesCamera(s, q, vb) && !(opaque.length && behindAnnulus(q, vb, opaque));
    const c0 = this.px([0, 0, 0]);
    const small = this.k < SMALL;

    // Graticule at 30°, visible half only (a sphere has no hidden edges). The equator is a plane of
    // symmetry: long-dash dot.
    for (const g of graticule(s, 30 * DEG, 30 * DEG, 96)) {
      const runs = splitCurve({ ...g, at: g.body }, visibleOnSurface, null);
      for (const r of runs.visible)
        dl.polyline(r.map(P), g.kind === 'equator' ? 'center' : 'thin', '');
    }

    // Outline (limb): wide where visible, dashed where an opaque ring band hides it.
    const limbRuns = splitCurve(
      limbCurve(s, vb),
      (q) => !(opaque.length && behindAnnulus(q, vb, opaque)),
      { period: 0.075, on: 0.06 },
    );
    const limbInk: Vec2[][] = [];
    for (const r of limbRuns.visible) {
      const pts = r.map(P);
      limbInk.push(pts);
      dl.polyline(pts, 'wide', 'diameter');
    }
    for (const r of limbRuns.hidden) {
      const pts = r.map(P);
      limbInk.push(pts);
      dl.polyline(pts, 'hidden', 'diameter');
    }

    const bounds = { x0: 4, y0: 4, x1: this.w - 4, y1: this.h - 4 };
    const obstacles: Box[] = [];
    if (this.clearInset && this.inset) obstacles.push(this.inset);
    const labels = new LabelPlacer(bounds, obstacles);
    // The body: its outline, and its disc in thin strips, so that labels keep off it but may come
    // as close to the outline as to any other line (its bounding box would keep them off its corners).
    const disc0 = labels.mark();
    const limb = limbCurve(s, vb);
    const rim: Vec2[] = [];
    for (let i = 0; i <= limb.n; i++)
      rim.push(P(limb.at(limb.u0 + ((limb.u1 - limb.u0) * i) / limb.n)));
    labels.line(rim);
    for (const strip of scanFill(rim, 3)) labels.obstacles.push(strip);
    const disc1 = labels.mark();
    const away = (p: Vec2) => spotsToward(p[0] - c0[0], p[1] - c0[1]);
    /** Keep labels off an arrowhead with its tip at `tip`, pointing along `dir`. */
    const arrowOff = (tip: Vec2, dir: Vec2) => {
      const d = unit2(dir);
      const base: Vec2 = [tip[0] - d[0] * ARROW.len, tip[1] - d[1] * ARROW.len];
      labels.line([base, tip], ARROW.half + 1.5);
    };

    // Rings: edges in the equatorial plane, dashed where the body is in front of them.
    const e1: Vec3 = norm(cross(axis, [0, 1, 0]));
    const e2: Vec3 = norm(cross(axis, e1));
    const ringPx: Vec2[][] = [];
    const ringInk: Vec2[][] = [];
    if (m.rings) {
      for (const edge of m.rings.edges) {
        const c = circle([0, 0, 0], e1, e2, edge.r / R, 220);
        const runs = splitCurve(c, (p) => !hides(s, p, cam.toCam), { period: 0.1, on: 0.075 });
        const layer: Layer = edge.line;
        for (const run of runs.visible) {
          const px = run.map((p) => this.px(p));
          dl.polyline(px, layer, 'ringSystem');
          ringPx.push(px);
        }
        for (const run of runs.hidden) {
          const px = run.map((p) => this.px(p));
          dl.polyline(px, 'hidden', 'ringSystem');
          ringInk.push(px);
        }
      }
      // Labels keep off the rings where they can.
      for (const r of ringPx) labels.line(r);
    }

    // Which way the negative pole points on screen: the diameter dimension goes on that side.
    const negDir = unit2(sub2(this.px(scale(axis, -1)), c0));
    const onDimSide = (v: Vec3) => {
      const d = sub2(this.px(v), c0);
      return d[0] * negDir[0] + d[1] * negDir[1] > 0;
    };

    // Reference lines through the centre: the orbit normal (phantom) and the trace of the orbit
    // plane, and the rotation axis (centre line, to the positive pole). On the dimension side they
    // stop short of the diameter dimension so that no line crosses its value.
    const nTop: Vec3 = [0, 0, onDimSide([0, 0, 1]) ? L.axisNeg : L.normal];
    const nBot: Vec3 = [0, 0, -(onDimSide([0, 0, -1]) ? L.axisNeg : L.normal)];
    const normalPx = [this.px(nBot), this.px(nTop)] as Vec2[];
    dl.polyline(normalPx, 'phantom', 'obliquity');
    const tA: Vec3 = [onDimSide([1, 0, 0]) ? L.axisNeg : L.trace, 0, 0];
    const tB: Vec3 = [-(onDimSide([-1, 0, 0]) ? L.axisNeg : L.trace), 0, 0];
    const tracePx = [this.px(tB), this.px(tA)] as Vec2[];
    dl.polyline(tracePx, 'phantom', '');
    const pos = this.px(scale(axis, L.axisPos));
    const neg = this.px(scale(axis, -L.axisNeg));
    dl.line(neg, pos, 'center', 'obliquity rotationPeriod');
    arrowhead(dl, pos, unit2(sub2(pos, neg)), 'obliquity rotationPeriod');
    labels.line(normalPx);
    labels.line(tracePx);
    labels.line([neg, pos]);
    arrowOff(pos, sub2(pos, neg));

    // With the diameter, the core: a hidden outline, always behind the surface (named last, where
    // there is room).
    const core = this.focus === 'diameter' ? m.core : undefined;
    const rc = core ? (core.r / R) * this.k : 0;
    if (core) {
      const pts: Vec2[] = [];
      for (let i = 0; i <= 120; i++) {
        const t = (i / 120) * 2 * Math.PI;
        pts.push([c0[0] + Math.cos(t) * rc, c0[1] + Math.sin(t) * rc]);
      }
      dl.polyline(pts, 'hidden-dash', 'diameter coreRadius');
    }

    // Obliquity: from the orbit normal to the axis, in their common plane (X–Z), outside the spin
    // arrow.
    const arc: Vec2[] = [];
    const nA = Math.max(8, Math.ceil(m.obliquity / 2));
    for (let i = 0; i <= nA; i++) {
      const t = (eps * i) / nA;
      arc.push(this.px([Math.sin(t) * L.rArc, 0, Math.cos(t) * L.rArc]));
    }
    if (len2(sub2(arc[arc.length - 1]!, arc[0]!)) > 18) pathDim(dl, arc, 'obliquity');
    else dl.polyline(arc, 'dim', 'obliquity');
    labels.line(arc);
    // Where the normal stops short (its end is on the dimension side), an extension line carries it
    // to the arc.
    if (nTop[2] < L.rArc) {
      const ext: Vec2[] = [this.px(nTop), this.px([0, 0, L.rArc + 0.06])];
      dl.polyline(ext, 'dim', 'obliquity');
      labels.line(ext);
    }

    // Spin arrow: 270° about the axis, beyond the positive pole.
    const hub = scale(axis, L.hub);
    const f1 = norm(cross(axis, [0, 1, 0]));
    const f2 = cross(axis, f1);
    const spinPts: Vec2[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = (i / 40) * 1.5 * Math.PI + Math.PI * 0.75;
      spinPts.push(
        this.px([
          hub[0] + (f1[0] * Math.cos(u) + f2[0] * Math.sin(u)) * L.spinR,
          hub[1] + (f1[1] * Math.cos(u) + f2[1] * Math.sin(u)) * L.spinR,
          hub[2] + (f1[2] * Math.cos(u) + f2[2] * Math.sin(u)) * L.spinR,
        ]),
      );
    }
    dl.polyline(spinPts, 'dim', 'rotationPeriod');
    const n = spinPts.length;
    const tip = sub2(spinPts[n - 1]!, spinPts[n - 4]!);
    if (len2(tip) > 0.4) arrowhead(dl, spinPts[n - 1]!, tip, 'rotationPeriod');
    const spinBox = bbox(spinPts, 2);
    labels.block(spinBox);

    // Graphic scale, lower left, in km; left out of a small drawing rather than overprinted. Its place
    // is kept clear of labels (it is drawn last).
    const scaleAt = small
      ? null
      : (() => {
          const pxPerKm = this.k / R;
          const km = niceLength((this.w * 0.16) / pxPerKm);
          return {
            km,
            len: km * pxPerKm,
            x: 14,
            y: this.h - 12,
            text: `${isoNumber(String(km))} km`,
          };
        })();
    if (scaleAt)
      labels.obstacles.push({
        x0: scaleAt.x - 2,
        y0: scaleAt.y - 15,
        x1: scaleAt.x + scaleAt.len + 8 + textBox(scaleAt.text, 's').w,
        y1: scaleAt.y + 8,
      });

    // Equatorial diameter between tangents to the outline, on the side of the negative pole (so it
    // never meets the spin arrow), along the outline's major axis. The value goes where no line
    // crosses it (ISO 129-1 allows it off-centre).
    const perp = norm(cross(axis, cam.toCam));
    let pA = this.px(perp),
      pB = this.px(scale(perp, -1));
    if (pA[0] > pB[0] || (Math.abs(pA[0] - pB[0]) < 1e-6 && pA[1] < pB[1])) [pA, pB] = [pB, pA];
    const d = unit2(sub2(pB, pA));
    const nrm: Vec2 = [-d[1], d[0]];
    const toward = negDir[0] * nrm[0] + negDir[1] * nrm[1] >= 0 ? 1 : -1;
    const off = toward * this.k * L.dimOffset;
    linearDim(dl, pA, pB, off, 'diameter');
    const q1: Vec2 = [pA[0] + nrm[0] * off, pA[1] + nrm[1] * off];
    const q2: Vec2 = [pB[0] + nrm[0] * off, pB[1] + nrm[1] * off];
    labels.line([pA, q1]);
    labels.line([pB, q2]);
    arrowOff(q1, sub2(q1, q2));
    arrowOff(q2, sub2(q2, q1));

    // Values drawn always: the diameter, the obliquity, the positive pole and the rotation period.
    // What is drawn on demand keeps them clear of its lines in every state, so that no value moves
    // when a row is clicked and no line drawn on demand runs through one: they are placed clear of
    // the polar dimension, and those by the positive pole clear of the dipole as well. (The dipole
    // gives way to the diameter's value at the negative pole: see dipole().)
    const polar = 1 - m.polar / R >= VISIBLE_FLATTENING ? this.polarDim(axis, L) : null;
    const dip = this.dipoleGeometry(axis, L, onDimSide);
    const t0 = labels.mark();
    if (polar) for (const seg of [...polar.ext, polar.line]) labels.line(seg);
    const sym = m.spherical ? 'SØ' : 'Ø';
    const dia = `${sym}${isoNumber(m.diameterText)}`;
    const diaAt = labels.placed.length;
    const diaQuad = labels.placeAlong(dl, q1, q2, dia, {
      ref: 'diameter',
      at: spreadAlong(q1, q2, dia, ARROW.len + 3),
    }).quad;
    if (dip) {
      labels.line([dip.a, dip.end]);
      labels.line(dip.arc);
    }
    const t1 = labels.mark();
    // The obliquity at the middle of its arc, else beyond either end of it, else further out on a
    // leader.
    const oblAt = this.px([Math.sin(eps / 2) * L.rArc, 0, Math.cos(eps / 2) * L.rArc]);
    const oblText = `${m.obliquityText}°`;
    labels.placeAny(
      dl,
      [
        { x: oblAt[0], y: oblAt[1], text: oblText, spots: away(oblAt), reach: [2, 3] },
        ...[arc[arc.length - 1]!, arc[0]!].map((e) => ({
          x: e[0],
          y: e[1],
          text: oblText,
          spots: away(e),
          gap: 8,
        })),
      ].map((r) => ({ ...r, ref: 'obliquity', mask: true })),
    );
    labels.place(dl, {
      x: pos[0],
      y: pos[1],
      text: '+',
      ref: 'obliquity',
      spots: away(pos),
      gap: 5,
      mask: true,
    });
    // The rotation period beside the spin arrow: outside it, else inside it, else under or over it.
    const hubPx = this.px(hub);
    const right = hubPx[0] >= c0[0];
    const rotText = `${isoNumber(m.rotationText).replace(/^-/, '−')} h`;
    const mid = (spinBox.x0 + spinBox.x1) / 2;
    const outward: Spot[] = right ? ['r', 'tr', 'br'] : ['l', 'tl', 'bl'];
    const inward: Spot[] = right ? ['l', 'tl', 'bl'] : ['r', 'tr', 'br'];
    labels.placeAny(
      dl,
      [
        { x: right ? spinBox.x1 : spinBox.x0, y: hubPx[1], spots: outward },
        { x: right ? spinBox.x0 : spinBox.x1, y: hubPx[1], spots: inward },
        { x: mid, y: spinBox.y1, spots: ['b' as const] },
        { x: mid, y: spinBox.y0, spots: ['t' as const] },
      ].map((r) => ({
        ...r,
        text: rotText,
        ref: 'rotationPeriod',
        gap: 6,
        reach: [2, 3],
        mask: true,
      })),
    );
    labels.drop(t0, t1);
    labels.line([q1, q2]);

    // With the diameter, the polar semi-axis where the flattening shows: its own dimension parallel
    // to the axis, on the side away from the orbit normal, from the equator to the pole.
    if (polar && this.focus === 'diameter') {
      const ref = 'diameter polarRadius';
      const [a1, a2] = polar.line;
      for (const [p, q] of polar.ext) dl.line(p, q, 'dim', ref);
      pathDim(dl, [a1, a2], ref, 'both');
      for (const seg of polar.ext) labels.line(seg);
      if (len2(sub2(a2, a1)) >= ARROW.len * 1.5) {
        arrowOff(a1, sub2(a1, a2));
        arrowOff(a2, sub2(a2, a1));
      }
      // Along the line where it is clear, else beyond either end of it, on an extension of the line
      // (the rings may leave no room between the extension lines).
      const value = isoNumber(m.polarText);
      const w = textBox(value).w;
      const len = len2(sub2(a2, a1));
      const out = (w / 2 + 6) / len;
      const { t } = labels.placeAlong(dl, a1, a2, value, {
        ref,
        at: [...spreadAlong(a1, a2, value, ARROW.len + 3), 1 + out, -out],
      });
      const u = unit2(sub2(a2, a1));
      /** The point `d` px along the line from a1. */
      const along = (d: number): Vec2 => [a1[0] + u[0] * d, a1[1] + u[1] * d];
      const ends: [Vec2, Vec2] = [a1, a2];
      if (t > 1) dl.line(a2, (ends[1] = along(t * len + w / 2 + 2)), 'dim', ref);
      if (t < 0) dl.line((ends[0] = along(t * len - w / 2 - 2)), a1, 'dim', ref);
      labels.line(ends);
    }

    // The core's leader: the first direction whose label fits and whose leader crosses no line or
    // value outside the outline.
    if (core) {
      const ref = 'diameter coreRadius';
      const text = `CORE R${isoNumber(core.text)}${core.note ?? ''}`;
      // Every line and label but the body, which the leader has to cross.
      const clear = (p: Vec2) => !labels.blocked(p, [disc0, disc1]);
      let best: { cost: number; leader: Vec2[]; end: Vec2; spot: 'l' | 'r' } | null = null;
      for (const a of [2.4, 0.74, 3.88, 5.54, Math.PI, 0, 1.9, 1.24]) {
        const u: Vec2 = [Math.cos(a), Math.sin(a)];
        const at: Vec2 = [c0[0] + u[0] * rc, c0[1] + u[1] * rc];
        const knee: Vec2 = [c0[0] + u[0] * (this.k + 14), c0[1] + u[1] * (this.k + 14)];
        const spot = u[0] < 0 ? 'l' : 'r';
        const end: Vec2 = [knee[0] + (spot === 'l' ? -10 : 10), knee[1]];
        // Keep the label off the outline itself, by a margin.
        const box = labels.boxFor({ x: end[0], y: end[1], text, gap: 4 }, spot);
        const near: Vec2 = [
          Math.max(box.x0, Math.min(c0[0], box.x1)),
          Math.max(box.y0, Math.min(c0[1], box.y1)),
        ];
        let cost = labels.cost(box);
        if (Math.hypot(near[0] - c0[0], near[1] - c0[1]) < this.k + 3) cost += 1000;
        // The leader outside the outline must not cross another line.
        for (let t = 0; t <= 1; t += 0.1) {
          const p: Vec2 = [knee[0] + (end[0] - knee[0]) * t, knee[1] + (end[1] - knee[1]) * t];
          const q: Vec2 = [at[0] + (knee[0] - at[0]) * t, at[1] + (knee[1] - at[1]) * t];
          if (!clear(p)) cost += 40;
          if (Math.hypot(q[0] - c0[0], q[1] - c0[1]) > this.k + 2 && !clear(q)) cost += 40;
        }
        if (!best || cost < best.cost - 1e-6) best = { cost, leader: [at, knee, end], end, spot };
        if (cost === 0) break;
      }
      dl.polyline(best!.leader, 'dim', ref);
      dl.dot(best!.leader[0]!, 1.6, ref);
      labels.line(best!.leader.slice(1));
      labels.place(dl, {
        x: best!.end[0],
        y: best!.end[1],
        text,
        ref,
        spots: [best!.spot],
        gap: 4,
        mask: true,
      });
    }

    // On demand: ring radii and the magnetic dipole.
    if (m.rings && this.focus === 'ringSystem')
      this.ringDims(dl, labels, e1, e2, R, [...ringPx, ...ringInk, ...limbInk]);
    if (m.dipole && this.focus === 'magneticField')
      this.dipole(dl, labels, axis, L, onDimSide, { at: diaAt, quad: diaQuad });

    // Graphic scale, lower left, in km.
    if (scaleAt) {
      const { x, y, len } = scaleAt;
      scaleBar(dl, x, y, len, 2, '');
      letter(dl, '0', x, y - 6, { size: 's' });
      letter(dl, scaleAt.text, x + len + 6, y + 4, { size: 's' });
    }
  }

  /**
   * Running dimension of the drawn ring edges along one radius (ISO 129-1), each value on a leader
   * from its edge. Of radii in several directions, with the values stacked beside their edges or in a
   * column clear of the rings, it takes the first of the usual four that crosses nothing, else the
   * one that crosses least (then the one with the shortest leaders). A small drawing may letter only
   * the innermost and the outermost edge; the popover lists them all.
   */
  private ringDims(
    dl: DrawList,
    labels: LabelPlacer,
    e1: Vec3,
    e2: Vec3,
    R: number,
    ink: Vec2[][],
  ) {
    const cam = this.camera;
    const all = [...this.m.rings!.edges].sort((x, y) => x.r - y.r);
    const o = this.px([0, 0, 0]);
    const small = this.k < SMALL;
    // Radius and name; a small drawing letters the radius alone (the popover names each edge).
    const text = (e: RingEdge) => {
      const r = isoNumber(e.text);
      if (small) return r;
      return `${r} ${/^\d/.test(e.name) ? `RING ${e.name}` : e.name.toUpperCase()}`;
    };
    const key = [
      this.w,
      this.h,
      this.k,
      this.ox,
      this.oy,
      cam.yaw,
      cam.pitch,
      ...labels.placed.flatMap((b) => [b.x0, b.y0]),
    ]
      .map((v) => v.toFixed(2))
      .join(' ');
    let plan = ringPlans.get(this);
    if (plan?.key !== key) {
      plan = { key, ...this.ringPlan(labels, e1, e2, R, all, text, o, ink) };
      ringPlans.set(this, plan);
    }
    const { edges, tips, boxes, left, masked } = plan;
    const far = tips[tips.length - 1]!;
    dl.line(o, far, 'dim', 'ringSystem');
    dl.dot(o, 2, 'ringSystem');
    tips.forEach((p, i) => {
      arrowhead(dl, p, sub2(p, o), 'ringSystem', { len: 6, half: 1.7 });
      const bx = boxes[i]!;
      const y = (bx.y0 + bx.y1) / 2;
      const knee: Vec2 = [left ? bx.x1 + 3 : bx.x0 - 3, y];
      dl.line(p, knee, 'dim', 'ringSystem');
      if (masked[i])
        labels.mask(
          dl,
          [
            [bx.x0, bx.y0],
            [bx.x1, bx.y0],
            [bx.x1, bx.y1],
            [bx.x0, bx.y1],
          ],
          2,
        );
      letter(dl, text(edges[i]!), bx.x0, y, { size: 's', valign: 'middle', ref: 'ringSystem' });
      labels.block(bx);
    });
  }

  /** The search behind ringDims(): which edges to letter, along which radius, and where. */
  private ringPlan(
    labels: LabelPlacer,
    e1: Vec3,
    e2: Vec3,
    R: number,
    all: RingEdge[],
    text: (e: RingEdge) => string,
    o: Vec2,
    ink: Vec2[][],
  ) {
    const cam = this.camera;
    const W = this.w,
      H = this.h;
    const inset = this.clearInset ? this.inset : null;
    const grid = new InkGrid(ink, 1.5);
    /** Area of the boxes outside the view or over the key-plan inset. */
    const badness = (boxes: Box[]) => {
      let cost = 0;
      for (const bx of boxes) {
        const area = (bx.x1 - bx.x0) * (bx.y1 - bx.y0);
        const kept =
          Math.max(0, Math.min(bx.x1, W - 4) - Math.max(bx.x0, 4)) *
          Math.max(0, Math.min(bx.y1, H - 4) - Math.max(bx.y0, 4));
        cost += (area - kept) * 10;
        if (inset) cost += overlapArea(bx, inset) * 10;
      }
      return cost;
    };
    /** The stack moves as one: sideways into the view and, over its tips, up clear of the key plan
     *  under it or the view's bottom edge. */
    const settle = (boxes: Box[], above: boolean, rise = true) => {
      const x0 = Math.min(...boxes.map((bx) => bx.x0)),
        x1 = Math.max(...boxes.map((bx) => bx.x1));
      const slide = x0 < 4 ? 4 - x0 : Math.min(0, W - 4 - x1);
      const under = inset && x1 + slide > inset.x0 && x0 + slide < inset.x1 ? inset.y0 - 3 : H - 4;
      const up = rise && above ? Math.max(0, Math.max(...boxes.map((bx) => bx.y1)) - under) : 0;
      for (const bx of boxes) {
        bx.x0 += slide;
        bx.x1 += slide;
        bx.y0 -= up;
        bx.y1 -= up;
      }
      return up;
    };
    /** Every value in one column, just clear of the rings (and of every tip) at its height. */
    const toColumn = (boxes: Box[], tips: Vec2[], left: boolean) => {
      const span = grid.span(
        Math.min(...boxes.map((bx) => bx.y0)) - 2,
        Math.max(...boxes.map((bx) => bx.y1)) + 2,
      );
      const xs = tips.map((t) => t[0]);
      const x = left
        ? Math.min(span ? span[0] : Infinity, ...xs) - 9
        : Math.max(span ? span[1] : -Infinity, ...xs) + 9;
      for (const bx of boxes) {
        const w = bx.x1 - bx.x0;
        bx.x0 = left ? x - w : x;
        bx.x1 = bx.x0 + w;
      }
    };
    type Plan = {
      edges: RingEdge[];
      tips: Vec2[];
      boxes: Box[];
      left: boolean;
      clash: number;
      lead: number;
    };
    const better = (a: Plan, b: Plan | null) =>
      !b || a.clash < b.clash - 1e-6 || (a.clash <= b.clash + 1e-6 && a.lead < b.lead);
    const plan = (edges: RingEdge[], sx: number, sy: number, above: boolean, column: boolean) => {
      const want: Vec3 = norm([
        cam.right[0] * sx + cam.up[0] * sy,
        cam.right[1] * sx + cam.up[1] * sy,
        cam.right[2] * sx + cam.up[2] * sy,
      ]);
      const a = dot(e1, want),
        b = dot(e2, want);
      // A radius seen end on, or nearly, has no room for its values.
      if (Math.hypot(a, b) < 0.2) return null;
      const dir = norm([e1[0] * a + e2[0] * b, e1[1] * a + e2[1] * b, e1[2] * a + e2[2] * b]);
      const tips = edges.map((e) => this.px(scale(dir, e.r / R)));
      const left = sx < 0;
      // Each value beside its tip, stacked over the tips (or under them) in their own order down the
      // page, so that no leader crosses another value.
      const order = tips
        .map((_, i) => i)
        .sort((i, j) => (tips[j]![1] - tips[i]![1]) * (above ? 1 : -1));
      const boxes: Box[] = [];
      let last = above ? Infinity : -Infinity;
      for (const i of order) {
        const p = tips[i]!;
        const { w, h } = textBox(text(edges[i]!), 's');
        const y = above ? Math.min(p[1] - 10, last - h - 1) : Math.max(p[1] + 10, last + h + 1);
        last = y;
        const x0 = left ? p[0] - 9 - w : p[0] + 9;
        boxes[i] = { x0, y0: y - h / 2, x1: x0 + w, y1: y + h / 2 };
      }
      if (column) toColumn(boxes, tips, left);
      if (settle(boxes, above) && column) {
        toColumn(boxes, tips, left);
        settle(boxes, above, false);
      }
      // What it costs: values outside the view or over the key plan, on lines (the rings and the
      // outline counted closely) or other labels; leaders or arrowheads through another value; the
      // radius through a value. Then, between plans that clash alike, the length of the leaders.
      let clash = badness(boxes);
      let lead = 0;
      const far = tips[tips.length - 1]!;
      boxes.forEach((bx, i) => {
        clash += labels.cost(bx) + grid.count(grow(bx, 1)) * 6 + segIn(o, far, bx) * 40;
        const p = tips[i]!;
        const knee: Vec2 = [left ? bx.x1 + 3 : bx.x0 - 3, (bx.y0 + bx.y1) / 2];
        lead += Math.hypot(knee[0] - p[0], knee[1] - p[1]);
        const u = unit2(sub2(p, o));
        const base: Vec2 = [p[0] - u[0] * 6, p[1] - u[1] * 6];
        boxes.forEach((other, j) => {
          if (j !== i) clash += (segIn(p, knee, other) + segIn(base, p, other)) * 40;
        });
        for (const pl of labels.placed) clash += segIn(p, knee, pl) * 40;
      });
      return { edges, tips, boxes, left, clash, lead } satisfies Plan;
    };
    const search = (edges: RingEdge[]) => {
      let best: Plan | null = null;
      // The usual four radii, values beside their edges: the first that crosses nothing is taken.
      for (const [sx, sy] of RING_DIRS.slice(0, 4))
        for (const above of sy > 0 ? [true, false] : [false, true]) {
          const p = plan(edges, sx, sy, above, false);
          if (!p) continue;
          if (p.clash === 0) return p;
          if (better(p, best)) best = p;
        }
      for (const [sx, sy] of RING_DIRS)
        for (const above of sy > 0 ? [true, false] : [false, true])
          for (const column of [false, true]) {
            const p = plan(edges, sx, sy, above, column);
            if (p && better(p, best)) best = p;
          }
      return best!;
    };
    let best = search(all);
    if (this.k < SMALL && all.length > 2) {
      const area = best.boxes.reduce((s, bx) => s + (bx.x1 - bx.x0) * (bx.y1 - bx.y0), 0);
      if (best.clash > 0.05 * area) {
        const ends = search([all[0]!, all[all.length - 1]!]);
        if (better(ends, best)) best = ends;
      }
    }
    // Where a value still stands on a line, the line gives way under it.
    const masked = best.boxes.map((bx) => labels.onInk(bx) > 0 || grid.count(grow(bx, 1)) > 0);
    return { edges: best.edges, tips: best.tips, boxes: best.boxes, left: best.left, masked };
  }

  /** The polar semi-axis dimension (px): its two extension lines and the dimension line, parallel to
   *  the axis on the side away from the orbit normal, from the equator to the pole. */
  private polarDim(axis: Vec3, L: ReturnType<typeof layout>) {
    const side = norm(scale(sub([0, 0, 1], scale(axis, axis[2])), -1));
    const lat = 1.3;
    const poleW = scale(axis, L.c);
    const ext: [Vec2, Vec2][] = [
      [this.px(side), this.px(scale(side, lat + 0.06))],
      [this.px(poleW), this.px(add(poleW, scale(side, lat + 0.06)))],
    ];
    const line: [Vec2, Vec2] = [this.px(scale(side, lat)), this.px(add(poleW, scale(side, lat)))];
    return { ext, line };
  }

  /**
   * The dipole's line and the arc of its tilt from the axis (px), or null where NASA gives no tilt
   * (the dipole is then the axis). It is drawn in the plane through the axis that is closest to the
   * plane of the drawing, so its tilt reads at (near) true size; NASA gives no longitude to place it
   * by, and on the planet it turns with the rotation. Of the two senses, it tilts away from the orbit
   * normal, out of the obliquity's wedge. Like the axis, it stops short of the diameter dimension,
   * and its tilt is dimensioned about the negative pole, clear of the spin arrow: at most `r` from
   * the centre (in radii), inside the ends of the axis and the dipole so that its arrowheads meet
   * both, and with the dipole's negative end at most `neg`.
   */
  private dipoleGeometry(
    axis: Vec3,
    L: ReturnType<typeof layout>,
    onDimSide: (v: Vec3) => boolean,
    r = L.c + 0.06,
    neg?: number,
  ): { a: Vec2; end: Vec2; arc: Vec2[] } | null {
    const d = this.m.dipole;
    if (!d || d.tilt === null || d.tilt === 0) return null;
    const cam = this.camera;
    let k = sub(cam.toCam, scale(axis, dot(cam.toCam, axis)));
    if (Math.hypot(...k) < 1e-6) k = norm(cross(axis, [0, 0, 1]));
    k = norm(k);
    const tilt = d.tilt * DEG;
    const plus = mul(rotAxis(k, tilt), axis);
    const minus = mul(rotAxis(k, -tilt), axis);
    const sign = plus[2] <= minus[2] ? 1 : -1;
    const dir = sign > 0 ? plus : minus;
    const reach = (v: Vec3) => (onDimSide(v) ? L.axisNeg : 1.4);
    const a = this.px(scale(dir, -Math.min(neg ?? Infinity, reach(scale(dir, -1)))));
    const end = this.px(scale(dir, reach(dir)));
    const arc: Vec2[] = [];
    for (let i = 0; i <= 24; i++)
      arc.push(this.px(scale(mul(rotAxis(k, (sign * tilt * i) / 24), axis), -r)));
    return { a, end, arc };
  }

  /**
   * The magnetic dipole and its notes (see dipoleGeometry()). The diameter's value is lettered first,
   * by the negative pole: there the dipole and the arc of its tilt draw in as far as they must to
   * keep clear of it.
   */
  private dipole(
    dl: DrawList,
    labels: LabelPlacer,
    axis: Vec3,
    L: ReturnType<typeof layout>,
    onDimSide: (v: Vec3) => boolean,
    dia: { at: number; quad: Vec2[] },
  ) {
    const d = this.m.dipole!;
    const ref = 'magneticField dipoleTilt';
    const c0 = this.px([0, 0, 0]);
    /** How close a polyline comes to a label already lettered (the diameter's value by its turned
     *  outline, not its upright box), px. */
    const room = (pts: Vec2[]) => {
      let m = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!,
          b = pts[i]!;
        labels.placed.forEach((box, j) => {
          if (j !== dia.at) m = Math.min(m, boxSegDist(box, a, b));
        });
        m = Math.min(m, quadSegDist(dia.quad, a, b));
      }
      return m;
    };
    let g = this.dipoleGeometry(axis, L, onDimSide);
    if (g) {
      // Pull the arc in toward the outline, then the line's end, a pixel at a time, until both
      // keep 3 px off every label.
      const step = 1 / this.k;
      let r = L.c + 0.06,
        neg = L.axisNeg;
      while (r > L.c + 2.5 * step && room(g!.arc) < 3)
        g = this.dipoleGeometry(axis, L, onDimSide, (r -= step), neg);
      while (neg > r + 2 * step && room([c0, g!.a]) < 3)
        g = this.dipoleGeometry(axis, L, onDimSide, r, (neg -= step));
    }
    // Notes go beyond the negative pole or the ends of the dipole (on a leader, if they must stand
    // further off), else anywhere round the body, wherever is free, else in a corner of the view, as
    // a general note.
    const around: Vec2[] = [];
    for (let i = 0; i < 8; i++)
      around.push([
        c0[0] + Math.cos((i * Math.PI) / 4) * 1.45 * this.k,
        c0[1] + Math.sin((i * Math.PI) / 4) * 1.45 * this.k,
      ]);
    const at = (pts: Vec2[], text: string, size: 's' | 'm', reach?: number[]): LabelReq[] =>
      pts.map((a) => ({
        x: a[0],
        y: a[1],
        text,
        size,
        ref,
        spots: spotsToward(a[0] - c0[0], a[1] - c0[1]),
        ...(reach ? { reach } : {}),
        mask: true,
      }));
    const corners = (text: string, size: 's' | 'm'): LabelReq[] =>
      (
        [
          [6, 6, 'br'],
          [this.w - 6, 6, 'bl'],
          [6, this.h - 6, 'tr'],
          [this.w - 6, this.h - 6, 'tl'],
        ] as const
      ).map(([x, y, spot]) => ({ x, y, text, size, ref, spots: [spot], gap: 0, mask: true }));
    const anchors = [this.px(scale(axis, -1.32))];
    let first: Box | null = null;
    if (!g) {
      first = labels.placeAny(dl, [
        ...at([this.px(scale(axis, -1.1)), ...anchors], d.label, 'm', [2, 3]),
        ...at(around, d.label, 'm'),
        ...corners(d.label, 'm'),
      ]);
    } else {
      dl.line(g.a, g.end, 'phantom', ref);
      pathDim(dl, g.arc, ref, 'both');
      labels.line([g.a, g.end]);
      labels.line(g.arc);
      // The tilt at its arc, as the obliquity is at its own (on a leader if it must stand off), else
      // by the dipole's end there; where that side is crowded, at the dipole's other end, as a note
      // on it; on a drawing too small for any of these, in a corner, as a general note.
      const mid = g.arc[Math.round((g.arc.length - 1) / 2)]!;
      const tilt = (a: Vec2): LabelReq => ({
        x: a[0],
        y: a[1],
        text: d.label,
        ref,
        spots: spotsToward(a[0] - c0[0], a[1] - c0[1]),
        reach: [2, 3],
        mask: true,
      });
      // Other values keep a wider berth from it, so that it never reads as one with them.
      const before = labels.mark();
      for (const b of labels.placed) labels.obstacles.push(grow(b, 6));
      labels.placeFirst(dl, [[tilt(mid)], [tilt(g.a)], [tilt(g.end)], corners(d.label, 'm')]);
      labels.drop(before);
      anchors.push(g.a, g.end);
    }
    if (d.note) {
      // Under (or over) the dipole's own note when there is one, so the two read as one.
      const stack = first
        ? [
            { x: (first.x0 + first.x1) / 2, y: first.y1, spots: ['b' as const] },
            { x: (first.x0 + first.x1) / 2, y: first.y0, spots: ['t' as const] },
          ].map((r) => ({ ...r, text: d.note!, size: 's' as const, ref, gap: 6, mask: true }))
        : [];
      labels.placeAny(dl, [
        ...stack,
        ...at(anchors, d.note, 's', [2, 3]),
        ...at(around, d.note, 's'),
        ...corners(d.note, 's'),
      ]);
    }
  }
}

/** Radii for the ring dimension, as screen directions: the usual four first. */
const RING_DIRS: [number, number][] = [
  [1, -0.6],
  [1, 0.6],
  [-1, -0.6],
  [-1, 0.6],
  [1, 0],
  [-1, 0],
  [1, -1.7],
  [1, 1.7],
  [-1, -1.7],
  [-1, 1.7],
  [0.3, -1],
  [0.3, 1],
  [-0.3, -1],
  [-0.3, 1],
];

/** The ring dimension last drawn by each view, kept while nothing it depends on changes (the planet
 *  spins under it many times a second). */
const ringPlans = new WeakMap<
  BodyView,
  { key: string; edges: RingEdge[]; tips: Vec2[]; boxes: Box[]; left: boolean; masked: boolean[] }
>();

const grow = (b: Box, d: number): Box => ({
  x0: b.x0 - d,
  y0: b.y0 - d,
  x1: b.x1 + d,
  y1: b.y1 + d,
});
const overlapArea = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Distance (px) between a convex quadrilateral and the segment a → b (0 where they meet). */
function quadSegDist(quad: Vec2[], a: Vec2, b: Vec2): number {
  const segDist = (p: Vec2, s: Vec2, t: Vec2) => {
    const vx = t[0] - s[0],
      vy = t[1] - s[1];
    const l2 = vx * vx + vy * vy;
    const u = l2 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * vx + (p[1] - s[1]) * vy) / l2)) : 0;
    return Math.hypot(p[0] - s[0] - u * vx, p[1] - s[1] - u * vy);
  };
  const inside = (p: Vec2) => {
    let c = false;
    for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
      const [xi, yi] = quad[i]!,
        [xj, yj] = quad[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  if (inside(a) || inside(b)) return 0;
  let m = Infinity;
  for (let i = 0; i < quad.length; i++) {
    const s = quad[i]!,
      t = quad[(i + 1) % quad.length]!;
    // Crossing an edge: the segments intersect.
    const d1 = (t[0] - s[0]) * (a[1] - s[1]) - (t[1] - s[1]) * (a[0] - s[0]),
      d2 = (t[0] - s[0]) * (b[1] - s[1]) - (t[1] - s[1]) * (b[0] - s[0]),
      d3 = (b[0] - a[0]) * (s[1] - a[1]) - (b[1] - a[1]) * (s[0] - a[0]),
      d4 = (b[0] - a[0]) * (t[1] - a[1]) - (b[1] - a[1]) * (t[0] - a[0]);
    if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
    m = Math.min(m, segDist(a, s, t), segDist(b, s, t), segDist(s, a, b));
  }
  return m;
}

/** Distance (px) between a box and the segment a → b (0 where they meet). */
function boxSegDist(box: Box, a: Vec2, b: Vec2): number {
  if (segIn(a, b, box) > 0) return 0;
  const toBox = (p: Vec2) =>
    Math.hypot(
      Math.max(box.x0 - p[0], 0, p[0] - box.x1),
      Math.max(box.y0 - p[1], 0, p[1] - box.y1),
    );
  const toSeg = (p: Vec2) => {
    const vx = b[0] - a[0],
      vy = b[1] - a[1];
    const l2 = vx * vx + vy * vy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
  };
  return Math.min(
    toBox(a),
    toBox(b),
    ...(
      [
        [box.x0, box.y0],
        [box.x1, box.y0],
        [box.x1, box.y1],
        [box.x0, box.y1],
      ] as Vec2[]
    ).map(toSeg),
  );
}

/** Length (px) of the segment a → b inside a box. */
function segIn(a: Vec2, b: Vec2, box: Box): number {
  let t0 = 0,
    t1 = 1;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] - box.x0],
    [dx, box.x1 - a[0]],
    [-dy, a[1] - box.y0],
    [dy, box.y1 - a[1]],
  ] as const) {
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

/** Drawn lines sampled into a coarse grid: how much ink a box would cover, and how far it reaches
 *  across a band of rows. */
class InkGrid {
  private cells = new Map<number, Vec2[]>();
  private rows = new Map<number, [number, number]>();
  constructor(lines: Vec2[][], step: number) {
    for (const pts of lines)
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!,
          b = pts[i]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
        for (let k = 0; k < n; k++)
          this.add([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
  }
  private add(q: Vec2) {
    const key = Math.floor(q[0] / 8) * 4096 + Math.floor(q[1] / 8);
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = []));
    c.push(q);
    const y = Math.floor(q[1]);
    const r = this.rows.get(y);
    if (!r) this.rows.set(y, [q[0], q[0]]);
    else {
      r[0] = Math.min(r[0], q[0]);
      r[1] = Math.max(r[1], q[0]);
    }
  }
  /** Samples inside a box. */
  count(b: Box): number {
    let n = 0;
    for (let cx = Math.floor(b.x0 / 8); cx <= Math.floor(b.x1 / 8); cx++)
      for (let cy = Math.floor(b.y0 / 8); cy <= Math.floor(b.y1 / 8); cy++)
        for (const q of this.cells.get(cx * 4096 + cy) ?? [])
          if (q[0] > b.x0 && q[0] < b.x1 && q[1] > b.y0 && q[1] < b.y1) n++;
    return n;
  }
  /** The leftmost and the rightmost ink between two heights, or null. */
  span(y0: number, y1: number): [number, number] | null {
    let lo = Infinity,
      hi = -Infinity;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const r = this.rows.get(y);
      if (r) {
        lo = Math.min(lo, r[0]);
        hi = Math.max(hi, r[1]);
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }
}

/** A closed outline's inside as horizontal strips `step` px high, each as wide as the outline is
 *  anywhere within it (scanline fill). */
function scanFill(pts: Vec2[], step: number): Box[] {
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys),
    hi = Math.max(...ys);
  const out: Box[] = [];
  for (let y0 = lo; y0 < hi; y0 += step) {
    const y1 = Math.min(hi, y0 + step);
    let x0 = Infinity,
      x1 = -Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!,
        b = pts[i]!;
      // The part of each edge within the strip.
      const ta = Math.max(y0, Math.min(a[1], b[1])),
        tb = Math.min(y1, Math.max(a[1], b[1]));
      if (ta > tb) continue;
      for (const y of [ta, tb]) {
        const x = b[1] === a[1] ? a[0] : a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        x0 = Math.min(x0, x, b[1] === a[1] ? b[0] : x);
        x1 = Math.max(x1, x, b[1] === a[1] ? b[0] : x);
      }
    }
    if (x0 < x1) out.push({ x0, y0, x1, y1 });
  }
  return out;
}

/** Contour generator of the spheroid seen along body-frame direction vb, as a closed body-frame curve. */
function limbCurve(s: Spheroid, vb: Vec3): Curve {
  const ia = 1 / (s.a * s.a),
    ic = 1 / (s.c * s.c);
  const nrm = norm([vb[0] * ia, vb[1] * ia, vb[2] * ic]);
  const e1 = Math.abs(nrm[2]) < 0.9 ? norm(cross(nrm, [0, 0, 1])) : norm(cross(nrm, [1, 0, 0]));
  const e2 = cross(nrm, e1);
  return {
    at: (u) => {
      const d: Vec3 = [
        e1[0] * Math.cos(u) + e2[0] * Math.sin(u),
        e1[1] * Math.cos(u) + e2[1] * Math.sin(u),
        e1[2] * Math.cos(u) + e2[2] * Math.sin(u),
      ];
      const r = 1 / Math.sqrt((d[0] * d[0] + d[1] * d[1]) * ia + d[2] * d[2] * ic);
      return [d[0] * r, d[1] * r, d[2] * r];
    },
    u0: 0,
    u1: 2 * Math.PI,
    n: 180,
    speed: s.a,
    closed: true,
  };
}

export { limbCurve };
