// KEY PLAN of a body sheet: the orbit, seen normal to its own plane (true shape), with the Sun at the
// focus. The ellipse is built from the main-table strings printed on it (perihelion and aphelion,
// 10⁶ km) and the main-table inclination; its orientation (Ω, ϖ) and the position at the epoch come
// from NASA's mean orbital elements (J2000) and Kepler's equation.
//
// By default the plan shows the orbit, Earth's orbit, the Sun, ♈ and the position on the date. The
// rest comes with its row: the apsides and their dimensions with the perihelion, aphelion, distance
// and eccentricity; the line of nodes with the inclination, which also turns the plan edge-on along
// it, where the angle between the orbit and the ecliptic is true size; equal-time ticks with the
// orbital period.

import { orbitPointAtTrueAnomaly, trueAnomalyAt, type MeanElements } from '../astro/index.ts';
import type { Orientation } from '../draw/camera.ts';
import {
  ARROW,
  arrowhead,
  centreMark,
  linearDim,
  niceLength,
  pathDim,
  scaleBar,
  segDist,
  segSegDist,
  sub2,
  unit2,
} from '../draw/dims.ts';
import {
  LabelPlacer,
  bbox,
  spotsToward,
  spreadAlong,
  textBox,
  type LabelReq,
  type Spot,
} from '../draw/labels.ts';
import { CAP, isoNumber, letter } from '../draw/lettering.ts';
import type { DrawList } from '../draw/svg.ts';
import { DEG, cross, dot, norm, scale, sub, type Vec2, type Vec3 } from '../draw/vec.ts';
import { View } from './view.ts';

export interface OrbitShape {
  /** Main-table perihelion and aphelion (10⁶ km), numbers and printed strings. */
  q: number;
  Q: number;
  qText: string;
  QText: string;
  /** Main-table semi-major axis ("Distance from Sun"), shown as a reference dimension. */
  aText: string;
  /** Main-table eccentricity and inclination strings. */
  eText: string;
  i: number;
  iText: string;
  /** J2000 orientation (deg) — absent when NASA gives none (the Moon). */
  node?: number;
  peri?: number;
}

export interface KeyPlanModel {
  name: string;
  orbit: OrbitShape;
  /** J2000 mean elements for the position at the epoch (absent for the Moon). */
  j2000?: MeanElements;
  /** Earth's orbit as a phantom reference (absent on Earth's and the Moon's sheets). */
  earth?: OrbitShape;
  /** "SUN" or "EARTH". */
  centre: string;
  apsides: [string, string];
}

/** Drawn elements as MeanElements in 10⁶ km, for the astro module's ellipse functions. */
function drawnElements(o: OrbitShape): MeanElements {
  const a = (o.q + o.Q) / 2;
  const e = (o.Q - o.q) / (o.Q + o.q);
  return { a, e, i: o.i, node: o.node ?? 0, peri: o.peri ?? 0, L: 0, period: 1 };
}

const TRUE_SHAPE: Orientation = { yaw: 0, pitch: 90 * DEG };

export class KeyPlanView extends View {
  readonly m: KeyPlanModel;
  readonly epoch: Date;
  focus: string | null = null;
  /** Rotation from the ecliptic frame into the plan frame (rows: X_w, Y_w, Z_w). */
  private W: [Vec3, Vec3, Vec3];

  constructor(svg: SVGSVGElement, m: KeyPlanModel, epoch: Date) {
    super(svg, TRUE_SHAPE);
    this.m = m;
    this.epoch = epoch;
    // Plan frame: Z along the orbit normal, X toward the vernal equinox projected into the orbit plane.
    const el = drawnElements(m.orbit);
    const h = orbitNormal(el);
    const x0: Vec3 = [1, 0, 0];
    let X = norm(sub(x0, scale(h, dot(x0, h))));
    if (!Number.isFinite(X[0])) X = [1, 0, 0];
    this.W = [X, cross(h, X), h];
    this.measure();
  }

