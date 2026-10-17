// The drawing set: sheet 1 is the general arrangement, sheets 2–11 are the bodies in NASA's order.

import { BODY_IDS, type BodyId } from '../data/types.ts';

export interface Sheet {
  /** "ga" or a body id. */
  id: 'ga' | BodyId;
  /** URL path segment under the site base ("" for the general arrangement). */
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
    id: 'ga',
    slug: '',
    number: 1,
    dwg: 'PB-01',
    title: 'General arrangement',
    docType: 'GENERAL ARRANGEMENT',
  },
  ...BODY_IDS.map((id, i) => ({
    id,
    slug: id,
    number: i + 2,
    dwg: `PB-${String(i + 2).padStart(2, '0')}`,
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

export function neighbours(id: Sheet['id']): { prev: Sheet; next: Sheet } {
  const i = SHEETS.findIndex((s) => s.id === id);
  return {
    prev: SHEETS[(i - 1 + SHEETS.length) % SHEETS.length]!,
    next: SHEETS[(i + 1) % SHEETS.length]!,
  };
}
