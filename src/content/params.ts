// NASA's 20 main-table rows as they appear in the schedule, and which drawing (if any) shows each one.
//
// "shape" lists the views that draw the parameter: A = the body view, P = the key plan (and on the
// general arrangement, the line-up and the plan). Rows without a shape are listed, with NASA's
// definition, and nothing is drawn for them.

export type View = 'A' | 'P';

export interface ParamMeta {
  key: string;
  shape: View[];
}

export const PARAMS: ParamMeta[] = [
  { key: 'mass', shape: [] },
  { key: 'diameter', shape: ['A'] },
  { key: 'density', shape: [] },
  { key: 'gravity', shape: [] },
  { key: 'escapeVelocity', shape: [] },
  { key: 'rotationPeriod', shape: ['A'] },
  { key: 'dayLength', shape: [] },
  { key: 'distanceFromSun', shape: ['P'] },
  { key: 'perihelion', shape: ['P'] },
  { key: 'aphelion', shape: ['P'] },
  { key: 'orbitalPeriod', shape: ['P'] },
  { key: 'orbitalVelocity', shape: ['P'] },
  { key: 'orbitalInclination', shape: ['P'] },
  { key: 'orbitalEccentricity', shape: ['P'] },
  { key: 'obliquity', shape: ['A'] },
  { key: 'meanTemperature', shape: [] },
  { key: 'surfacePressure', shape: [] },
  { key: 'moons', shape: [] },
  { key: 'ringSystem', shape: ['A'] },
  { key: 'magneticField', shape: ['A'] },
];

/**
 * Older deep-link keys for values that now live in a main row's popover: #polarRadius opens Diameter,
 * #dipoleTilt opens Global Magnetic Field?, and so on.
 */
export const ALIASES: Record<string, string> = {
  polarRadius: 'diameter',
  coreRadius: 'diameter',
  dipoleTilt: 'magneticField',
  dipoleOffset: 'magneticField',
};
