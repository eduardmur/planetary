// Kepler's equation for elliptic orbits. Angles in this file are radians.
//
//   M = E − e·sin E
//
// - M, the mean anomaly, grows uniformly with time: one full turn per orbital period.
// - E, the eccentric anomaly, is the angle at the centre of the ellipse to the point of the auxiliary
//   circle (radius a) that lies straight above the body, measured from the perihelion direction.
// - ν, the true anomaly, is the angle at the Sun (the focus) from perihelion to the body.
// All three are 0 at perihelion and π at aphelion and increase in the direction of motion.

const TAU = 2 * Math.PI;

/**
 * Eccentric anomaly E (radians) for a mean anomaly M (radians) and eccentricity 0 ≤ e < 1: the root
 * of E − e·sin E = M.
 *
 * That function of E only increases, so every real M has exactly one root, and it lies within e of M
 * (|E − M| = e·|sin E| ≤ e). M is not wrapped: E keeps M's revolution count, so a mean anomaly that
 * grows past 2π gives an eccentric anomaly that does too.
 *
 * Method: M is reduced to m = |M − 2πk| ∈ [0, π], where the root lies in [m, min(π, m/(1 − e))].
 * Newton's method starts from Danby's E₀ = m + 0.85·e (clamped to that bracket); a step that would
 * leave the bracket is replaced by bisection, and every evaluation shrinks the bracket, so it
 * converges for every e < 1, also for e → 1 with M → 0 where plain Newton crawls. It stops once the
 * residual is down to the rounding error of computing it (2ε·E): past that point a Newton step is
 * driven by rounding noise, and repeating it only walks E away from the root one ulp at a time.
 *
 * Measured over e ∈ [0, 0.99) × M ∈ [0, 2π] (with M down to 1e-300 and next to π and 2π), against
 * the exact root: at most 4 iterations for e ≤ 0.25, the planets' range, and 8 for e < 0.99 (up to
 * about 30 as e → 1 with M → 0); E is within 1.3·ε·max(|E|, |M|)/(1 − e·cos E) of the root, the
 * limit set by rounding in E − e·sin E − M (≤ 1.3 ulp for e ≤ 0.25). See tests/unit/astro.test.ts.
 */
export function solveKepler(M: number, e: number): number {
  if (!(e >= 0 && e < 1)) {
    throw new RangeError(`solveKepler: eccentricity must be in [0, 1), got ${e}`);
  }
  if (!Number.isFinite(M)) return Number.NaN;
  if (e === 0) return M;

  // Kepler's equation is odd in E and shifts by 2π with M: solve for m = |M − 2πk| ∈ [0, π].
  const turns = Math.round(M / TAU);
  const reduced = M - turns * TAU;
  const m = Math.abs(reduced);
  if (m === 0) return turns * TAU;

  // g(E) = E − e·sin E − m only rises; g(m) = −e·sin m ≤ 0, and at x = min(π, m/(1 − e)) it is
  // π − m ≥ 0 or e·(x − sin x) ≥ 0. The upper end keeps tiny m from drowning in E₀'s rounding.
  let lo = m;
  let hi = Math.min(Math.PI, m / (1 - e));
  let E = Math.min(m + 0.85 * e, hi);
  for (let k = 0; k < 100; k++) {
    const g = E - e * Math.sin(E) - m;
    if (g > 0) hi = E;
    else if (g < 0) lo = E;
    else break;
    const newton = E - g / (1 - e * Math.cos(E));
    if (newton === E) break; // the correction is below E's last bit
    // Computing g rounds by up to ~2ε·E (sin, the product, the subtraction). Once |g| is that
    // small, this step is the last one that means anything: take it, then stop.
    const atNoise = Math.abs(g) <= 2 * Number.EPSILON * E;
    // The ends are allowed: when e·sin m is below half an ulp of m (e → 0, or m next to π) the
    // root rounds to lo = m itself, and refusing a step onto it would bisect up to ~25 times.
    E = newton >= lo && newton <= hi ? newton : 0.5 * (lo + hi);
    if (atNoise || hi - lo <= 2 * Number.EPSILON * hi) break;
  }

  return (reduced < 0 ? -E : E) + turns * TAU;
}

/**
 * True anomaly ν (radians) for an eccentric anomaly E (radians) and eccentricity e.
 *
 * Uses ν = E + 2·atan(β·sin E / (1 − β·cos E)) with β = e / (1 + √(1 − e²)), which equals
 * tan(ν/2) = √((1 + e)/(1 − e))·tan(E/2) but has no branch cut: |ν − E| < π, so ν keeps E's
 * revolution count and is continuous in E.
 */
export function trueAnomaly(E: number, e: number): number {
  const beta = e / (1 + Math.sqrt(1 - e * e));
  return E + 2 * Math.atan((beta * Math.sin(E)) / (1 - beta * Math.cos(E)));
}

/** Eccentric anomaly E (radians) for a true anomaly ν (radians); the inverse of trueAnomaly. */
export function eccentricAnomalyFromTrue(nu: number, e: number): number {
  const beta = e / (1 + Math.sqrt(1 - e * e));
  return nu - 2 * Math.atan((beta * Math.sin(nu)) / (1 + beta * Math.cos(nu)));
}
