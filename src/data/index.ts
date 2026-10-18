// Typed access to NASA's values (src/data/factsheet.json). Accessors throw when a value the drawings
// rely on is missing, so a change on NASA's pages fails the build instead of drawing nonsense.

import ledger from './discrepancies.json' with { type: 'json' };
import raw from './factsheet.json' with { type: 'json' };
import {
  BODY_IDS,
  type BodyId,
  type BodySheet,
  type Discrepancy,
  type FactSheet,
  type MainRow,
  type Row,
  type Val,
} from './types.ts';

export const FACTS = raw as unknown as FactSheet;
/** Where NASA's pages conflict, each with the body and the schedule row it concerns. */
export const DISCREPANCIES = ledger as unknown as Discrepancy[];
export { BODY_IDS };
export type { BodyId, BodySheet, Discrepancy, MainRow, Row, Val };

export type Section =
  'bulk' | 'orbital' | 'observational' | 'elements' | 'pole' | 'magnetosphere' | 'atmosphere';

export function body(id: BodyId): BodySheet {
  const b = FACTS.bodies[id];
  if (!b) throw new Error(`factsheet: no body ${id}`);
  return b;
}

export function mainRow(key: string): MainRow {
  const r = FACTS.main.rows.find((x) => x.key === key);
  if (!r) throw new Error(`factsheet: no main-table row ${key}`);
  return r;
}

export function mainVal(id: BodyId, key: string): Val {
  const v = mainRow(key).values[id];
  if (!v) throw new Error(`factsheet: no main-table value ${key}/${id}`);
  return v;
}

export function row(id: BodyId, section: Section, key: string): Row | undefined {
  return (body(id)[section] as Row[] | undefined)?.find((r) => r.key === key);
}

export function needRow(id: BodyId, section: Section, key: string): Row {
  const r = row(id, section, key);
  if (!r) throw new Error(`factsheet: ${id} has no ${section}.${key}`);
  return r;
}

/** The number a value states; throws when it states none. */
export function num(v: Val | undefined, what: string): number {
  if (!v || v.value === null || !Number.isFinite(v.value))
    throw new Error(`factsheet: ${what} is not a number (${v?.text})`);
  return v.value;
}

/**
 * NASA's ratio-to-Earth value for a main-table row. The ratio table repeats the moon count and the
 * yes/no rows as they are, and prints "Unknown" where the main table does (the giants' surface
 * pressure); those are not ratios, so they are not returned.
 */
export function ratioVal(id: BodyId, key: string): Val | undefined {
  if (key === 'moons' || key === 'ringSystem' || key === 'magneticField') return undefined;
  const v = FACTS.ratio.rows.find((r) => r.key === key)?.values[id];
  return v?.value === null ? undefined : v;
}

/** The text of a value with its footnote marker, as printed. */
export function printed(v: Val | undefined): string {
  if (!v) return '';
  return v.text + (v.note ?? '');
}
