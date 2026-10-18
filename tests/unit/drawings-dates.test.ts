// The key plan every two months over two years, for every body, every drawn row and the sizes of
// drawings-sweep.test.ts: the planets move round their orbits, and the position, its arrow and the
// date with them. Its lettering keeps the same rules on every date, and the position and its arrow
// keep off the other marks (♈, the Sun).

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

  it('the position and its arrow keep off the other marks (♈, the Sun)', () => {
    const out: string[] = [];
    for (const size of CHECKED)
      for (const id of BODY_IDS)
        for (const epoch of DATES) {
          const { rec } = drawKeyPlan(id, size, null, epoch);
          const fills = rec.ink.filter((g) => g.fill);
          const own = fills.filter((g) => g.ref === 'orbitalVelocity');
          for (const a of own)
            for (const b of fills.filter((g) => g.ref !== 'orbitalVelocity'))
              if (
                dense(a.pts, 0.3, true).some((q) => inside(q, b.pts)) ||
                dense(b.pts, 0.3, true).some((q) => inside(q, a.pts))
              )
                out.push(`${id} at ${size} on ${epoch.toISOString().slice(0, 10)}`);
        }
    expect([...new Set(out)]).toEqual([]);
  });
});
