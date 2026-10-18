// The discrepancy ledger: both files it writes are up to date, and every conflict names the
// schedule row whose popover shows it.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { BODY_IDS, DISCREPANCIES } from '../../src/data/index.ts';

describe('discrepancy ledger', () => {
  it('data/discrepancies.md and src/data/discrepancies.json are up to date', () => {
    const script = resolve(import.meta.dirname, '../../scripts/ledger.ts');
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('every conflict belongs to a body and to one of its rows', () => {
    const keys = new Set(PARAMS.map((p) => p.key));
    for (const d of DISCREPANCIES) {
      expect(BODY_IDS).toContain(d.body);
      expect(keys.has(d.key), `${d.body} ${d.key}`).toBe(true);
    }
  });

  it('19 conflicts: Mercury, Venus, Earth, the Moon and Mars 1 each, Uranus 4, Pluto 10', () => {
    const count = (id: string) => DISCREPANCIES.filter((d) => d.body === id).length;
    expect(DISCREPANCIES).toHaveLength(19);
    expect(BODY_IDS.map(count)).toEqual([1, 1, 1, 1, 1, 0, 0, 4, 0, 10]);
  });
});
