// PLAN of the general arrangement: the orbits of the nine bodies that circle the Sun, at true scale,
// viewed from the north ecliptic pole, with each body's position at the epoch. Bodies are symbols, not
// to scale. The inner system is unreadable at this scale, so it is circled as detail A and drawn again,
// larger, in its own view (the same class with `detail`).

import { orbitPointAtTrueAnomaly, trueAnomalyAt, type MeanElements } from '../astro/index.ts';
import type { Orientation } from '../draw/camera.ts';
import { arrowhead, niceLength, scaleBar, sub2 } from '../draw/dims.ts';
import { LabelPlacer, spotsToward, type LabelReq } from '../draw/labels.ts';
import { isoNumber, letter } from '../draw/lettering.ts';
import type { DrawList } from '../draw/svg.ts';
import { DEG, type Vec2, type Vec3 } from '../draw/vec.ts';
import type { OrbitShape } from './keyplan.ts';
import { reducedMotion, View } from './view.ts';

export interface SystemBody {
  id: string;
  name: string;
  orbit: OrbitShape;
  j2000: MeanElements;
}

export interface SystemOpts {
  /** Draw only bodies whose aphelion is inside this radius (10⁶ km), at a larger scale. */
  detail?: number;
  /** On the main plan: radius (10⁶ km) of the detail circle to mark. */
  callout?: number;
}

const PLAN: Orientation = { yaw: 0, pitch: 90 * DEG };
/** Looking along +Y at the ecliptic edge-on: inclinations show (foreshortened by node direction). */
const ELEVATION: Orientation = { yaw: 0, pitch: 0 };

function drawn(o: OrbitShape): MeanElements {
  return {
    a: (o.q + o.Q) / 2,
    e: (o.Q - o.q) / (o.Q + o.q),
    i: o.i,
    node: o.node ?? 0,
    peri: o.peri ?? 0,
    L: 0,
    period: 1,
  };
}

export class SystemView extends View {
  readonly bodies: SystemBody[];
  readonly opts: SystemOpts;
  readonly epoch: Date;
  focus: string | null = null;

  constructor(svg: SVGSVGElement, bodies: SystemBody[], epoch: Date, opts: SystemOpts = {}) {
    super(svg, PLAN);
    this.bodies = opts.detail ? bodies.filter((b) => b.orbit.Q <= opts.detail!) : bodies;
    this.opts = opts;
    this.epoch = epoch;
    this.measure();
  }

  protected extent() {
    const R = this.opts.detail ?? Math.max(...this.bodies.map((b) => b.orbit.Q));
    return { radius: R * 1.06, fill: 0.94 };
  }

  setFocus(key: string | null) {
    const was = this.focus;
    this.focus = key;
    this.scene.setHot(key);
    const turn = (o: Orientation) =>
      reducedMotion() ? this.camera.set(o) : this.camera.animateTo(o, performance.now(), 900);
    if (key === 'orbitalInclination' && was !== key) turn(ELEVATION);
    if (was === 'orbitalInclination' && key !== was) turn(PLAN);
    this.redraw();
  }

  protected draw(dl: DrawList) {
    const sun = this.px([0, 0, 0]);
    const labels = new LabelPlacer({ x0: 4, y0: 4, x1: this.w - 4, y1: this.h - 4 });
    // Labels are placed last, once every drawn line is registered as an obstacle.
    const later: LabelReq[] = [];
    const plan = this.camera.pitch > 60 * DEG;
    const orbitRefs = 'distanceFromSun perihelion aphelion orbitalEccentricity orbitalInclination';

    // ♈ datum.
    if (plan) {
      const tip = this.px([this.extent().radius / 1.06, 0, 0]);
      dl.line(sun, tip, 'center', '');
      arrowhead(dl, tip, sub2(tip, sun));
      labels.line([sun, tip]);
      later.push({ x: tip[0], y: tip[1], text: '♈', spots: ['tl', 'bl', 't'], gap: 6 });
    } else {
      const R = this.extent().radius / 1.06;
      const a = this.px([-R, 0, 0]),
        e = this.px([R, 0, 0]);
      dl.line(a, e, 'phantom', 'orbitalInclination');
      labels.line([a, e]);
      later.push({
        x: e[0],
        y: e[1],
        text: 'ECLIPTIC',
        size: 's',
        ref: 'orbitalInclination',
        spots: ['tl', 'bl'],
      });
    }

    // Sun.
    const disc: Vec2[] = [];
    for (let k = 0; k <= 32; k++)
      disc.push([
        sun[0] + Math.cos((k / 32) * 2 * Math.PI) * 4,
        sun[1] + Math.sin((k / 32) * 2 * Math.PI) * 4,
      ]);
    dl.polyline(disc, 'wide', '');
    labels.block({ x0: sun[0] - 8, y0: sun[1] - 8, x1: sun[0] + 8, y1: sun[1] + 8 });

    for (const b of this.bodies) {
      const el = drawn(b.orbit);
      const pts: Vec2[] = [];
      for (let k = 0; k <= 360; k++) pts.push(this.px(orbitPointAtTrueAnomaly(el, k)));
      dl.polyline(pts, 'center', orbitRefs);
      labels.line(pts);
      const nu = trueAnomalyAt(b.j2000, this.epoch);
      const p: Vec3 = orbitPointAtTrueAnomaly(el, nu);
      const pp = this.px(p);
      dl.dot(pp, 3, 'orbitalPeriod orbitalVelocity');
      labels.block({ x0: pp[0] - 4, y0: pp[1] - 4, x1: pp[0] + 4, y1: pp[1] + 4 });
      // On the main plan the inner bodies are named in detail A instead.
      if (!this.opts.callout || b.orbit.Q > this.opts.callout)
        later.push({
          x: pp[0],
          y: pp[1],
          text: b.name.toUpperCase(),
          size: 's',
          spots: spotsToward(pp[0] - sun[0], pp[1] - sun[1]),
          gap: 6,
        });
    }

    // Detail circle A on the main plan: never smaller than legible, lettered by a short leader.
    if (this.opts.callout && plan) {
      const r = Math.max(14, this.opts.callout * this.k);
      const c: Vec2[] = [];
      for (let k = 0; k <= 72; k++)
        c.push([
          sun[0] + Math.cos((k / 72) * 2 * Math.PI) * r,
          sun[1] + Math.sin((k / 72) * 2 * Math.PI) * r,
        ]);
      dl.polyline(c, 'thin', '');
      const at: Vec2 = [sun[0] + Math.cos(-2.4) * r, sun[1] + Math.sin(-2.4) * r];
      const knee: Vec2 = [at[0] - 16, at[1] - 16];
      dl.polyline([at, knee], 'dim', '');
      later.push({ x: knee[0], y: knee[1], text: 'A', size: 'l', spots: ['tl', 'l', 't'], gap: 3 });
    }

    // Scale bar.
    if (plan) {
      const L = niceLength((this.w * 0.24) / this.k);
      const len = L * this.k;
      const x = 12,
        y = this.h - 16;
      scaleBar(dl, x, y, len, 2, '');
      labels.block({ x0: x - 2, y0: y - 16, x1: x + len + 90, y1: y + 9 });
      letter(dl, '0', x, y - 6, { size: 's', anchor: 'start' });
      letter(dl, `${isoNumber(String(L))} ×10⁶ km`, x + len + 6, y + 4, { size: 's' });
    }
    for (const r of later) labels.place(dl, r);
  }
}