  /** Ecliptic → plan frame. */
  private toPlan(p: Vec3): Vec3 {
    return [dot(p, this.W[0]), dot(p, this.W[1]), dot(p, this.W[2])];
  }

  protected extent() {
    const o = this.m.orbit;
    // Earth's orbit is shown whole when it is not much larger than this orbit (Mercury, Venus).
    const earth = this.m.earth && this.m.earth.Q <= o.Q * 2.5 ? this.m.earth.Q : 0;
    const reach = Math.max(o.Q, earth);
    return { radius: reach * 1.12, fill: 0.86 };
  }

  /** Light up a parameter's geometry and draw its details; `instant` turns without animating. */
  setFocus(key: string | null, { instant = false } = {}) {
    const was = this.focus;
    this.focus = key;
    this.scene.setHot(key);
    if (key === 'orbitalInclination' && was !== key) this.turn(this.edgeView(), { instant });
    if (was === 'orbitalInclination' && key !== was) this.turn(TRUE_SHAPE, { instant });
    this.redraw();
  }

  /** In the edge view the plan frame shows the orbit level; roll the picture so the ecliptic is level
   *  instead, blending in as the camera comes down from the true-shape view. */
  protected override roll(): number {
    const full = this.edgeRoll();
    if (!full) return 0;
    const t = 1 - Math.min(1, Math.max(0, this.camera.pitch / (90 * DEG)));
    return full * t;
  }

  private edgeRoll(): number {
    const o = this.m.orbit;
    if (!o.i) return 0;
    // At the edge view, the ecliptic direction perpendicular to the nodes projects at angle ±i.
    const O = (o.node ?? 0) * DEG;
    const nodeDir: Vec3 = [Math.cos(O), Math.sin(O), 0];
    const inEcl = this.toPlan(norm(cross([0, 0, 1], nodeDir)));
    const e = this.edgeView();
    const cy = Math.cos(e.yaw),
      sy = Math.sin(e.yaw);
    const right: Vec3 = [cy, sy, 0];
    const x = dot(inEcl, right),
      y = inEcl[2];
    return -Math.atan2(y, x);
  }

  /** Looking along the line of nodes, from the ascending-node side. */
  private edgeView(): Orientation {
    const O = (this.m.orbit.node ?? 0) * DEG;
    const n = this.toPlan([Math.cos(O), Math.sin(O), 0]);
    // toCam = (sin y cos p, −cos y cos p, sin p) = n with p = 0.
    return { yaw: Math.atan2(n[0], -n[1]), pitch: 0 };
  }

