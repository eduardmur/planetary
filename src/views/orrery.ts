// The home page's drawing: a schematic of the solar system, seen from 30–60° above the ecliptic (the
// angle that best fills the window) with ♈ to the right. The nine bodies that circle the Sun move on
// their orbits from today's positions at 1 minute = 1 year. Not to scale: distances from the Sun are
// compressed and the bodies are symbols whose size grows with NASA's diameter but not in proportion
// to it; directions, inclinations and the poles of rotation are true.
//
// The orbits and the symbols are drawn when the size changes. A frame only moves each symbol's group
// and the link over it (the links are the pointer targets, split where they overlap), re-sorts the
// groups by depth, and letters the name of the body pointed at.

import {
  dateFromJulian,
  julianDate,
  orbitPointAtTrueAnomaly,
  trueAnomalyAt,
  type MeanElements,
} from '../astro/index.ts';
import type { OrreryBody, OrreryModel } from '../data/orrery.ts';
import { LabelPlacer, spotsToward, type Box, type LabelReq, type Spot } from '../draw/labels.ts';
import { DrawList, SvgScene } from '../draw/svg.ts';
import { DEG, clamp, len, scale, type Vec2, type Vec3 } from '../draw/vec.ts';
import { drawGlyph } from './glyph.ts';
import type { OrbitShape } from './keyplan.ts';
import { reducedMotion, View } from './view.ts';

/** A point r from the Sun is drawn at R·(r / qMax)^RADIAL_POWER: the outer orbits close in. */
export const RADIAL_POWER = 0.4;
/** The smallest symbol, px across. */
export const MIN_SYMBOL = 6;

/** Distance from the Sun (px) at which a point r (10⁶ km) away is drawn, when qMax is drawn at R. */
export function schematicRadius(r: number, R: number, qMax: number): number {
  return R * Math.pow(r / qMax, RADIAL_POWER);
}

/** Symbol diameter (px): grows as √(NASA's diameter) up to R/15 for the largest, never under 6 px. */
export function symbolDiameter(diameter: number, R: number, dMax: number): number {
  return Math.max(MIN_SYMBOL, (R / 15) * Math.sqrt(diameter / dMax));
}

/** 1 minute = 1 year (365.25 d): days of the drawing's clock per second. */
const DAYS_PER_SECOND = 365.25 / 60;
/** The clock goes back to its start when it reaches 2060, the end of the positions' stated accuracy. */
const UNTIL = julianDate(new Date(Date.UTC(2060, 0, 1)));
/** Pointing at a body stops the clock at once, so the body stays under a still pointer; letting go
 *  starts it over START ms. */
const START = 500;
/** The bodies fade out and back in over FADE ms when the clock goes back. */
const FADE = 300;
/** Wide pen, CSS px (approx.). */
const PEN = 1.7;
/** Half the side of the square a pressing fingertip covers round its contact point, px. */
const FINGER = 28;
/** The Moon's link reaches this far outside its ring, px. */
const MOON_LINK = 10;

const NS = 'http://www.w3.org/2000/svg';
const S = Math.SQRT1_2;
/** Unit directions of the label spots, screen y down. */
const DIRS: Record<Spot, Vec2> = {
  r: [1, 0],
  l: [-1, 0],
  t: [0, -1],
  b: [0, 1],
  tr: [S, -S],
  tl: [-S, -S],
  br: [S, S],
  bl: [-S, S],
};

/** The orbit as drawn: main-table q, Q and inclination, J2000 node and perihelion (as on the key
 *  plans). */
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

function group(cls: string): SVGGElement {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', cls);
  return g;
}

interface Planet {
  m: OrreryBody;
  orbit: MeanElements;
  g: SVGGElement;
  scene: SvgScene;
  link: HTMLAnchorElement | undefined;
  /** Symbol radius, and the box of everything drawn in its group about its centre, px. */
  r: number;
  box: Box;
  /** Position now, px, and depth toward the camera. */
  at: Vec2;
  depth: number;
  /** The orbit as drawn, px. */
  path: Vec2[];
  /** Radius of the link over it, whole px, and the clip-path last written to it. */
  reach: number;
  clip: string;
}

