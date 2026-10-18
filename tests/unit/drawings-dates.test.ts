// The key plan every two months over two years, for every body, every drawn row and the sizes of
// drawings-sweep.test.ts: the planets move round their orbits, and the position, its arrow and the
// date with them. Its lettering keeps the same rules on every date, and the position and its arrow
// keep off the other marks (♈, the Sun), edge-on too.

import { describe, expect, it, vi } from 'vitest';
import { BODY_IDS } from '../../src/data/index.ts';
import type { LetterOpts } from '../../src/draw/lettering.ts';
import type { DrawList } from '../../src/draw/svg.ts';
import { CHECKED, DATES, dense, drawKeyPlan, inside, sweep } from './drawings.ts';

vi.mock('../../src/draw/lettering.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/draw/lettering.ts')>();
  return {
    ...mod,
    letter(dl: DrawList, s: string, x: number, y: number, o?: LetterOpts) {
      const rec = dl as DrawList & {
        begin?: (s: string, o?: LetterOpts) => void;
        end?: () => void;
      };
      rec.begin?.(s, o);
      try {
        return mod.letter(dl, s, x, y, o);
      } finally {
        rec.end?.();
      }
    },
  };
});

describe('the key plan over two years', () => {
  for (const size of CHECKED)
    for (const id of BODY_IDS)
      it(`${id} at ${size}, every two months`, () => {
        const out: string[] = [];
        for (const epoch of DATES.slice(1))
          for (const line of sweep('P', id, size, epoch))
            out.push(`${epoch.toISOString().slice(0, 10)} ${line}`);
        expect(out).toEqual([]);
      });

  // Edge-on, the Sun and the ascending node stand on the line of sight, which the position may
  // cross; there it keeps off ♈'s arrowhead, the three-cornered mark of no row.
  for (const size of CHECKED)
    it(`the position and its arrow keep off the other marks at ${size}: ♈ and the Sun, and ♈ edge-on`, () => {
      const out: string[] = [];
      for (const id of BODY_IDS)
        for (const epoch of DATES)
          for (const key of [null, 'orbitalInclination']) {
            const { rec } = drawKeyPlan(id, size, key, epoch);
            const fills = rec.ink.filter((g) => g.fill);
            const own = fills.filter((g) => g.ref === 'orbitalVelocity');
            const others = fills.filter(
              (g) => g.ref !== 'orbitalVelocity' && (!key || (!g.ref && g.pts.length === 3)),
            );
            for (const a of own)
              for (const b of others)
                if (
                  dense(a.pts, 0.3, true).some((q) => inside(q, b.pts)) ||
                  dense(b.pts, 0.3, true).some((q) => inside(q, a.pts))
                )
                  out.push(`${id} ${key ?? 'idle'} on ${epoch.toISOString().slice(0, 10)}`);
          }
      expect([...new Set(out)]).toEqual([]);
    });
});