  protected draw(dl: DrawList) {
    const m = this.m;
    const el = drawnElements(m.orbit);
    const P = (p: Vec3) => this.px(this.toPlan(p));
    const sun = P([0, 0, 0]);
    const labels = new LabelPlacer({ x0: 4, y0: 4, x1: this.w - 4, y1: this.h - 4 });
    // Labels are placed last, once every drawn line and mark is registered as an obstacle. Labels
    // mind the apsides and the dimension lines twice as much as other lines, and Earth's orbit, a
    // mere reference, a quarter as much.
    const later: (LabelReq | LabelReq[])[] = [];
    const edge = this.focus === 'orbitalInclination' || this.camera.pitch < 60 * DEG;
    /** Keep labels off an arrowhead with its tip at `tip`, pointing along `dir`; no mask hides it. */
    const arrowOff = (tip: Vec2, dir: Vec2) => {
      const d = unit2(dir);
      const base: Vec2 = [tip[0] - d[0] * ARROW.len, tip[1] - d[1] * ARROW.len];
      labels.line([base, tip], ARROW.half + 1.5, 3, 2);
      const h = ARROW.half;
      labels.obstacles.push({
        x0: Math.min(base[0], tip[0]) - h,
        y0: Math.min(base[1], tip[1]) - h,
        x1: Math.max(base[0], tip[0]) + h,
        y1: Math.max(base[1], tip[1]) + h,
        w: 2,
        hard: true,
      });
    };
    /** Keep labels off a dot or a small mark; no mask hides it. */
    const markOff = (c: Vec2, r: number, w = 1) =>
      labels.obstacles.push({
        x0: c[0] - r,
        y0: c[1] - r,
        x1: c[0] + r,
        y1: c[1] + r,
        w,
        hard: true,
      });

    // Position at the epoch on the drawn ellipse, and the direction of motion. They come first, so
    // that no value lettered before the date keeps its mask over them.
    let date: LabelReq | null = null;
    let pos: { pp: Vec2; tip: Vec2 } | null = null;
    if (m.j2000) {
      const nu = trueAnomalyAt(m.j2000, this.epoch);
      const p = orbitPointAtTrueAnomaly(el, nu);
      const ahead = orbitPointAtTrueAnomaly(el, nu + 2);
      const pp = P(p);
      const tangent = unit2(sub2(P(ahead), pp));
      const tip: Vec2 = [pp[0] + tangent[0] * 26, pp[1] + tangent[1] * 26];
      dl.dot(pp, 3.4, 'orbitalVelocity');
      dl.line(pp, tip, 'dim', 'orbitalVelocity');
      arrowhead(dl, tip, tangent, 'orbitalVelocity');
      // Labels mind the position and its arrow most: they are what the date is about.
      labels.line([pp, tip], 2.5, 6, 2);
      arrowOff(tip, tangent);
      markOff(pp, 4, 4);
      pos = { pp, tip };
      date = {
        x: pp[0],
        y: pp[1],
        text: this.epoch.toISOString().slice(0, 10),
        size: 's',
        ref: 'orbitalVelocity',
        // Edge-on, the labels above the line are taken by the Sun, ♈ and the angle. Where the lines
        // and labels crowd the dot, the date may stand further off, on a leader.
        spots: edge
          ? ['bl', 'br', 'b', 'tl', 'tr', 't', 'l', 'r']
          : spotsToward(pp[0] - sun[0], pp[1] - sun[1]),
        gap: 7,
        reach: [2, 3, 4, 5],
        mask: true,
      };

      // Equal-time ticks (1/24 of the sidereal period each), on demand: Kepler's second law.
      if (this.focus === 'orbitalPeriod') {
        for (let k = 0; k < 24; k++) {
          const when = new Date(this.epoch.getTime() + ((k * m.j2000.period) / 24) * 86_400_000);
          const t = orbitPointAtTrueAnomaly(el, trueAnomalyAt(m.j2000, when));
          const tt = orbitPointAtTrueAnomaly(el, trueAnomalyAt(m.j2000, when) + 1);
          const a = P(t),
            dir = unit2(sub2(P(tt), a));
          const nn: Vec2 = [-dir[1] * 5, dir[0] * 5];
          const ends: [Vec2, Vec2] = [
            [a[0] - nn[0], a[1] - nn[1]],
            [a[0] + nn[0], a[1] + nn[1]],
          ];
          dl.line(ends[0], ends[1], 'dim', 'orbitalPeriod');
          labels.line(ends, 1.5, 3);
        }
      }
    }

    // Reference: Earth's orbit (phantom; no row of its own, so not a target) and the ecliptic datum ♈
    // from the Sun.
    let rEarth = 0;
    if (m.earth) {
      const eel = drawnElements(m.earth);
      const pts: Vec2[] = [];
      for (let k = 0; k <= 240; k++) pts.push(P(orbitPointAtTrueAnomaly(eel, k * 1.5)));
      dl.polyline(pts, 'phantom');
      labels.line(pts, 2.5, 6, 0.25);
      for (const q of pts) rEarth = Math.max(rEarth, Math.hypot(q[0] - sun[0], q[1] - sun[1]));
    }
    if (m.orbit.node !== undefined) {
      // Beyond the orbit; further out where its arrowhead would meet the position or its arrow, as
      // far as leaves room for ♈ in the drawing.
      const far = P([el.a * (1 + el.e) * 1.08, 0, 0]);
      const d = unit2(sub2(far, sun));
      const clear = (t: Vec2) => {
        if (!pos) return true;
        const base: Vec2 = [t[0] - d[0] * ARROW.len, t[1] - d[1] * ARROW.len];
        return (
          segDist(pos.pp, base, t) > 3.4 + ARROW.half + 1.5 &&
          segSegDist(base, t, pos.pp, pos.tip) > 2 * ARROW.half + 1
        );
      };
      let tip = far;
      for (let k = 1; !clear(tip); k++) {
        const t: Vec2 = [far[0] + d[0] * k, far[1] + d[1] * k];
        if (t[0] < 10 || t[1] < 10 || t[0] > this.w - 10 || t[1] > this.h - 10) {
          tip = far;
          break;
        }
        tip = t;
      }
      dl.line(sun, tip, 'center', '');
      arrowhead(dl, tip, d);
      labels.line([sun, tip]);
      arrowOff(tip, d);
      // Beyond the arrowhead, whichever way it points, else beside it; edge-on, where the arrow lies
      // along the orbit, anywhere round it.
      const beyond = spotsToward(d[0], d[1]);
      later.push({
        x: tip[0],
        y: tip[1],
        text: '♈',
        spots: edge ? beyond : beyond.slice(0, 5),
        gap: 5,
        mask: true,
      });
    }

    // The orbit: a path of motion (long-dash dot), north of the ecliptic and south of it alike.
    const N = 360;
    const pts: Vec2[] = [];
    for (let k = 0; k <= N; k++) pts.push(P(orbitPointAtTrueAnomaly(el, (k / N) * 360)));
    dl.polyline(pts, 'center', 'orbitalEccentricity distanceFromSun');
    labels.line(pts);
    const orbitBox = bbox(pts, 0);

    // The centre body at the focus, drawn as matter (wide). Labels keep off the disc itself, which is
    // round, so that SUN's corner spots stay open.
    const rs = 5;
    const disc: Vec2[] = [];
    for (let k = 0; k <= 40; k++)
      disc.push([
        sun[0] + Math.cos((k / 40) * 2 * Math.PI) * rs,
        sun[1] + Math.sin((k / 40) * 2 * Math.PI) * rs,
      ]);
    dl.polyline(disc, 'wide', '');
    dl.dot(sun, 1.2);
    labels.line(disc, 2, 3, 4);
    markOff(sun, 3, 4);
    const sunReq = (gap: number): LabelReq => ({
      x: sun[0],
      y: sun[1],
      text: m.centre,
      size: 's',
      spots: ['tl', 'bl', 'tr', 'br', 't', 'b', 'l', 'r'],
      gap,
      mask: true,
    });
    // Where Earth's orbit rings the Sun closely (Jupiter outwards), SUN may also stand outside it.
    later.push(rEarth > rs + 4 && rEarth < 40 ? [sunReq(9), sunReq(rEarth + 4)] : sunReq(9));

    // Apsides, with the rows that measure along them: the line through the focus, then each row's
    // own points and dimensions. q, Q and (a) take the roomier side of the line.
    const f = this.focus;
    const peri = orbitPointAtTrueAnomaly(el, 0);
    const apo = orbitPointAtTrueAnomaly(el, 180);
    const pPx = P(peri),
      aPx = P(apo);
    const cPx = P(scale(sub(peri, apo), 0).map((_, i) => (peri[i]! + apo[i]!) / 2) as Vec3);
    const along =
      f === 'perihelion' ||
      f === 'aphelion' ||
      f === 'distanceFromSun' ||
      f === 'orbitalEccentricity';
    if (along && !edge) {
      dl.line(aPx, pPx, 'center', 'perihelion aphelion');
      labels.line([aPx, pPx], 2.5, 6, 2);
      const dir = unit2(sub2(pPx, aPx));
      const n: Vec2 = [-dir[1], dir[0]];
      const midBox: Vec2 = [(orbitBox.x0 + orbitBox.x1) / 2, (orbitBox.y0 + orbitBox.y1) / 2];
      const side = (midBox[0] - cPx[0]) * n[0] + (midBox[1] - cPx[1]) * n[1] > 0 ? -1 : 1;
      const sh = (p: Vec2, d: number): Vec2 => [p[0] + n[0] * d, p[1] + n[1] * d];
      /**
       * A dimension from p to q, 16 px off the apsides on the roomier side (or on the other, where
       * only that one leaves its value clear, or a fit place: see LabelPlacer.along()), its value
       * along it where nothing crosses it: between the arrowheads, or beyond them on an extension of
       * the line when the dimension is short.
       */
      const dim = (p: Vec2, q: Vec2, text: string, ref: string) => {
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const d = unit2(sub2(q, p));
        const w = textBox(text, 's').w;
        // linearDim() puts the arrowheads outside, on a longer line, when they do not fit inside.
        const out = len > 2 * ARROW.len + 4 ? 0 : ARROW.len + 8;
        const beyond = out + 4 + w / 2;
        const ends = [1 + beyond / len, -beyond / len];
        // Between the arrowheads where it fits there and has a fit place, else beyond them.
        const tries =
          w + 2 * ARROW.len + 8 <= len
            ? [spreadAlong(p, q, text, ARROW.len + 3, 's'), ends]
            : [ends];
        /** Extension lines and arrowheads at one offset, as obstacles; the dimension line's ends. */
        const register = (off: number): [Vec2, Vec2] => {
          const a = sh(p, off),
            b = sh(q, off);
          const s = Math.sign(off);
          labels.line([p, sh(p, off + 4 * s)]);
          labels.line([q, sh(q, off + 4 * s)]);
          const back: Vec2 = [-d[0], -d[1]];
          arrowOff(a, out ? d : back);
          arrowOff(b, out ? back : d);
          return [a, b];
        };
        let best: { off: number; at: number[]; cost: number; bad: boolean } | null = null;
        for (const at of tries) {
          for (const off of [16 * side, -16 * side]) {
            const before = labels.mark();
            const [a, b] = register(off);
            const { cost, bad } = labels.along(a, b, text, { size: 's', at });
            labels.drop(before);
            if (!best || (best.bad && !bad) || (best.bad === bad && cost < best.cost - 1e-6))
              best = { off, at, cost, bad };
            if (cost === 0) break;
          }
          if (!best!.bad) break;
        }
        const { off, at } = best!;
        linearDim(dl, p, q, off, ref);
        const [a, b] = register(off);
        const v = labels.placeAlong(dl, a, b, text, { ref, size: 's', at });
        // A value beyond the arrowheads stands on an extension of the dimension line.
        let [e0, e1]: [Vec2, Vec2] = [
          [a[0] - d[0] * out, a[1] - d[1] * out],
          [b[0] + d[0] * out, b[1] + d[1] * out],
        ];
        if (at === ends) {
          const vc: Vec2 = [(v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2];
          const t = (vc[0] - a[0]) * d[0] + (vc[1] - a[1]) * d[1];
          const reach = w / 2 + 2;
          if (t > len) {
            e1 = [a[0] + d[0] * (t + reach), a[1] + d[1] * (t + reach)];
            dl.line(b, e1, 'dim', ref);
          } else {
            e0 = [a[0] + d[0] * (t - reach), a[1] + d[1] * (t - reach)];
            dl.line(e0, a, 'dim', ref);
          }
        }
        labels.line([e0, e1], 2.5, 6, 2);
      };
      /** An apsis: its point, and its name beyond it, away from the Sun. */
      const apsis = (at: Vec2, ref: string, name?: string) => {
        dl.dot(at, 2.2, ref);
        markOff(at, 3);
        if (name)
          later.push({
            x: at[0],
            y: at[1],
            text: name,
            size: 's',
            ref,
            spots: spotsToward(at[0] - sun[0], at[1] - sun[1]),
            reach: [2, 3, 4, 5],
            mask: true,
          });
      };
      if (f === 'perihelion') {
        apsis(pPx, 'perihelion', m.apsides[0]);
        dim(sun, pPx, isoNumber(m.orbit.qText), 'perihelion');
      } else if (f === 'aphelion') {
        apsis(aPx, 'aphelion', m.apsides[1]);
        dim(aPx, sun, isoNumber(m.orbit.QText), 'aphelion');
      } else if (f === 'distanceFromSun') {
        dim(cPx, pPx, `(${isoNumber(m.orbit.aText)})`, 'distanceFromSun');
      } else {
        apsis(pPx, 'perihelion');
        apsis(aPx, 'aphelion');
        // The centre of the ellipse, marked unless it is all but on the Sun (Mercury, Venus).
        const onSun = Math.hypot(cPx[0] - sun[0], cPx[1] - sun[1]) < rs + 6;
        if (!onSun) {
          centreMark(dl, cPx, 4, 'orbitalEccentricity');
          labels.line(
            [
              [cPx[0] - 4, cPx[1]],
              [cPx[0] + 4, cPx[1]],
            ],
            1.5,
            3,
            2,
          );
          labels.line(
            [
              [cPx[0], cPx[1] - 4],
              [cPx[0], cPx[1] + 4],
            ],
            1.5,
            3,
            2,
          );
        }
        const e = {
          text: `e ${m.orbit.eText}`,
          size: 's' as const,
          ref: 'orbitalEccentricity',
          spots: spotsToward(-n[0] * side, -n[1] * side),
          mask: true,
        };
        // At the centre mark, on a leader if it must stand off; where the centre is all but on the
        // Sun, round the Sun as SUN is, a little further out.
        later.push(
          onSun
            ? [12, 22, 32, 44].map((gap) => ({ ...e, x: sun[0], y: sun[1], gap }))
            : { ...e, x: cPx[0], y: cPx[1], gap: 8, reach: [2, 3] },
        );
      }
    }

    // With the inclination: the line of nodes through the focus and the ascending node, named while
    // the plan still looks down on it (it turns edge-on along this line).
    if (
      f === 'orbitalInclination' &&
      m.orbit.node !== undefined &&
      m.orbit.peri !== undefined &&
      m.orbit.i > 0
    ) {
      const nu = m.orbit.node - m.orbit.peri; // ω + ν = 0 at the ascending node
      const asc = P(orbitPointAtTrueAnomaly(el, nu));
      const desc = P(orbitPointAtTrueAnomaly(el, nu + 180));
      dl.line(desc, asc, 'phantom', 'orbitalInclination');
      labels.line([desc, asc]);
      dl.dot(asc, 2, 'orbitalInclination');
      markOff(asc, 3);
      if (this.camera.pitch >= 60 * DEG)
        later.push({
          x: asc[0],
          y: asc[1],
          text: '☊',
          ref: 'orbitalInclination',
          spots: spotsToward(asc[0] - sun[0], asc[1] - sun[1]),
          mask: true,
        });
    }

    // Inclination: the angle at the focus between the ecliptic and the orbit plane, about the nodes.
    if (edge && m.orbit.i === 0) {
      // Under the Sun or over it, else further off.
      later.push(
        [14, 26].map((gap) => ({
          x: sun[0],
          y: sun[1],
          text: `ORBIT PLANE = ECLIPTIC: ${m.orbit.iText}°`,
          size: 's' as const,
          ref: 'orbitalInclination',
          spots: ['b', 't', 'bl', 'tl', 'br', 'tr'] as Spot[],
          gap,
          mask: true,
        })),
      );
    } else if (edge) {
      const O = (m.orbit.node ?? 0) * DEG;
      const nodeDir: Vec3 = [Math.cos(O), Math.sin(O), 0];
      const inEcl = norm(cross([0, 0, 1], nodeDir));
      const h = orbitNormal(el);
      const inOrb = norm(cross(h, nodeDir));
      const r = el.a * 0.92;
      const ecl: [Vec2, Vec2] = [P(scale(inEcl, -r * 1.25)), P(scale(inEcl, r * 1.25))];
      dl.line(ecl[0], ecl[1], 'phantom', 'orbitalInclination');
      labels.line(ecl);
      const arc: Vec2[] = [];
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(inEcl, inOrb))));
      // Unit vector in the plane of the angle, perpendicular to the ecliptic direction, toward the orbit.
      const w = norm(sub(inOrb, scale(inEcl, dot(inOrb, inEcl))));
      for (let k = 0; k <= 30; k++) {
        const t = (ang * k) / 30;
        arc.push(
          P(
            scale(
              [
                inEcl[0] * Math.cos(t) + w[0] * Math.sin(t),
                inEcl[1] * Math.cos(t) + w[1] * Math.sin(t),
                inEcl[2] * Math.cos(t) + w[2] * Math.sin(t),
              ],
              r,
            ),
          ),
        );
      }
      if (ang * r * this.k > 16) {
        pathDim(dl, arc, 'orbitalInclination');
        labels.line(arc);
      }
      const tip = arc[arc.length - 1]!;
      later.push({
        x: tip[0],
        y: tip[1],
        text: `${m.orbit.iText}°`,
        ref: 'orbitalInclination',
        spots: ['r', 'tr', 'br', 't', 'b'],
        mask: true,
      });
      // At whichever end of the ecliptic line is free, under it, over it or beyond it.
      later.push(
        ([1, -1] as const).map((end) => ({
          x: ecl[end > 0 ? 1 : 0][0],
          y: ecl[end > 0 ? 1 : 0][1],
          text: 'ECLIPTIC',
          size: 's' as const,
          ref: 'orbitalInclination',
          spots: [
            'b',
            end > 0 ? 'br' : 'bl',
            end > 0 ? 'bl' : 'br',
            't',
            end > 0 ? 'r' : 'l',
          ] as Spot[],
          reach: [2, 3],
          mask: true,
        })),
      );
    }

    // Scale bar, bottom left, in 10⁶ km.
    if (!edge) {
      const target = (this.w * 0.22) / this.k;
      const L = niceLength(target);
      const len = L * this.k;
      const x = 12,
        y = this.h - 16;
      scaleBar(dl, x, y, len, 2, '');
      labels.block({ x0: x - 2, y0: y - 16, x1: x + len + 90, y1: y + 9 });
      // The scale's lettering interrupts any line under it (an orbit, a period tick).
      const text = `${isoNumber(String(L))} ×10⁶ km`;
      const tw = textBox(text, 's').w;
      const cap = CAP.s;
      labels.mask(dl, { x0: x + len + 4, y0: y + 2 - cap, x1: x + len + 8 + tw, y1: y + 7 });
      letter(dl, '0', x, y - 6, { size: 's', anchor: 'start' });
      letter(dl, text, x + len + 6, y + 4, { size: 's' });
    }

    // The date first: the longest label. It keeps off the places the others may take where it can,
    // for they have fewer (SUN and ♈ have nowhere else to go), and may stand further off itself.
    if (date) {
      const before = labels.mark();
      for (const r of later.flat())
        for (const k of [1, ...(r.reach ?? [])])
          for (const spot of r.spots!)
            labels.obstacles.push({ ...labels.boxFor(r, spot, k), w: 0.5, soft: true });
      const after = labels.mark();
      labels.place(dl, date);
      labels.drop(before, after);
    }
    for (const r of later) labels.placeAny(dl, Array.isArray(r) ? r : [r]);
  }
}

/** Unit normal of an orbit plane from its inclination and node (ecliptic frame). */
function orbitNormal(el: MeanElements): Vec3 {
  const i = el.i * DEG,
    O = el.node * DEG;
  return [Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)];
}