/** A body's link: its centre, its symbol's radius and the radius of the link's circle, px. */
export interface LinkDisc {
  at: Vec2;
  r: number;
  reach: number;
}

/**
 * The part of a link's circle that its body keeps where the circle overlaps others, as a polygon
 * about the centre (px), or null when it overlaps none. Two circles are cut at the power line of the
 * two symbols, |x − c|² − r² equal for both: it runs through the points where their outlines cross,
 * or between them when they do not, so each body keeps every point of its symbol that the other's
 * does not cover, and two links never overlap.
 */
export function linkRegion(p: LinkDisc, others: readonly LinkDisc[]): Vec2[] | null {
  let poly: Vec2[] | null = null;
  for (const o of others) {
    const dx = o.at[0] - p.at[0],
      dy = o.at[1] - p.at[1];
    const d = Math.hypot(dx, dy);
    if (d >= p.reach + o.reach || d < 1e-6) continue;
    // Distance of the power line from p's centre, toward o.
    const s = (d * d + p.r * p.r - o.r * o.r) / (2 * d);
    if (s >= p.reach) continue;
    poly ??= Array.from({ length: 40 }, (_, k): Vec2 => {
      const t = (k / 40) * 2 * Math.PI;
      return [p.reach * Math.cos(t), p.reach * Math.sin(t)];
    });
    poly = clipHalf(poly, [dx / d, dy / d], s);
  }
  return poly;
}

