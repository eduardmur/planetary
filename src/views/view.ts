// Base class for an interactive 3D drafting view drawn into an <svg>: sizing, the camera, pointer
// drag to orbit, standard-view buttons, and one shared animation loop that only runs views on screen.

import { Camera, VIEWS, type Orientation } from '../draw/camera.ts';
import { DrawList, SvgScene } from '../draw/svg.ts';
import type { Vec2, Vec3 } from '../draw/vec.ts';

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const active = new Set<View>();
let raf = 0;

function loop(now: number) {
  raf = 0;
  for (const v of active) v.tick(now);
  if ([...active].some((v) => v.wantsFrames())) raf = requestAnimationFrame(loop);
}

function wake() {
  if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop);
}

export abstract class View {
  readonly svg: SVGSVGElement;
  readonly scene: SvgScene;
  readonly camera: Camera;
  /** CSS px size of the drawing area. */
  w = 0;
  h = 0;
  /** Pixels per world unit, and the pixel position of the world origin. */
  k = 1;
  ox = 0;
  oy = 0;

  protected home: Orientation;
  /** Turntable views turn about the vertical only, at a fixed elevation. */
  protected turntable: boolean;
  protected dirty = true;
  private onScreen = false;
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;

  constructor(
    svg: SVGSVGElement,
    home: Orientation = VIEWS.iso,
    opts: { turntable?: boolean } = {},
  ) {
    this.svg = svg;
    this.scene = new SvgScene(svg);
    this.home = home;
    this.turntable = !!opts.turntable;
    if (this.turntable) svg.classList.add('turntable');
    // Only turntable views turn under the pointer; the plans keep their views (and let touches
    // scroll the page).
    if (this.turntable) this.attachPointer();
    this.camera = new Camera(home);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(svg);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((es) => {
        this.onScreen = es.some((e) => e.isIntersecting);
        if (this.onScreen) {
          active.add(this);
          this.dirty = true;
          wake();
        } else active.delete(this);
      });
      this.io.observe(svg);
    } else {
      active.add(this);
    }
    // Subclasses call measure() once their own fields are set.
  }

  destroy() {
    this.ro?.disconnect();
    this.io?.disconnect();
    active.delete(this);
  }

  /** Radius (world units) of what must fit in the view, and the fraction of the short side it may use. */
  protected abstract extent(): {
    radius: number;
    fill: number;
    centre?: Vec2;
    shift?: [number, number];
  };
  /** Fill the draw list for the current camera and time. */
  protected abstract draw(dl: DrawList, now: number): void;
  /** Whether the view animates by itself (e.g. a spinning planet). */
  protected animated(): boolean {
    return false;
  }

  measure() {
    const r = this.svg.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.svg.setAttribute('viewBox', `0 0 ${this.w.toFixed(1)} ${this.h.toFixed(1)}`);
    const e = this.extent();
    this.k = (Math.min(this.w, this.h) * e.fill) / (2 * e.radius);
    // shift moves the drawing's centre by a fraction of the view size (e.g. to clear an inset).
    this.ox = this.w * (0.5 + (e.shift?.[0] ?? 0)) - (e.centre?.[0] ?? 0) * this.k;
    this.oy = this.h * (0.5 + (e.shift?.[1] ?? 0)) + (e.centre?.[1] ?? 0) * this.k;
    this.dirty = true;
    wake();
  }

  /** Extra rotation of the picture plane (radians, counter-clockwise), e.g. to keep a datum level. */
  protected roll(): number {
    return 0;
  }

  /** World point → pixel. */
  px(p: Vec3): Vec2 {
    let s = this.camera.project(p);
    const r = this.roll();
    if (r) {
      const c = Math.cos(r),
        n = Math.sin(r);
      s = [s[0] * c - s[1] * n, s[0] * n + s[1] * c];
    }
    return [this.ox + s[0] * this.k, this.oy - s[1] * this.k];
  }

  /** Screen-plane point (world units) → pixel. */
  px2(s: Vec2): Vec2 {
    return [this.ox + s[0] * this.k, this.oy - s[1] * this.k];
  }

  wantsFrames() {
    return this.onScreen && (this.dirty || this.camera.animating || this.animated());
  }

  /** Whether an animated view has moved enough since its last frame to be worth drawing. */
  protected stale(_now: number): boolean {
    return this.animated();
  }

  tick(now: number) {
    if (!this.onScreen) return;
    const moving = this.camera.step(now);
    if (!(this.dirty || moving || this.stale(now))) return;
    this.dirty = false;
    const dl = new DrawList();
    this.draw(dl, now);
    this.scene.commit(dl);
  }

  redraw() {
    this.dirty = true;
    wake();
  }

  resetView() {
    if (reducedMotion()) this.camera.set(this.home);
    else this.camera.animateTo(this.home, performance.now());
    this.redraw();
  }

  private attachPointer() {
    const svg = this.svg;
    let last: { x: number; y: number; id: number } | null = null;
    let start = { x: 0, y: 0 };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      last = { x: e.clientX, y: e.clientY, id: e.pointerId };
      start = { x: e.clientX, y: e.clientY };
      // A press that moves more than a few pixels is a drag, not a tap (read by click handlers).
      svg.dataset.dragged = '0';
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', (e) => {
      if (!last || e.pointerId !== last.id) return;
      const dx = e.clientX - last.x,
        dy = e.clientY - last.y;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) svg.dataset.dragged = '1';
      last = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.camera.orbit(-dx * 0.008, this.turntable ? 0 : dy * 0.008);
      this.redraw();
    });
    const end = (e: PointerEvent) => {
      if (last && e.pointerId === last.id) last = null;
      svg.classList.remove('dragging');
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', () => this.resetView());
    // Keyboard: arrows orbit, Home resets (the svg is focusable).
    svg.addEventListener('keydown', (e) => {
      const step = 5 * (Math.PI / 180);
      const map: Record<string, [number, number]> = this.turntable
        ? { ArrowLeft: [step, 0], ArrowRight: [-step, 0] }
        : {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
      const m = map[e.key];
      if (m) {
        this.camera.orbit(m[0], m[1]);
        this.redraw();
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === 'Home') {
        this.resetView();
        e.preventDefault();
      }
    });
  }
}
