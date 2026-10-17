// The project's rule, tested: every drawn size is the number NASA prints next to it.

import { describe, expect, it } from 'vitest';
import { mainVal } from '../../src/data/index.ts';
import { bodyModel, keyPlanModel, systemBodies } from '../../src/data/model.ts';
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
