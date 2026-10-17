// The home page's schematic of the solar system: the nine bodies that circle the Sun, with what the
// drawing needs for each (orbit, J2000 elements for positions, size, rings and pole).
//
// PLACEHOLDER from the restructuring: the axes all point to the ecliptic pole. The home-page work
// replaces this with NASA's poles of rotation (see the redesign spec, §2.3).

import type { MeanElements } from '../astro/index.ts';
import type { OrbitShape } from '../views/keyplan.ts';
import { bodyModel, systemBodies } from './model.ts';
import type { BodyId } from './types.ts';

export interface OrreryBody {
  id: BodyId;
  name: string;
  /** Main-table q and Q, inclination, and the J2000 node and perihelion longitude. */
  orbit: OrbitShape;
  /** J2000 mean elements, for the positions. */
  j2000: MeanElements;
  /** Equatorial diameter and polar radius, km (NASA). */
  diameter: number;
  polar: number;
  /** Ring edges drawn on the symbol, km. */
  rings?: { r: number; line: 'wide' | 'thin' }[];
  /** Unit vector to the positive pole, ecliptic J2000. */
  axis: [number, number, number];
}

export interface OrreryModel {
  bodies: OrreryBody[];
  /** The largest aphelion, 10⁶ km: Pluto's, which sets the radial scale. */
  qMax: number;
}

export function orreryModel(_issued: string): OrreryModel {
  const bodies = systemBodies().map((s) => {
    const m = bodyModel(s.id as BodyId);
    return {
      id: s.id as BodyId,
      name: s.name,
      orbit: s.orbit,
      j2000: s.j2000,
      diameter: m.diameter,
      polar: m.polar,
      axis: [0, 0, 1] as [number, number, number],
    };
  });
  return { bodies, qMax: Math.max(...bodies.map((b) => b.orbit.Q)) };
}
