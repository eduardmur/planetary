// Every lettered value in View A and the key plan, for every body, every drawn row and the sizes the
// built pages give the drawings in eighteen windows (desktop from 1024×768 to 2560×1440, an iPad held
// upright, phones from 320×568 to 430×932, and phones held sideways): no other line may run through
// the lettering or come within a stroke's breadth of it, unless a mask interrupts it there; no mask
// may hide a mark (a dot, an arrowhead) or the body's outline; no two labels may come within 3 px of
// each other, nor stand side by side on one line less than 10 px apart, as if one; and the lettering
// stays inside the drawing. Then the ring radii, the dipole, the values drawn always and what View A's
// description says of the graphic scale. The key plan on other dates is in drawings-dates.test.ts,
// View A turned in drawings-turned.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { BODY_IDS, type BodyId } from '../../src/data/index.ts';
import type { Box, LabelPlacer } from '../../src/draw/labels.ts';
import type { LetterOpts } from '../../src/draw/lettering.ts';
import type { DrawList } from '../../src/draw/svg.ts';
import type { Vec2 } from '../../src/draw/vec.ts';
import { BodyView } from '../../src/views/body.ts';
import {
  CHECKED,
  boxOf,
  dense,
  drawViewA,
  drawnRows,
  hull,
  inside,
  meets,
  segDist,
  sweep,
  viewA,
  type Recorder,
  type Size,
} from './drawings.ts';

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

describe('lettering in the drawings stays clear of the lines', () => {
  for (const size of CHECKED)
    for (const id of BODY_IDS) {
      it(`${id} at ${size}: View A`, () => expect(sweep('A', id, size)).toEqual([]));
      it(`${id} at ${size}: key plan`, () => expect(sweep('P', id, size)).toEqual([]));
    }
});

const GIANTS: BodyId[] = ['jupiter', 'saturn', 'uranus', 'neptune'];

describe('ring radii', () => {
  type Placer = LabelPlacer & { placed: Box[] };
  /** The ring values' boxes, and what each costs against the lines, the marks and the body (the
   *  lettering above keeps them off the other labels), with the drawing they are lettered in. */
  function ringValues(id: BodyId, size: Size) {
    const proto = BodyView.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = proto.ringDims!;
    let out: { box: Box; cost: number }[] = [];
    proto.ringDims = function (this: BodyView, ...a: unknown[]) {
      const labels = a[1] as Placer;
      const n = labels.placed.length;
      const r = orig.apply(this, a);
      const boxes = labels.placed.splice(n);
      const others = labels.placed.splice(0);
      out = boxes.map((box) => ({ box, cost: labels.cost(box) }));
      labels.placed.push(...others, ...boxes);
      return r;
    };
    try {
      const { rec } = drawViewA(id, size, 'ringSystem');
      return { values: out, rec };
    } finally {
      proto.ringDims = orig;
    }
  }

  for (const size of CHECKED)
    for (const id of GIANTS)
      it(`${id} at ${size}: every value stands clear of the body, the lines and the marks`, () => {
        const { values, rec } = ringValues(id, size);
        expect(values.length).toBeGreaterThanOrEqual(2);
        expect(values.filter((v) => v.cost > 0)).toEqual([]);
        // None on the disc, whatever its mask would interrupt.
        const disc = hull(
          rec.ink
            .filter((g) => g.ref === 'diameter' && (g.layer === 'wide' || g.layer === 'hidden'))
            .flatMap((g) => g.pts),
        );
        const onDisc = rec.labels
          .filter((l) => l.ref === 'ringSystem')
          .filter((l) => l.strokes.flat().some((q) => inside(q, disc)));
        expect(onDisc.map((l) => l.text)).toEqual([]);
      });

  it('a small drawing letters only the innermost and the outermost edge where all would crowd', () => {
    expect(ringValues('uranus', '390x664').values).toHaveLength(2);
    expect(ringValues('saturn', '390x664').values).toHaveLength(8);
    expect(ringValues('uranus', '1440x900').values).toHaveLength(10);
  });

  it('where the names would crowd, the radii stand alone, whatever the size', () => {
    const texts = (size: Size) =>
      drawViewA('jupiter', size, 'ringSystem')
        .rec.labels.filter((l) => l.ref === 'ringSystem')
        .map((l) => l.text);
    // Tall phones held upright draw Jupiter large enough for names, with no room for them.
    for (const size of ['390x844', '412x915'] as Size[]) {
      expect(texts(size)).toHaveLength(3);
      for (const t of texts(size)) expect(t).toMatch(/^[\d\s]+$/);
    }
    expect(texts('1440x900').every((t) => /[A-Z]/.test(t))).toBe(true);
  });
});

