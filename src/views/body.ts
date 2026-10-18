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
  arrowhead,
  dimText,
  len2,
  linearDim,
  niceLength,
  pathDim,
  scaleBar,
  sub2,
  unit2,
} from '../draw/dims.ts';
import { LabelPlacer, bbox, spotsToward, textBox, type Box } from '../draw/labels.ts';
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
  /** The reader turned the view while the obliquity was in focus: keep their turn afterwards. */
  private keepTurn = false;

  constructor(svg: SVGSVGElement, m: BodyModel) {
    super(svg, BODY_HOME, { turntable: true });
    this.m = m;
    this.onTurn = () => {
      if (this.focus !== 'obliquity') return;
      this.beforeObliquity = null;
      this.keepTurn = true;
    };
    this.measure();
  }

  /**
   * What View A shows, from where the camera is or is turning to: 'tilt' in the orbit plane with the
   * axis plane square on (the obliquity at true size), 'edge' in the orbit plane turned from there,
   * 'above' the orbit plane.
   */
  get aspect(): 'tilt' | 'edge' | 'above' {
    const { yaw, pitch } = this.camera.target;
    if (Math.abs(pitch) > 1e-3) return 'above';
    return Math.abs(Math.sin(yaw)) < 1e-3 ? 'tilt' : 'edge';
  }

  /** With the obliquity in focus, a reset goes back to the view that shows it at true size. */
  override resetView() {
    if (this.focus !== 'obliquity') return super.resetView();
    this.beforeObliquity = null;
    this.keepTurn = false;
    this.turn(TRUE_OBLIQUITY, { ms: 700 });
    this.onTurned?.();
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
    // The obliquity is true size only in the orbit plane: go there while it is in focus. Afterwards
    // go back; or, when the reader turned the view meanwhile, keep their turn and only rise back
    // above the orbit plane.
    if (key === 'obliquity' && was !== key) {
      this.beforeObliquity = this.camera.target;
      this.turn(TRUE_OBLIQUITY, { ms: 700, instant });
    } else if (was === 'obliquity' && key !== was) {
      const back = this.keepTurn
        ? { yaw: this.camera.target.yaw, pitch: BODY_HOME.pitch }
        : (this.beforeObliquity ?? BODY_HOME);
      this.turn(back, { ms: 700, instant });
      this.beforeObliquity = null;
      this.keepTurn = false;
    }
    this.redraw();
  }

  protected extent() {
    return { radius: 1.75, fill: 0.9 };
  }

  /**
   * Fit the drawing's footprint at the home orientation into the free area: the whole view, or, with
   * the key-plan inset, the larger of the areas left of it and above it.
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

  /** Bounding box (screen-plane units, y up) of everything drawn at the home orientation. */
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
    if (outer) {
      const e1 = norm(cross(axis, [0, 1, 0]));
      const e2 = norm(cross(axis, e1));
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * 2 * Math.PI;
        pts.push(
          scale([...e1].map((v, j) => v * Math.cos(t) + e2[j]! * Math.sin(t)) as Vec3, outer),
        );
      }
    }
    pts.push(scale(axis, L.axisPos + 0.12), scale(axis, -L.axisNeg));
    pts.push([0, 0, L.normal], [0, 0, -L.trace], [L.trace, 0, 0], [-L.trace, 0, 0]);
    const p = pts.map((q) => cam.project(q));
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
    const limbPx: Vec2[] = [];
    for (const r of limbRuns.visible) {
      const pts = r.map(P);
      limbPx.push(...pts);
      dl.polyline(pts, 'wide', 'diameter');
    }
    for (const r of limbRuns.hidden) dl.polyline(r.map(P), 'hidden', 'diameter');

    const bounds = { x0: 4, y0: 4, x1: this.w - 4, y1: this.h - 4 };
    const obstacles: Box[] = [bbox(limbPx.length ? limbPx : [c0], 1)];
    if (this.clearInset && this.inset) obstacles.push(this.inset);
    const labels = new LabelPlacer(bounds, obstacles);
    const away = (p: Vec2) => spotsToward(p[0] - c0[0], p[1] - c0[1]);

    // Rings: edges in the equatorial plane, dashed where the body is in front of them.
    const e1: Vec3 = norm(cross(axis, [0, 1, 0]));
    const e2: Vec3 = norm(cross(axis, e1));
    const ringPx: Vec2[][] = [];
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
        for (const run of runs.hidden)
          dl.polyline(
            run.map((p) => this.px(p)),
            'hidden',
            'ringSystem',
          );
      }
      // Labels may cross a ring only where nothing else is free (coarse samples keep it cheap).
      for (const r of ringPx) labels.line(r, 2.5, 10);
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
    if (nTop[2] < L.rArc)
      dl.line(this.px(nTop), this.px([0, 0, L.rArc + 0.06]), 'dim', 'obliquity');

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

    // Equatorial diameter between tangents to the outline, on the side of the negative pole (so it
    // never meets the spin arrow), along the outline's major axis. The value goes where no centre
    // line crosses it (ISO 129-1 allows it off-centre).
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
    const sym = m.spherical ? 'SØ' : 'Ø';
    this.alongText(dl, labels, q1, q2, `${sym}${isoNumber(m.diameterText)}`, 'diameter');
    labels.line([q1, q2]);

    // With the diameter, the polar semi-axis where the flattening shows: its own dimension parallel
    // to the axis, on the side away from the orbit normal, from the equator to the pole.
    if (this.focus === 'diameter' && 1 - m.polar / R >= VISIBLE_FLATTENING) {
      const side = norm(scale(sub([0, 0, 1], scale(axis, axis[2])), -1));
      const lat = 1.3;
      const poleW = scale(axis, L.c);
      const eqPx = this.px(side);
      const polePx = this.px(poleW);
      const a1 = this.px(scale(side, lat));
      const a2 = this.px(add(poleW, scale(side, lat)));
      const ref = 'diameter polarRadius';
      dl.line(eqPx, this.px(scale(side, lat + 0.06)), 'dim', ref);
      dl.line(polePx, this.px(add(poleW, scale(side, lat + 0.06))), 'dim', ref);
      pathDim(dl, [a1, a2], ref, 'both');
      labels.line([a1, a2]);
      this.alongText(dl, labels, a1, a2, isoNumber(m.polarText), ref);
    }

    // Labels: the obliquity value, the positive pole and the rotation period.
    const oblAt = this.px([Math.sin(eps / 2) * L.rArc, 0, Math.cos(eps / 2) * L.rArc]);
    labels.place(dl, {
      x: oblAt[0],
      y: oblAt[1],
      text: `${m.obliquityText}°`,
      ref: 'obliquity',
      spots: away(oblAt),
    });
    labels.place(dl, {
      x: pos[0],
      y: pos[1],
      text: '+',
      ref: 'obliquity',
      spots: away(pos),
      gap: 5,
    });
    const hubPx = this.px(hub);
    const right = hubPx[0] >= c0[0];
    labels.place(dl, {
      x: right ? spinBox.x1 : spinBox.x0,
      y: hubPx[1],
      text: `${isoNumber(m.rotationText).replace(/^-/, '−')} h`,
      ref: 'rotationPeriod',
      spots: right
        ? ['r', 'tr', 'br', 'b', 't', 'l', 'tl', 'bl']
        : ['l', 'tl', 'bl', 'b', 't', 'r', 'tr', 'br'],
      gap: 4,
    });

    // The core's leader: the first direction whose label fits and whose leader crosses no line
    // outside the outline.
    if (core) {
      const ref = 'diameter coreRadius';
      const text = `CORE R${isoNumber(core.text)}${core.note ?? ''}`;
      // Every obstacle but the first, the outline's bounding box, which the leader has to cross.
      const clear = (p: Vec2) =>
        labels.obstacles.every(
          (o, i) => i === 0 || p[0] < o.x0 || p[0] > o.x1 || p[1] < o.y0 || p[1] > o.y1,
        );
      let best: { cost: number; leader: Vec2[]; end: Vec2; spot: 'l' | 'r' } | null = null;
      for (const a of [2.4, 0.74, 3.88, 5.54, Math.PI, 0, 1.9, 1.24]) {
        const u: Vec2 = [Math.cos(a), Math.sin(a)];
        const at: Vec2 = [c0[0] + u[0] * rc, c0[1] + u[1] * rc];
        const knee: Vec2 = [c0[0] + u[0] * (this.k + 14), c0[1] + u[1] * (this.k + 14)];
        const spot = u[0] < 0 ? 'l' : 'r';
        const end: Vec2 = [knee[0] + (spot === 'l' ? -10 : 10), knee[1]];
        // The outline's bounding box is too coarse here: keep the label off the outline itself.
        const box = labels.boxFor({ x: end[0], y: end[1], text, gap: 4 }, spot);
        const near: Vec2 = [
          Math.max(box.x0, Math.min(c0[0], box.x1)),
          Math.max(box.y0, Math.min(c0[1], box.y1)),
        ];
        let cost = labels.cost(box, 1);
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
      });
    }

    // On demand: ring radii and the magnetic dipole.
    if (m.rings && this.focus === 'ringSystem') this.ringDims(dl, labels, e1, e2, R);
    if (m.dipole && this.focus === 'magneticField') this.dipole(dl, labels, axis);

    // Graphic scale, lower left, in km.
    if (!small) {
      const pxPerKm = this.k / R;
      const Lkm = niceLength((this.w * 0.16) / pxPerKm);
      const len = Lkm * pxPerKm;
      const x = 14,
        y = this.h - 12;
      scaleBar(dl, x, y, len, 2, '');
      letter(dl, '0', x, y - 6, { size: 's' });
      letter(dl, `${isoNumber(String(Lkm))} km`, x + len + 6, y + 4, { size: 's' });
    }
  }

  /** Value text along a dimension line, at the first place along it that no line crosses. */
  private alongText(
    dl: DrawList,
    labels: LabelPlacer,
    q1: Vec2,
    q2: Vec2,
    text: string,
    ref: string,
  ) {
    const d = unit2(sub2(q2, q1));
    const { w, h } = textBox(text);
    for (const t of [0.5, 0.32, 0.68, 0.18, 0.82]) {
      const mid: Vec2 = [q1[0] + (q2[0] - q1[0]) * t, q1[1] + (q2[1] - q1[1]) * t];
      // Axis-aligned box around the rotated text, lifted above the line.
      const up: Vec2 = Math.abs(d[0]) > 0.5 ? [0, -1] : [d[1] > 0 ? 1 : -1, 0];
      const cx = mid[0] + up[0] * (h / 2 + 3),
        cy = mid[1] + up[1] * (h / 2 + 3);
      const hw = Math.abs(d[0]) * (w / 2) + Math.abs(d[1]) * (h / 2);
      const hh = Math.abs(d[1]) * (w / 2) + Math.abs(d[0]) * (h / 2);
      const box = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
      if (labels.free(box) || t === 0.82) {
        labels.block(bbox(dimText(dl, mid, d, text, ref), 1));
        return;
      }
    }
  }

  /**
   * Running dimension of the drawn ring edges along one radius (ISO 129-1). Of the four diagonal
   * directions, it takes the first whose values all fit in the view and clear the key-plan inset.
   */
  private ringDims(dl: DrawList, labels: LabelPlacer, e1: Vec3, e2: Vec3, R: number) {
    const cam = this.camera;
    const edges = [...this.m.rings!.edges].sort((x, y) => x.r - y.r);
    const o = this.px([0, 0, 0]);
    // Radius and name; a small drawing letters the radius alone (the popover names each edge).
    const text = (e: RingEdge) => {
      const r = isoNumber(e.text);
      if (this.k < SMALL) return r;
      return `${r} ${/^\d/.test(e.name) ? `RING ${e.name}` : e.name.toUpperCase()}`;
    };
    type Plan = {
      dir: Vec3;
      tips: Vec2[];
      boxes: Box[];
      cost: number;
      leftSide: boolean;
    };
    /** Area of the boxes outside the view or over the key-plan inset. */
    const badness = (boxes: Box[]) => {
      let cost = 0;
      for (const bx of boxes) {
        const area = (bx.x1 - bx.x0) * (bx.y1 - bx.y0);
        const kept =
          Math.max(0, Math.min(bx.x1, this.w - 4) - Math.max(bx.x0, 4)) *
          Math.max(0, Math.min(bx.y1, this.h - 4) - Math.max(bx.y0, 4));
        cost += (area - kept) * 10;
        if (this.clearInset && this.inset) {
          const ix =
            Math.max(0, Math.min(bx.x1, this.inset.x1) - Math.max(bx.x0, this.inset.x0)) *
            Math.max(0, Math.min(bx.y1, this.inset.y1) - Math.max(bx.y0, this.inset.y0));
          cost += ix * 10;
        }
      }
      return cost;
    };
    const plans: Plan[] = [];
    search: for (const [sx, sy] of [
      [1, -0.6],
      [1, 0.6],
      [-1, -0.6],
      [-1, 0.6],
    ] as const) {
      const want: Vec3 = norm([
        cam.right[0] * sx + cam.up[0] * sy,
        cam.right[1] * sx + cam.up[1] * sy,
        cam.right[2] * sx + cam.up[2] * sy,
      ]);
      const a = dot(e1, want),
        b = dot(e2, want);
      const dir = norm([e1[0] * a + e2[0] * b, e1[1] * a + e2[1] * b, e1[2] * a + e2[2] * b]);
      const tips = edges.map((e) => this.px(scale(dir, e.r / R)));
      const leftSide = sx < 0;
      // Each value beside its tip, stacked over the tips (or under them) in their own order down
      // the page, so that no leader crosses another value.
      for (const above of sy > 0 ? [true, false] : [false, true]) {
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
          const x0 = leftSide ? p[0] - 9 - w : p[0] + 9;
          boxes[i] = { x0, y0: y - h / 2, x1: x0 + w, y1: y + h / 2 };
        }
        // The stack moves as one: sideways into the view and, over its tips, up clear of the key
        // plan under it or the view's bottom edge.
        const x0 = Math.min(...boxes.map((bx) => bx.x0)),
          x1 = Math.max(...boxes.map((bx) => bx.x1));
        const slide = x0 < 4 ? 4 - x0 : Math.min(0, this.w - 4 - x1);
        const under =
          this.clearInset && this.inset && x1 + slide > this.inset.x0 && x0 + slide < this.inset.x1
            ? this.inset.y0 - 3
            : this.h - 4;
        const rise = above ? Math.max(0, Math.max(...boxes.map((bx) => bx.y1)) - under) : 0;
        for (const bx of boxes) {
          bx.x0 += slide;
          bx.x1 += slide;
          bx.y0 -= rise;
          bx.y1 -= rise;
        }
        const cost = badness(boxes);
        plans.push({ dir, tips, boxes, cost, leftSide });
        if (cost === 0) break search;
      }
    }
    const best = plans.reduce((x, y) => (y.cost < x.cost ? y : x));
    const far = best.tips[best.tips.length - 1]!;
    dl.line(o, far, 'dim', 'ringSystem');
    dl.dot(o, 2, 'ringSystem');
    best.tips.forEach((p, i) => {
      arrowhead(dl, p, sub2(p, o), 'ringSystem', { len: 6, half: 1.7 });
      const bx = best.boxes[i]!;
      const y = (bx.y0 + bx.y1) / 2;
      const knee: Vec2 = [best.leftSide ? bx.x1 + 3 : bx.x0 - 3, y];
      dl.line(p, knee, 'dim', 'ringSystem');
      letter(dl, text(edges[i]!), bx.x0, y, {
        size: 's',
        valign: 'middle',
        ref: 'ringSystem',
      });
      labels.block(bx);
    });
  }

  /**
   * The magnetic dipole. It is drawn in the plane through the axis that is closest to the plane of
   * the drawing, so its tilt reads at (near) true size; NASA gives no longitude to place it by, and
   * on the planet it turns with the rotation.
   */
  private dipole(dl: DrawList, labels: LabelPlacer, axis: Vec3) {
    const d = this.m.dipole!;
    const ref = 'magneticField dipoleTilt';
    const cam = this.camera;
    const c0 = this.px([0, 0, 0]);
    // Notes go beyond the negative pole or the ends of the dipole, else anywhere round the body,
    // wherever is free.
    const around: Vec2[] = [];
    for (let i = 0; i < 8; i++)
      around.push([
        c0[0] + Math.cos((i * Math.PI) / 4) * 1.45 * this.k,
        c0[1] + Math.sin((i * Math.PI) / 4) * 1.45 * this.k,
      ]);
    const at = (pts: Vec2[], text: string, size: 's' | 'm' = 'm') =>
      pts.map((a) => ({
        x: a[0],
        y: a[1],
        text,
        size,
        ref,
        spots: spotsToward(a[0] - c0[0], a[1] - c0[1]),
      }));
    const anchors = [this.px(scale(axis, -1.32))];
    let first: Box | null = null;
    if (d.tilt === null || d.tilt === 0) {
      first = labels.placeAny(dl, at([this.px(scale(axis, -1.1)), ...anchors, ...around], d.label));
    } else {
      let k = sub(cam.toCam, scale(axis, dot(cam.toCam, axis)));
      if (Math.hypot(...k) < 1e-6) k = norm(cross(axis, [0, 0, 1]));
      k = norm(k);
      // Of the two senses, tilt away from the orbit normal so the dipole stays out of the
      // obliquity wedge.
      const tilt = d.tilt * DEG;
      const plus = mul(rotAxis(k, tilt), axis);
      const minus = mul(rotAxis(k, -tilt), axis);
      const sign = plus[2] <= minus[2] ? 1 : -1;
      const dir = sign > 0 ? plus : minus;
      const end = this.px(scale(dir, 1.4));
      dl.line(this.px(scale(dir, -1.4)), end, 'phantom', ref);
      const arc: Vec2[] = [];
      for (let i = 0; i <= 24; i++)
        arc.push(this.px(scale(mul(rotAxis(k, (sign * tilt * i) / 24), axis), 1.12)));
      pathDim(dl, arc, ref, 'both');
      labels.line(arc);
      labels.line([this.px(scale(dir, -1.4)), end]);
      labels.place(dl, {
        x: end[0],
        y: end[1],
        text: d.label,
        ref,
        spots: spotsToward(end[0] - c0[0], end[1] - c0[1]),
      });
      anchors.push(this.px(scale(dir, -1.4)), end);
    }
    if (d.note) {
      // Under (or over) the dipole's own note when there is one, so the two read as one.
      const stack = first
        ? [
            { x: (first.x0 + first.x1) / 2, y: first.y1, spots: ['b' as const] },
            { x: (first.x0 + first.x1) / 2, y: first.y0, spots: ['t' as const] },
          ].map((r) => ({ ...r, text: d.note!, size: 's' as const, ref, gap: 6 }))
        : [];
      labels.placeAny(dl, [...stack, ...at([...anchors, ...around], d.note, 's')]);
    }
  }
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