/** The part of a convex polygon where n·x ≤ c (one step of Sutherland–Hodgman). */
function clipHalf(poly: readonly Vec2[], n: Vec2, c: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    const da = n[0] * a[0] + n[1] * a[1] - c,
      db = n[0] * b[0] + n[1] * b[1] - c;
    if (da <= 0) out.push(a);
    if (da * db < 0) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

export interface OrreryOpts {
  /** Where the date is shown. */
  clock?: HTMLElement | null;
  /** Keep the clock at its start (captures). */
  still?: boolean;
}

export class OrreryView extends View {
  readonly model: OrreryModel;
  readonly links: Map<string, HTMLAnchorElement>;
  private readonly start: number;
  private readonly still: boolean;
  private readonly clock: HTMLElement | null;
  private readonly orbits: SvgScene;
  private readonly glyphs: SVGGElement;
  private readonly planets: Planet[];
  private order: Planet[] = [];
  /** Radius (px) of the outermost aphelion, and of the Moon's ring. */
  private R = 1;
  private rho = 0;
  private resized = true;
  /** The clock, as a Julian date, and its speed: 1 runs, 0 stands. */
  private jd: number;
  private speed = 1;
  private paused = false;
  private last = 0;
  /** When the clock goes back to its start, mid-fade (ms), or null. */
  private wrapAt: number | null = null;
  private day = Number.NaN;
  /** Bodies drawn in yellow, and the one whose name is lettered. */
  private lit = new Set<string>();
  private pointed: string | null = null;
  /** Where a finger presses the body pointed at, px in the drawing, or null (mouse, keyboard). */
  private touchAt: Vec2 | null = null;

  constructor(
    svg: SVGSVGElement,
    model: OrreryModel,
    links: Map<string, HTMLAnchorElement>,
    epoch: Date,
    opts: OrreryOpts = {},
  ) {
    super(svg, { yaw: 0, pitch: 35 * DEG });
    this.model = model;
    this.links = links;
    this.start = this.jd = julianDate(epoch);
    this.still = !!opts.still;
    this.clock = opts.clock ?? null;
    // Paint order: the orbits and the Sun, the bodies far to near, then this.scene: the name.
    const orbits = group('orbits');
    this.glyphs = group('glyphs');
    svg.prepend(orbits, this.glyphs);
    this.orbits = new SvgScene(orbits, { hit: false });
    this.planets = model.bodies.map((m) => {
      const g = group('body');
      g.dataset.body = m.id;
      this.glyphs.append(g);
      return {
        m,
        orbit: drawn(m.orbit),
        g,
        scene: new SvgScene(g, { hit: false }),
        link: links.get(m.id),
        r: 0,
        box: { x0: 0, y0: 0, x1: 0, y1: 0 },
        at: [0, 0],
        depth: 0,
        path: [],
        reach: 0,
        clip: '',
      };
    });
    this.measure();
    // The first frame at once, so the page never shows an empty drawing or links out of place.
    this.layout();
    this.place();
  }

  protected extent() {
    return { radius: 1, fill: 1 };
  }

  /** A heliocentric point (10⁶ km) moved along its ray from the Sun to its schematic distance. */
  private schematic(p: Vec3, R: number): Vec3 {
    const r = len(p);
    return r > 0 ? scale(p, schematicRadius(r, R, this.model.qMax) / r) : p;
  }

  private planet(id: string): Planet | undefined {
    return this.planets.find((p) => p.m.id === id);
  }

  /**
   * Fit the nine orbits into the view: look down at the angle whose sine is the view's aspect ratio
   * (30° to 60°), then scale the orbits' box to fill the view and centre it.
   */
  override measure() {
    super.measure();
    const pitch = clamp(Math.asin(Math.min(1, this.h / this.w)), 30 * DEG, 60 * DEG);
    this.camera.set({ yaw: 0, pitch });
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of this.planets)
      for (let k = 0; k < 360; k++) {
        const [x, y] = this.camera.project(this.schematic(orbitPointAtTrueAnomaly(p.orbit, k), 1));
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    const R = Math.min(this.w / (x1 - x0), this.h / (y1 - y0));
    this.R = R;
    this.k = 1;
    this.ox = (this.w - (x1 - x0) * R) / 2 - x0 * R;
    this.oy = (this.h - (y1 - y0) * R) / 2 + y1 * R;
    for (const p of this.planets) p.r = symbolDiameter(p.m.diameter, R, this.model.dMax) / 2;
    this.rho = 2 * (this.planet('earth')?.r ?? 0) + 6;
    // The Moon's link is the ring's ellipse, MOON_LINK px wider all round, under the Earth's.
    const moon = this.links.get('moon');
    if (moon) {
      moon.style.width = `${2 * (this.rho + MOON_LINK)}px`;
      moon.style.height = `${2 * (this.rho + MOON_LINK) * Math.sin(pitch)}px`;
    }
    this.resized = true;
  }

  /** Pixel position of a heliocentric point (10⁶ km). */
  private at(p: Vec3): Vec2 {
    return this.px(this.schematic(p, this.R));
  }

  /** The orbits and the Sun. */
  protected draw(dl: DrawList) {
    for (const p of this.planets) {
      const pts: Vec2[] = [];
      for (let k = 0; k <= 360; k++) pts.push(this.at(orbitPointAtTrueAnomaly(p.orbit, k)));
      p.path = pts;
      dl.polyline(pts, 'center', p.m.id);
    }
    // ☉: a wide circle, its outer edge on the radius, and a centre dot.
    const sun = this.px([0, 0, 0]);
    const r = Math.max(10, this.R / 48) / 2 - PEN / 2;
    const ring: Vec2[] = [];
    for (let k = 0; k < 48; k++) {
      const t = (k / 48) * 2 * Math.PI;
      ring.push([sun[0] + Math.cos(t) * r, sun[1] + Math.sin(t) * r]);
    }
    dl.polyline(ring, 'wide', '', true);
    dl.dot(sun, 1.2);
  }

  /** Everything that only changes with the size: the orbits, the Sun and the symbols. */
  private layout() {
    this.resized = false;
    const dl = new DrawList();
    this.draw(dl);
    this.orbits.commit(dl);
    for (const p of this.planets) {
      const g = new DrawList();
      p.box = drawGlyph(g, p.m, this.camera, p.r, p.m.id);
      if (p.m.id === 'earth') {
        this.moonRing(g);
        p.box = union(p.box, this.moonBox());
      }
      p.scene.commit(g);
    }
    this.paint();
  }

  /**
   * The Moon's orbit round the Earth, enlarged, in the ecliptic plane. NASA gives no node or perigee
   * longitude for the Moon, so it is a circle with no position on it.
   */
  private moonRing(dl: DrawList) {
    const pts: Vec2[] = [];
    for (let k = 0; k <= 72; k++) {
      const t = (k / 72) * 2 * Math.PI;
      const q = this.camera.project([Math.cos(t) * this.rho, Math.sin(t) * this.rho, 0]);
      pts.push([q[0], -q[1]]);
    }
    dl.polyline(pts, 'thin', 'moon');
  }

  /** The Moon's ring seen from above the ecliptic: an ellipse ρ by ρ·sin(pitch) about the Earth. */
  private moonBox(): Box {
    const h = this.rho * Math.sin(this.camera.pitch);
    return { x0: -this.rho, y0: -h, x1: this.rho, y1: h };
  }

  /** The clock runs while nothing holds it; captures keep it still. */
  private get target() {
    return this.paused || this.lit.size ? 0 : 1;
  }

  protected override animated() {
    return !this.still && (this.speed > 0 || this.target > 0 || this.wrapAt !== null);
  }

  /** A frame: the clock, then everything that moves with it. The orbits are not redrawn. */
  override tick(now: number) {
    this.dirty = false;
    if (this.resized) this.layout();
    this.advance(now);
    this.place();
  }

  private advance(now: number) {
    const dt = this.last ? Math.min(100, now - this.last) : 0;
    this.last = now;
    if (this.still) return;
    // Stops are at once (light(), setPaused()); a start eases in.
    const target = this.target;
    this.speed = reducedMotion() ? target : Math.min(target, this.speed + dt / START);
    this.jd += (dt / 1000) * DAYS_PER_SECOND * this.speed;
    // At 2060 the clock goes back to its start, halfway through a fade of the bodies.
    if (this.jd >= UNTIL && this.wrapAt === null) {
      if (reducedMotion()) this.jd = this.start;
      else {
        this.wrapAt = now + FADE / 2;
        this.glyphs.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }], FADE);
      }
    }
    if (this.wrapAt !== null && now >= this.wrapAt) {
      this.jd = this.start;
      this.wrapAt = null;
    }
  }

  /** Move the bodies and their links to the clock's date, and letter the name pointed at. */
  private place() {
    for (const p of this.planets) {
      const nu = trueAnomalyAt(p.m.j2000, this.jd);
      const q = this.schematic(orbitPointAtTrueAnomaly(p.orbit, nu), this.R);
      p.at = this.px(q);
      p.depth = this.camera.depth(q);
      p.g.setAttribute('transform', `translate(${p.at[0].toFixed(1)} ${p.at[1].toFixed(1)})`);
    }
    // Far to near: the groups move only when the order changes.
    const order = [...this.planets].sort((a, b) => a.depth - b.depth);
    if (order.some((p, i) => p !== this.order[i])) {
      this.order = order;
      this.glyphs.append(...order.map((p) => p.g));
    }
    this.moveLinks();
    this.letterName();
    this.showDate();
  }

  /**
   * Each planet's link is a circle over it, r + 6 px and at least 12 (24 px across). Where two
   * circles overlap they are cut between the two symbols (a clip-path, see linkRegion), so a point
   * goes to the nearer body and no circle is made smaller. The Moon's link, the ring's ellipse,
   * lies under the planets' links.
   */
  private moveLinks() {
    const linked = this.planets.filter((p): p is Planet & { link: HTMLAnchorElement } => !!p.link);
    for (const p of linked) {
      const reach = Math.floor(Math.max(p.r + 6, 12));
      if (reach !== p.reach) {
        p.reach = reach;
        p.link.style.width = p.link.style.height = `${2 * reach}px`;
      }
      p.link.style.transform = `translate(${(p.at[0] - reach).toFixed(1)}px, ${(p.at[1] - reach).toFixed(1)}px)`;
    }
    for (const p of linked) {
      const others = linked.filter((o) => o !== p);
      // The polygon's points are taken from the link box's corner, reach px up and left of its centre.
      const css = ([x, y]: Vec2) => `${(x + p.reach).toFixed(1)}px ${(y + p.reach).toFixed(1)}px`;
      const poly = linkRegion(p, others);
      // Nothing left (a small body right over a large one): no target for the moment.
      const clip = !poly
        ? ''
        : poly.length < 3
          ? 'inset(50%)'
          : `polygon(${poly.map(css).join(',')})`;
      if (clip !== p.clip) {
        p.clip = clip;
        p.link.style.clipPath = clip;
      }
    }
    const moon = this.links.get('moon');
    const earth = this.planet('earth');
    if (moon && earth) {
      const w = this.rho + MOON_LINK,
        h = w * Math.sin(this.camera.pitch);
      moon.style.transform = `translate(${(earth.at[0] - w).toFixed(1)}px, ${(earth.at[1] - h).toFixed(1)}px)`;
    }
  }

  /**
   * The name of the body pointed at, 6 px outside its symbol on the side away from the Sun, off the
   * other symbols, the Sun and its own orbit. Under a finger it goes above the fingertip instead, or
   * beside it, and never under it.
   */
  private letterName() {
    const dl = new DrawList();
    const id = this.pointed;
    const p = this.planet(id === 'moon' ? 'earth' : (id ?? ''));
    if (id && p) {
      const box = id === 'moon' ? this.moonBox() : p.box;
      const others = this.planets
        .filter((o) => o !== p)
        .map((o) => shift(o.box, o.at))
        .concat(this.sunBox());
      const labels = new LabelPlacer({ x0: 4, y0: 4, x1: this.w - 4, y1: this.h - 4 }, others);
      // Its orbit is lit with it: keep the name off it, as the key plans do.
      if (id !== 'moon') labels.line(p.path);
      const sun = this.px([0, 0, 0]);
      const text = (this.links.get(id)?.textContent ?? id).trim().toUpperCase();
      const cx = p.at[0] + (box.x0 + box.x1) / 2,
        cy = p.at[1] + (box.y0 + box.y1) / 2;
      const hw = (box.x1 - box.x0) / 2,
        hh = (box.y1 - box.y0) / 2;
      // One anchor per spot, on the ellipse inscribed in the symbol's box, nearest the Sun last.
      let reqs: LabelReq[] = spotsToward(p.at[0] - sun[0], p.at[1] - sun[1]).map((spot) => ({
        x: cx + DIRS[spot][0] * hw,
        y: cy + DIRS[spot][1] * hh,
        text,
        size: 'l',
        spots: [spot],
        gap: 6,
      }));
      if (this.touchAt) {
        // A fingertip hides about FINGER px each way of the point it presses: the name goes above it
        // (and above the body's own symbol), else beside it, else at a spot it leaves clear.
        const [tx, ty] = this.touchAt;
        const tip: Box = { x0: tx - FINGER, y0: ty - FINGER, x1: tx + FINGER, y1: ty + FINGER };
        const top = Math.min(ty, p.at[1] + box.y0);
        reqs = [
          { x: tx, y: top, text, size: 'l', spots: ['t'], gap: FINGER + 4 },
          { x: tx, y: top, text, size: 'l', spots: ['tl', 'tr'], gap: FINGER / 0.7 },
          { x: tx, y: ty, text, size: 'l', spots: ['l', 'r'], gap: FINGER + 8 },
          ...reqs.filter((r) => !meets(labels.boxFor(r, r.spots![0]!), tip)),
        ];
      }
      labels.placeAny(dl, reqs);
    }
    this.scene.commit(dl);
  }

  private sunBox(): Box {
    const [x, y] = this.px([0, 0, 0]);
    const r = Math.max(10, this.R / 48) / 2;
    return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  }

  /** The date in the corner, YYYY-MM-DD, written only when the day changes. */
  private showDate() {
    const day = Math.floor(this.jd + 0.5);
    if (!this.clock || day === this.day) return;
    this.day = day;
    const iso = dateFromJulian(day - 0.5)
      .toISOString()
      .slice(0, 10);
    this.clock.textContent = iso;
    this.clock.setAttribute('datetime', iso);
  }

  /** Yellow for the lit bodies' symbols and orbits (and the Moon's ring). */
  private paint() {
    for (const el of this.svg.querySelectorAll<SVGElement>('[data-ref]'))
      el.classList.toggle('hot', this.lit.has(el.dataset.ref ?? ''));
  }

  // ---- Pointing, Pause and hooks ----------------------------------------------------------------

  /**
   * Point at a body or the Moon (null: none): it lights up, its name is lettered, the clock stops.
   * `at` is where a finger presses, px in the drawing: the name then keeps clear of the fingertip.
   */
  setActive(id: string | null, opts: { at?: Vec2 } = {}) {
    this.pointed = id;
    this.touchAt = id ? (opts.at ?? null) : null;
    if (id) this.svg.dataset.active = id;
    else delete this.svg.dataset.active;
    this.light(id ? [id] : []);
  }

  /**
   * Light up bodies (the touch chooser's candidates). The clock stops at once while any is lit, so
   * a body never slips out from under a still pointer.
   */
  light(ids: string[]) {
    this.lit = new Set(ids);
    if (ids.length) this.speed = 0;
    this.paint();
    this.redraw();
  }

  setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    if (p) this.speed = 0;
    this.redraw();
  }

  /**
   * Bodies within reach of a tap at (x, y) px, in NASA's order: a planet within max(r + 8, 22) px of
   * its centre, the Moon within max(ρ + 4, 22) px of the Earth's.
   */
  within(x: number, y: number): string[] {
    const near = (p: Planet | undefined, reach: number) =>
      !!p && Math.hypot(p.at[0] - x, p.at[1] - y) <= reach;
    return [...this.links.keys()].filter((id) => {
      if (id === 'moon') return near(this.planet('earth'), Math.max(this.rho + 4, 22));
      const p = this.planet(id);
      return near(p, Math.max((p?.r ?? 0) + 8, 22));
    });
  }

  /** The body pointed at, for tests. */
  get active(): string | null {
    return this.pointed;
  }

  /** The clock's date and time, ISO 8601. */
  get simDate(): string {
    return dateFromJulian(this.jd).toISOString();
  }

  /** Set the clock to a date (YYYY-MM-DD, 00:00 UTC), for captures and tests. */
  setDate(iso: string) {
    this.jd = julianDate(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
    this.place();
    this.redraw();
  }

  /** Each body's position, px in the drawing. */
  positions(): Record<string, Vec2> {
    return Object.fromEntries(this.planets.map((p) => [p.m.id, p.at]));
  }

  /** Each body's symbol radius, px. */
  glyphRadii(): Record<string, number> {
    return Object.fromEntries(this.planets.map((p) => [p.m.id, p.r]));
  }
}

function union(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function shift(b: Box, d: Vec2): Box {
  return { x0: b.x0 + d[0], y0: b.y0 + d[1], x1: b.x1 + d[0], y1: b.y1 + d[1] };
}

/** Whether two boxes overlap (touching is not overlapping). */
function meets(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}
