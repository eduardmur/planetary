// The project's rule, tested: every drawn size is the number NASA prints next to it.

import { describe, expect, it } from 'vitest';
import { body, mainVal } from '../../src/data/index.ts';
import { bodyModel, keyPlanModel, ringList, systemBodies } from '../../src/data/model.ts';
import { BODY_IDS } from '../../src/data/types.ts';

const number = (t: string) => Number(t.replace(/^[~<>]+/, '').replace(/,/g, ''));

describe('body models are sized by the strings they print', () => {
  for (const id of BODY_IDS) {
    it(id, () => {
      const m = bodyModel(id);
      expect(m.diameter).toBe(number(m.diameterText));
      expect(m.diameterText).toBe(mainVal(id, 'diameter').text);
      expect(m.obliquity).toBe(number(m.obliquityText));
      expect(m.obliquityText).toBe(mainVal(id, 'obliquity').text);
      expect(m.rotation).toBe(number(m.rotationText));
      expect(m.rotationText).toBe(mainVal(id, 'rotationPeriod').text);
      expect(m.polar).toBe(number(m.polarText));
      if (m.core) expect(m.core.r).toBe(number(m.core.text));
      for (const e of m.rings?.edges ?? []) expect(e.r).toBe(number(e.text));
    });
  }
});

describe('the ring popovers account for every row of NASA’s ring sheets', () => {
  const GIANTS = ['jupiter', 'saturn', 'uranus', 'neptune'] as const;
  const lower = (s: string) => s.toLowerCase();
  for (const id of GIANTS) {
    it(id, () => {
      const list = ringList(id)!;
      const listed = [...list.omitted, ...list.beyond];
      for (const r of body(id).rings!.rings) {
        if (/equator/i.test(r.name)) continue;
        const ends: number[] = r.radius.range ?? (r.radius.value === null ? [] : [r.radius.value]);
        // Drawn under its own name (one end of a range under a label that starts with it) ...
        const drawn = list.drawn.some(
          (e) => lower(e.name).startsWith(lower(r.name)) && ends.includes(e.r),
        );
        // ... or the same line as a drawn edge: an edge row at a drawn radius, never a named ring.
        const same =
          /edge$/i.test(r.name) && ends.length === 1 && list.drawn.some((e) => e.r === ends[0]);
        const at = r.radius.text.replace(/\s*-\s*/, '–');
        const named = listed.some((s) =>
          r.group
            ? s.startsWith(`${r.group} (`) && s.includes(r.name) && s.includes(at)
            : s === `${r.name} ${at}`,
        );
        const ways = [drawn || same, ends.length === 0, named];
        expect(ways.filter(Boolean), `${id} ${r.name}`).toHaveLength(1);
      }
    });
  }

  it('lists what is not drawn by NASA’s names, inside the drawn rings and beyond them', () => {
    expect(ringList('saturn')).toMatchObject({
      omitted: [
        'D outer edge 74,510',
        'Titan ringlet 77,871',
        'Maxwell gap/ringlet 87,491',
        'Keeler gap 136,487',
      ],
      beyond: [
        'G inner edge 166,000',
        'G outer edge 173,000',
        'E inner edge 180,000',
        'E outer edge 480,000',
      ],
    });
    expect(ringList('neptune')).toMatchObject({
      omitted: [
        'Lassell (1989N4R*) ~53,200',
        'Unnamed (indistinct) 61,953',
        'Arcs in Adams Ring (Courage, Liberté, Egalité 1, Egalité 2, Fraternité) 62,933: NASA gives no longitudes',
      ],
      beyond: [],
    });
    expect(ringList('jupiter')?.omitted).toEqual([]);
    expect(ringList('uranus')?.omitted).toEqual([]);
    expect(ringList('mars')).toBeUndefined();
  });

  it('names the drawn edges as NASA does; the drawings keep their short names', () => {
    expect(ringList('neptune')?.drawn.map((e) => e.name)).toEqual([
      'Galle (1989N3R)',
      'LeVerrier (1989N2R)',
      'Arago (1989N4R*)',
      'Adams (1989N1R)',
    ]);
    expect(ringList('jupiter')?.drawn.map((e) => e.name)).toEqual([
      'Halo inner',
      'Main ring inner',
      'Main ring outer',
    ]);
    expect(bodyModel('neptune').rings?.edges.map((e) => e.name)).toEqual([
      'Galle',
      'LeVerrier',
      'Arago',
      'Adams',
    ]);
    for (const id of GIANTS) {
      const m = bodyModel(id).rings!;
      const geometry = (e: { r: number; text: string; line: string }) => [e.r, e.text, e.line];
      expect(ringList(id)!.drawn.map(geometry)).toEqual(m.edges.map(geometry));
    }
  });
});

