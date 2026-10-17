// Minimal 3D vector and 3×3 matrix helpers. Plain tuples, no classes: the renderer rebuilds every
// frame from data, and a few thousand short-lived arrays per frame are cheap.

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const DEG = Math.PI / 180;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

export const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Mᵀ·v, i.e. the inverse rotation for an orthonormal M. */
export const mulT = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

export const matMul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return r;
};

export const rotY = (t: number): Mat3 => {
  const c = Math.cos(t),
    s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (t: number): Mat3 => {
  const c = Math.cos(t),
    s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** Rotation by angle t about a unit axis (Rodrigues). */
export const rotAxis = (k: Vec3, t: number): Mat3 => {
  const [x, y, z] = k;
  const c = Math.cos(t),
    s = Math.sin(t),
    C = 1 - c;
  return [
    c + x * x * C,
    x * y * C - z * s,
    x * z * C + y * s,
    y * x * C + z * s,
    c + y * y * C,
    y * z * C - x * s,
    z * x * C - y * s,
    z * y * C + x * s,
    c + z * z * C,
  ];
};

/** Any unit vector perpendicular to v. */
export const perpendicular = (v: Vec3): Vec3 =>
  Math.abs(v[2]) < 0.9 ? norm(cross(v, [0, 0, 1])) : norm(cross(v, [1, 0, 0]));

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
