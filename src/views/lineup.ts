// The line-up on the general arrangement: the ten bodies at one true scale, each at NASA's obliquity
// and spinning at the set's time scale, centred over its column of NASA's table. Axes are drawn to the
// positive pole with the same fixed length on every body, so all ten tilts read even where the body
// itself is a pixel across. One turntable camera turns all ten together.

import { circle, splitCurve } from '../draw/curves.ts';
import { arrowhead, niceLength, scaleBar, sub2, unit2 } from '../draw/dims.ts';
import { isoNumber, letter } from '../draw/lettering.ts';
import {
  behindAnnulus,
  facesCamera,
  graticule,
  hides,
  toWorld,
  type Spheroid,
} from '../draw/spheroid.ts';
import type { DrawList, Layer } from '../draw/svg.ts';
import {
  DEG,
  cross,
  matMul,
  mulT,
  norm,
  rotY,
  rotZ,
  scale,
  type Vec2,
  type Vec3,
} from '../draw/vec.ts';
import { BODY_HOME, HOURS_PER_SECOND, limbCurve, type BodyModel } from './body.ts';
import { View } from './view.ts';

export class LineupView extends View {
  readonly bodies: BodyModel[];
  /** Pixel x of each body's column centre (set by the page from its table layout). */
  columns: number[] = [];
  private t0 = performance.now();
  clock: (() => number) | null = null;
  paused = false;
  private pausedAt = 0;
  focus: string | null = null;
  /** Pixels per km, shared by all bodies. */
  pxPerKm = 0;

  constructor(svg: SVGSVGElement, bodies: BodyModel[]) {
    super(svg, BODY_HOME, { turntable: true });
    this.bodies = bodies;
    this.measure();
  }

  protected override animated() {
    return !this.paused;
  }

  setPaused(p: boolean) {
    if (p === this.paused) return;
    const now = performance.now();
    if (p) this.pausedAt = now;
    else this.t0 += now - this.pausedAt;
    this.paused = p;
    this.redraw();
  }

  setFocus(key: string | null) {
    this.focus = key;
    this.scene.setHot(key);
    this.redraw();
  }

  setColumns(xs: number[]) {
    this.columns = xs;
    this.measure();
  }

  protected extent() {
    return { radius: 1, fill: 1 };
  }

  override measure() {
    super.measure();
    // The widest body (with rings) sets the scale: it must fit its column.
    const colW =
      this.columns.length > 1
        ? Math.min(...this.columns.slice(1).map((x, i) => x - this.columns[i]!))
        : this.w / 10;
    const widest = Math.max(
      ...this.bodies.map(
        (b) =>
          2 *
          (b.rings ? Math.max(b.diameter / 2, ...b.rings.edges.map((e) => e.r)) : b.diameter / 2),
      ),
    );
    this.pxPerKm = Math.min(
      (colW * 0.94) / widest,
      (this.h * 0.62) / Math.max(...this.bodies.map((b) => b.diameter)),
    );
  }