describe('orbit shapes are built from the main-table strings', () => {
  for (const id of BODY_IDS) {
    it(id, () => {
      const o = keyPlanModel(id).orbit;
      expect(o.q).toBe(number(o.qText));
      expect(o.Q).toBe(number(o.QText));
      expect(o.i).toBe(number(o.iText));
      expect(o.qText).toBe(mainVal(id, 'perihelion').text);
      expect(o.QText).toBe(mainVal(id, 'aphelion').text);
      expect(o.iText).toBe(mainVal(id, 'orbitalInclination').text);
      expect(o.aText).toBe(mainVal(id, 'distanceFromSun').text);
    });
  }
});

describe('spin direction', () => {
  // The axis is the right-hand-rule pole at NASA's obliquity and every body turns counter-clockwise
  // about it at |period|. Seen from the north side of the orbit plane, the bodies whose positive
  // pole points below the plane (obliquity > 90°) therefore turn clockwise. NASA marks the same
  // bodies retrograde with a negative rotation period; the sign must agree and must not be applied
  // a second time.
  const clockwise = BODY_IDS.filter(
    (id) => Math.cos((bodyModel(id).obliquity * Math.PI) / 180) < 0,
  );
  it('exactly Venus, Uranus and Pluto turn clockwise seen from orbital north', () => {
    expect(clockwise).toEqual(['venus', 'uranus', 'pluto']);
  });
  it("agrees with the sign of NASA's rotation period", () => {
    for (const id of BODY_IDS) expect(bodyModel(id).rotation < 0).toBe(clockwise.includes(id));
  });
});

describe('details drawn only where NASA gives them', () => {
  it('cores: Earth and Mars only', () => {
    expect(BODY_IDS.filter((id) => bodyModel(id).core)).toEqual(['earth', 'mars']);
  });
  it('rings: the four giants only', () => {
    expect(BODY_IDS.filter((id) => bodyModel(id).rings)).toEqual([
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ]);
  });
  it('dipoles: only bodies with a global field', () => {
    expect(BODY_IDS.filter((id) => bodyModel(id).dipole)).toEqual([
      'mercury',
      'earth',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ]);
  });
  it("Earth's dipole tilt is shown as derived, with its formula", () => {
    expect(bodyModel('earth').dipole?.label).toBe('(9.35°) = 90° − 80.65°');
  });
  it('a 0.0° tilt is a note, not an angle', () => {
    expect(bodyModel('saturn').dipole?.tilt).toBeNull();
    expect(bodyModel('mercury').dipole?.tilt).toBeNull();
  });
  it('the Moon has no J2000 elements, so no position and no orientation', () => {
    const m = keyPlanModel('moon');
    expect(m.j2000).toBeUndefined();
    expect(m.orbit.node).toBeUndefined();
    expect(m.centre).toBe('EARTH');
  });
  it('the plan holds the nine bodies that orbit the Sun', () => {
    expect(systemBodies().map((b) => b.id)).toEqual([
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
      'pluto',
    ]);
  });
});
