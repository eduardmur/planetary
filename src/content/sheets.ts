// The drawing set: sheet 1 is the home page (a schematic of the solar system), sheets 2–11 are the
// bodies in NASA's order.

import { BODY_IDS, type BodyId } from '../data/types.ts';

export interface Sheet {
  /** "home" or a body id. */
  id: 'home' | BodyId;
  /** URL path segment under the site base ("" for the home page). */
  slug: string;
  /** 1–11. */
  number: number;
  /** Drawing number. */
  dwg: string;
  title: string;
  docType: string;
}

const NAMES: Record<BodyId, string> = {
  mercury: 'Mercury',
  venus: 'Venus',
  earth: 'Earth',
  moon: 'Moon',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturn',
  uranus: 'Uranus',
  neptune: 'Neptune',
  pluto: 'Pluto',
};

export const bodyName = (id: BodyId) => NAMES[id];

export const SHEETS: Sheet[] = [
  {
    id: 'home',
    slug: '',
    number: 1,
    dwg: 'PL-01',
    title: 'Solar system',
    docType: 'SCHEMATIC, NOT TO SCALE',
  },
  ...BODY_IDS.map((id, i) => ({
    id,
    slug: id,
    number: i + 2,
    dwg: `PL-${String(i + 2).padStart(2, '0')}`,
    title: NAMES[id],
    docType: 'DETAIL DRAWING',
  })),
];

export const SHEET_COUNT = SHEETS.length;

export function sheetById(id: Sheet['id']): Sheet {
  const s = SHEETS.find((x) => x.id === id);
  if (!s) throw new Error(`no sheet ${id}`);
  return s;
}

/** The ten body sheets, in NASA's order (the planet tabs). */
export const BODY_SHEETS = SHEETS.filter((s): s is Sheet & { id: BodyId } => s.id !== 'home');
