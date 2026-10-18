// View A turned any way, for every body, every drawn row and the sizes below: at the home pitch, and
// in the orbit plane where the obliquity keeps the view while a drag turns it. Everything drawn
// stays in the view and off the key-plan inset, and the lettering keeps the rules of
// drawings-sweep.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { BODY_IDS } from '../../src/data/index.ts';
import type { LetterOpts } from '../../src/draw/lettering.ts';
import type { DrawList } from '../../src/draw/svg.ts';
import { Recorder, SIZES, drawOf, drawnRows, faults, viewA, type Size } from './drawings.ts';

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

describe('View A turned', () => {
  const TURNED: Size[] = [
    '1440x900',
    '1280x720',
    '1024x768',
    '1180x820',
    '861x700',
    '390x664',
    '390x844',
    '540x960',
    '320x568',
  ];
  // Every row at every turn: a body with rings takes a few seconds.
  const slow = { timeout: 30_000 };
  for (const size of TURNED)
    for (const id of BODY_IDS)
      it(
        `${id} at ${size}: stays inside the view, clear of the key plan, its lettering clear`,
        slow,
        () => {
          const s = SIZES[size].a;
          const out: string[] = [];
          for (const key of [
            null,
            ...drawnRows(id)
              .filter((r) => r.shape.includes('A'))
              .map((r) => r.key),
          ]) {
            const v = viewA(id, size);
            v.setFocus(key, { instant: true });
            const pitch = key === 'obliquity' ? 0 : 20;
            for (let yaw = 0; yaw < 360; yaw += 15) {
              v.camera.set({ yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 });
              const rec = new Recorder();
              drawOf(v, rec);
              const pts = [
                ...rec.ink.flatMap((g) => g.pts),
                ...rec.labels.flatMap((l) => l.strokes.flat()),
              ];
              const outside = pts.filter(
                (p) => p[0] < -0.5 || p[1] < -0.5 || p[0] > s.w + 0.5 || p[1] > s.h + 0.5,
              );
              const inset = s.inset
                ? pts.filter(
                    (p) =>
                      p[0] > s.inset!.x0 &&
                      p[1] > s.inset!.y0 &&
                      p[0] < s.inset!.x1 &&
                      p[1] < s.inset!.y1,
                  )
                : [];
              const at = `${key ?? 'idle'} yaw ${yaw} pitch ${pitch}`;
              if (outside.length || inset.length)
                out.push(`${at}: ${outside.length} outside, ${inset.length} on the key plan`);
              for (const line of faults(rec, s.w, s.h)) out.push(`${at}: ${line}`);
            }
          }
          expect(out).toEqual([]);
        },
      );
});
