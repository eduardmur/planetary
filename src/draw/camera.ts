// Orthographic camera for drafting views. World frame is Z-up (Z = orbit normal / ecliptic north).
//
//   yaw   rotates the camera about world Z; yaw 0 looks along +Y, so X is to the right ("front view").
//   pitch is the camera's elevation above the XY plane; +90° looks straight down ("top view").
//
// Screen coordinates: X to the right, Y up (the SVG layer flips Y), depth toward the camera.

import { DEG, clamp, cross, dot, easeInOut, type Vec2, type Vec3 } from './vec.ts';

export interface Orientation {
  yaw: number;
  pitch: number;
}

/** Standard drafting views. ISO is the true isometric elevation, atan(1/√2) = 35.264°. */
export const VIEWS = {
  front: { yaw: 0, pitch: 0 },
  top: { yaw: 0, pitch: 90 * DEG },
  side: { yaw: 90 * DEG, pitch: 0 },
  iso: { yaw: 45 * DEG, pitch: Math.atan(1 / Math.SQRT2) },
} satisfies Record<string, Orientation>;

export class Camera {
  yaw: number;
  pitch: number;
  /** Unit vector from the scene toward the camera. */
  toCam: Vec3 = [0, -1, 0];
  right: Vec3 = [1, 0, 0];
  up: Vec3 = [0, 0, 1];

  private tween: { from: Orientation; to: Orientation; t0: number; ms: number } | null = null;

  constructor(o: Orientation = VIEWS.iso) {
    this.yaw = o.yaw;
    this.pitch = o.pitch;
    this.update();
  }

  set(o: Orientation) {
    this.tween = null;
    this.yaw = o.yaw;
    this.pitch = clamp(o.pitch, -90 * DEG, 90 * DEG);
    this.update();
  }

  /** Animate to an orientation along the shorter way round in yaw. */
  animateTo(o: Orientation, now: number, ms = 700) {
    const from = { yaw: this.yaw, pitch: this.pitch };
    let dy = (o.yaw - from.yaw) % (2 * Math.PI);
    if (dy > Math.PI) dy -= 2 * Math.PI;
    if (dy < -Math.PI) dy += 2 * Math.PI;
    this.tween = { from, to: { yaw: from.yaw + dy, pitch: o.pitch }, t0: now, ms };
  }

  get animating() {
    return this.tween !== null;
  }

  /** Where the camera is, or where it is turning to. */
  get target(): Orientation {
    return this.tween ? { ...this.tween.to } : { yaw: this.yaw, pitch: this.pitch };
  }

  /** Advance a running animation; returns true while the camera is still moving. */
  step(now: number): boolean {
    if (!this.tween) return false;
    const { from, to, t0, ms } = this.tween;
    const t = ms <= 0 ? 1 : clamp((now - t0) / ms, 0, 1);
    const k = easeInOut(t);
    this.yaw = from.yaw + (to.yaw - from.yaw) * k;
    this.pitch = from.pitch + (to.pitch - from.pitch) * k;
    this.update();
    if (t >= 1) this.tween = null;
    return true;
  }

  /** Rotate by a pointer drag (radians). */
  orbit(dYaw: number, dPitch: number) {
    this.tween = null;
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -90 * DEG, 90 * DEG);
    this.update();
  }

  private update() {
    const cy = Math.cos(this.yaw),
      sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch);
    this.toCam = [sy * cp, -cy * cp, sp];
    this.right = [cy, sy, 0];
    this.up = cross(this.toCam, this.right);
  }

  /** World point → screen-plane coordinates (same units as the world). */
  project(p: Vec3): Vec2 {
    return [dot(p, this.right), dot(p, this.up)];
  }

  depth(p: Vec3): number {
    return dot(p, this.toCam);
  }
}