describe('the dipole', () => {
  const DIPOLES: BodyId[] = ['earth', 'jupiter', 'uranus', 'neptune'];
  for (const size of CHECKED)
    for (const id of DIPOLES)
      it(`${id} at ${size}: keeps 2 px off the rotation period, its tilt at its arc`, () => {
        const { rec, view } = drawViewA(id, size, 'magneticField');
        const rot = rec.labels.find((l) => l.ref === 'rotationPeriod')!;
        const dipole = rec.ink.filter((g) => g.ref === 'magneticField dipoleTilt');
        expect(dipole.length).toBeGreaterThan(0);
        let d = Infinity;
        for (const g of dipole)
          for (const q of dense(g.pts, 0.5, g.fill))
            for (const s of rot.strokes)
              for (let i = 1; i < s.length; i++) d = Math.min(d, segDist(q, s[i - 1]!, s[i]!));
        expect(d).toBeGreaterThanOrEqual(2);
        // The tilt by its arc, or on a leader that starts on it.
        const tilt = rec.labels.find((l) => l.text === (view as BodyView).m.dipole!.label)!;
        const arc = dipole.find((g) => g.layer === 'dim' && g.pts.length > 10)!;
        const near = (p: Vec2, pts: Vec2[], r: number) =>
          pts.some((q, i) => i > 0 && segDist(p, pts[i - 1]!, q) <= r);
        const letters = tilt.strokes.flat();
        const b = boxOf(letters, 4);
        const leader = dipole.find(
          (g) =>
            g.layer === 'dim' &&
            g.pts.length === 2 &&
            near(g.pts[0]!, arc.pts, 1) &&
            meets(boxOf([g.pts[1]!]), b),
        );
        if (!leader) expect(letters.some((q) => near(q, arc.pts, 12))).toBe(true);
      });
});

describe('values drawn always', () => {
  // A click on a row adds its details; the values already lettered stay where they are.
  const where = (rec: Recorder) =>
    rec.labels
      .filter((l) => ['diameter', 'obliquity', 'rotationPeriod'].includes(l.ref))
      .map(
        (l) =>
          `${l.text} ${boxOf(l.strokes.flat()).x0.toFixed(1)} ${boxOf(l.strokes.flat()).y0.toFixed(1)}`,
      );
  for (const size of CHECKED)
    for (const id of BODY_IDS)
      it(`${id} at ${size}: do not move when a row adds its details`, () => {
        const idle = where(drawViewA(id, size, null).rec);
        expect(idle.length).toBeGreaterThanOrEqual(4);
        for (const key of ['diameter', 'ringSystem', 'magneticField', 'rotationPeriod'])
          if (key === 'diameter' || drawnRows(id).some((r) => r.key === key))
            expect(where(drawViewA(id, size, key).rec), key).toEqual(idle);
      });
});

describe("View A's description", () => {
  // The graphic scale is left out of a small drawing, and the description says so.
  const page =
    'View A: Earth, axis tilted 23.4 degrees from the orbit normal, with a scale bar in km.';
  it('mentions the graphic scale only where it is drawn', () => {
    const label = (size: Size) => viewA('earth', size, page).svg.getAttribute('aria-label');
    expect(label('1440x900')).toBe(page);
    expect(label('320x568')).toBe('View A: Earth, axis tilted 23.4 degrees from the orbit normal.');
  });
});