  protected draw(dl: DrawList, now: number) {
    const cam = this.camera;
    const cy = this.h * 0.5;
    const ms = this.clock ? this.clock() : (this.paused ? this.pausedAt : now) - this.t0;
    const hours = (ms / 1000) * HOURS_PER_SECOND;
    const pen = 1.7; // wide pen, CSS px (approx.)
    const xs = this.bodies.map(
      (_, i) => this.columns[i] ?? (this.w * (i + 0.5)) / this.bodies.length,
    );

    // Centre line through all the bodies' centres, broken around each body.
    if (xs.length) {
      let from = xs[0]! - 40;
      this.bodies.forEach((m, i) => {
        const gap = Math.max(4, (m.diameter / 2) * this.pxPerKm + 3);
        dl.line([from, cy], [xs[i]! - gap, cy], 'center', '');
        from = xs[i]! + gap;
      });
      dl.line([from, cy], [xs[xs.length - 1]! + 40, cy], 'center', '');
    }

    this.bodies.forEach((m, i) => {
      const cx = xs[i]!;
      const R = m.diameter / 2;
      const r = R * this.pxPerKm; // px
      const eps = m.obliquity * DEG;
      const axis: Vec3 = [Math.sin(eps), 0, Math.cos(eps)];
      const spin = (2 * Math.PI * hours) / Math.abs(m.rotation);
      const s: Spheroid = {
        a: 1,
        c: m.polar / R,
        centre: [0, 0, 0],
        R: matMul(rotY(eps), rotZ(spin)),
      };
      const vb = mulT(s.R, cam.toCam);
      const P = (q: Vec3): Vec2 => {
        const p = cam.project(toWorld(s, q));
        return [cx + p[0] * r, cy - p[1] * r];
      };
      const Pw = (p: Vec3): Vec2 => {
        const q = cam.project(p);
        return [cx + q[0] * r, cy - q[1] * r];
      };
      const opaque = (m.rings?.opaque ?? []).map((g) => ({
        inner: g.inner / R,
        outer: g.outer / R,
      }));
      const vis = (q: Vec3) =>
        facesCamera(s, q, vb) && !(opaque.length && behindAnnulus(q, vb, opaque));

      if (r < 1.5) {
        // Too small to outline: a filled disc at the true radius (never under 0.75 px).
        dl.dot([cx, cy], Math.max(0.75, r), 'diameter');
      } else {
        if (r >= 9) {
          for (const g of graticule(s, 30 * DEG, 30 * DEG, 72)) {
            const runs = splitCurve({ ...g, at: g.body }, vis, null);
            for (const run of runs.visible)
              dl.polyline(
                run.map(P),
                g.kind === 'equator' ? 'center' : 'thin',
                g.kind === 'meridian' ? 'rotationPeriod' : '',
              );
          }
        }
        // The outline's outer edge sits on the true radius: stroke it half a pen inside.
        const inner = Math.max(0.5, (r - pen / 2) / r);
        const limb = splitCurve(
          limbCurve(s, vb),
          (q) => !(opaque.length && behindAnnulus(q, vb, opaque)),
          {
            period: 0.1,
            on: 0.075,
          },
        );
        const Pi = (q: Vec3): Vec2 => {
          const p = cam.project(toWorld(s, scale(q, inner)));
          return [cx + p[0] * r, cy - p[1] * r];
        };
        for (const run of limb.visible) dl.polyline(run.map(Pi), 'wide', 'diameter');
        for (const run of limb.hidden) dl.polyline(run.map(Pi), 'hidden', 'diameter');
      }

      // Rings.
      if (m.rings) {
        const e1 = norm(cross(axis, [0, 1, 0]));
        const e2 = norm(cross(axis, e1));
        for (const edge of m.rings.edges) {
          if (edge.line === 'phantom' && r < 20) continue;
          const c = circle([0, 0, 0], e1, e2, edge.r / R, 160);
          const runs = splitCurve(c, (p) => !hides(s, p, cam.toCam), { period: 0.12, on: 0.09 });
          const layer: Layer = edge.line;
          for (const run of runs.visible) dl.polyline(run.map(Pw), layer, 'ringSystem');
          for (const run of runs.hidden) dl.polyline(run.map(Pw), 'hidden', 'ringSystem');
        }
      }

      // Axis: same length on every body, to the positive pole, with an arrowhead there; broken
      // around bodies too small to show it crossing them.
      const L = Math.max(r * (s.c + 0.35), 24) / r;
      const top = Pw(scale(axis, L)),
        bot = Pw(scale(axis, -L));
      const dir = unit2(sub2(top, bot));
      if (r < 1.5) {
        const g = 3 + Math.max(0.75, r);
        dl.line(bot, [cx - dir[0] * g, cy - dir[1] * g], 'center', 'obliquity');
        dl.line([cx + dir[0] * g, cy + dir[1] * g], top, 'center', 'obliquity');
      } else dl.line(bot, top, 'center', 'obliquity');
      arrowhead(dl, top, dir, 'obliquity', { len: 6, half: 1.7 });
    });

    // Graphic scale for the line-up, lower left.
    const Lkm = niceLength((this.w * 0.09) / this.pxPerKm);
    const len = Lkm * this.pxPerKm;
    const x = 6,
      y = this.h - 10;
    scaleBar(dl, x, y, len, 2, '');
    letter(dl, '0', x, y - 6, { size: 's' });
    letter(dl, `${isoNumber(String(Lkm))} km`, x + len + 6, y + 4, { size: 's' });
  }
}
