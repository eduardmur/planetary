#!/usr/bin/env node
// Turns the NASA NSSDCA Planetary Fact Sheet snapshot in data/raw/ (see scripts/fetch-nasa.mjs) into
//
//   src/data/factsheet.json   the FactSheet contract of src/data/types.ts, read by the renderer
//   data/factsheet-main.csv   the 20 x 10 metric table of index.html, every cell as printed
//
//   npm run data:parse        (node scripts/parse-nasa.ts — Node strips the types)
//
// Every string in the output is NASA's text, normalised one way everywhere (normalizeText): tags and
// entities removed, whitespace collapsed, <sup>/<sub> written as Unicode super/subscripts. Powers that
// fact_notes.html types as "10^24" keep their caret, as printed (its "Sub- and Superscripts" note,
// kept in definitions.notes, explains them). Numbers are only read off that text ("3 x 10⁻⁶" is the
// number 3e-6); nothing is computed, rounded or converted.
//
// The parser is strict on purpose: an unknown row label, unit, heading, entity, gas line or ring
// column throws, so a change on NASA's side fails the parse instead of silently dropping a value.
// The dictionaries below are the complete list of what each page is allowed to contain.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTMLElement, TextNode, parse } from 'node-html-parser';
import type { Node } from 'node-html-parser';
import * as prettier from 'prettier';
import { BODY_IDS } from '../src/data/types.ts';
import type {
  BodyId,
  BodySheet,
  Composition,
  Definition,
  Definitions,
  FactSheet,
  Gas,
  MainRow,
  MainTable,
  NotesPage,
  Ring,
  RingSheet,
  Row,
  Satellite,
  SatelliteBlock,
  Val,
} from '../src/data/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = resolve(HERE, '../data/raw');
export const JSON_OUT = resolve(HERE, '../src/data/factsheet.json');
export const CSV_OUT = resolve(HERE, '../data/factsheet-main.csv');

export const PAGES = {
  main: 'index.html',
  mainNotes: 'planetfact_notes.html',
  ratio: 'planet_table_ratio.html',
  ratioNotes: 'planetfact_ratio_notes.html',
  sheetNotes: 'fact_notes.html',
} as const;

export const BODY_PAGES: Record<BodyId, string> = {
  mercury: 'mercuryfact.html',
  venus: 'venusfact.html',
  earth: 'earthfact.html',
  moon: 'moonfact.html',
  mars: 'marsfact.html',
  jupiter: 'jupiterfact.html',
  saturn: 'saturnfact.html',
  uranus: 'uranusfact.html',
  neptune: 'neptunefact.html',
  pluto: 'plutofact.html',
};

export const RING_PAGES: Partial<Record<BodyId, string>> = {
  jupiter: 'jupringfact.html',
  saturn: 'satringfact.html',
  uranus: 'uranringfact.html',
  neptune: 'nepringfact.html',
};

// ---------------------------------------------------------------------------------------------------
// Key dictionaries. Labels are written as printed (after normalizeText) and matched case-insensitively
// with any footnote marker removed. A label that is not listed fails the parse.
// ---------------------------------------------------------------------------------------------------

type KeyDict = Readonly<Record<string, string>>;

/** Keys of the bulk, orbital, mean-orbital-element and pole rows, by printed label (every variant). */
export const ROW_KEYS: {
  bulk: KeyDict;
  orbital: KeyDict;
  elements: KeyDict;
  pole: KeyDict;
} = {
  bulk: {
    'Mass (10²⁴ kg)': 'mass',
    'Volume (10¹⁰ km³)': 'volume',
    'Equatorial radius (km)': 'equatorialRadius',
    'Equatorial radius (1 bar level) (km)': 'equatorialRadius', // gas giants
    'Polar radius (km)': 'polarRadius', // also Jupiter
    'Polar radius (1 bar level) (km)': 'polarRadius', // Saturn, Uranus, Neptune
    'Volumetric mean radius (km)': 'meanRadius',
    'Core radius (km)': 'coreRadius', // Earth, Mars
    'Ellipticity (Flattening)': 'flattening',
    Ellipticity: 'flattening', // Jupiter
    'Mean density (kg/m³)': 'density',
    'Surface gravity (mean) (m/s²)': 'gravity', // Pluto prints "Surface Gravity (mean)"
    'Surface gravity (m/s²)': 'gravity', // Moon
    'Gravity (mean, 1 bar) (m/s²)': 'gravity', // gas giants
    'Surface acceleration (eq.) (m/s²)': 'accelEquator',
    'Surface acceleration (eq) (m/s²)': 'accelEquator', // Earth, Mars
    'Surface acceleration (m/s²)': 'accelEquator', // Moon: its Earth column is Earth's equatorial 9.78
    'Acceleration (eq., 1 bar) (m/s²)': 'accelEquator', // gas giants
    'Surface acceleration (pole) (m/s²)': 'accelPole',
    'Acceleration (pole, 1 bar) (m/s²)': 'accelPole', // gas giants
    'Escape velocity (km/s)': 'escapeVelocity',
    'GM (x 10⁶ km³/s²)': 'gm',
    'Bond albedo': 'bondAlbedo',
    'Geometric albedo': 'geometricAlbedo',
    'V-band magnitude V(1,0)': 'vMagnitude',
    'Solar irradiance (W/m²)': 'solarIrradiance',
    'Black-body temperature (K)': 'blackBodyTemperature',
    'Topographic range (km)': 'topographicRange',
    'Moment of inertia (I/MR²)': 'momentOfInertia',
    'J₂ (x 10⁻⁶)': 'j2',
    'Number of natural satellites': 'satellites',
    'Planetary ring system': 'ringSystem',
  },
  orbital: {
    'Semimajor axis (10⁶ km)': 'semimajorAxis',
    'Sidereal orbit period (days)': 'siderealPeriod',
    // The Moon's orbit is about the Earth: its perigee, apogee and revolution period get their own
    // keys, so that definitions.sheet (perihelion: "closest to the Sun", …) is not applied to them.
    'Revolution period (days)': 'revolutionPeriod', // Moon
    'Tropical orbit period (days)': 'tropicalPeriod', // Mars prints "Tropical orbit period* (days)"
    'Perihelion (10⁶ km)': 'perihelion',
    'Perigee (10⁶ km)': 'perigee', // Moon, "(10⁶ km)*"
    'Aphelion (10⁶ km)': 'aphelion',
    'Apogee (10⁶ km)': 'apogee', // Moon, "(10⁶ km)*"
    'Synodic period (days)': 'synodicPeriod',
    'Mean orbital velocity (km/s)': 'meanOrbitalVelocity',
    'Max. orbital velocity (km/s)': 'maxOrbitalVelocity',
    'Min. orbital velocity (km/s)': 'minOrbitalVelocity',
    'Orbit inclination (deg)': 'inclination',
    'Inclination to ecliptic (deg)': 'inclination', // Moon
    'Inclination to Earth equator (deg)': 'inclinationToEarthEquator', // Moon
    'Orbit eccentricity': 'eccentricity',
    'Sidereal rotation period (hrs)': 'siderealRotation',
    'Length of day (hrs)': 'dayLength',
    'Obliquity to orbit (deg)': 'obliquity',
    'Inclination of equator (deg)': 'equatorInclination',
    'Recession rate from Earth (cm/yr)': 'recessionRate', // Moon
  },
  elements: {
    'Semimajor axis (AU)': 'semimajorAxisAU',
    'Orbital eccentricity': 'eccentricity',
    'Orbital inclination (deg)': 'inclination',
    'Longitude of ascending node (deg)': 'ascendingNode',
    'Longitude of perihelion (deg)': 'perihelionLongitude',
    'Mean Longitude (deg)': 'meanLongitude', // Pluto prints "Mean longitude (deg)"
  },
  pole: {
    'Right Ascension': 'ra',
    Declination: 'dec',
    'Reference Date': 'referenceDate',
    T: 'tDefinition', // "T = Julian centuries from reference date"
    N: 'nDefinition', // Neptune: "N = 357.85 + 52.316T degrees"
  },
};

/**
 * Keys of the observational rows. "label" for rows at the left margin, "group › label" for rows
 * indented under a heading, and "group … label" (used when listed) for an unindented row that comes
 * after that group in the same paragraph: Saturn prints "Maximum apparent visual magnitude" twice,
 * for the planet and in the paragraph that starts "Mean values at opposition including rings".
 */
export const OBSERVATIONAL_KEYS: KeyDict = {
  Discoverer: 'discoverer',
  'Discovery Date': 'discoveryDate',
  'Distance from Earth › Minimum (10⁶ km)': 'distanceFromEarthMin',
  'Distance from Earth › Maximum (10⁶ km)': 'distanceFromEarthMax',
  'Apparent diameter from Earth › Maximum (seconds of arc)': 'apparentDiameterMax',
  'Apparent diameter from Earth › Minimum (seconds of arc)': 'apparentDiameterMin',
  'Maximum visual magnitude': 'maxVisualMagnitude', // Mercury, Venus
  'Mean values at inferior conjunction with Earth › Distance from Earth (10⁶ km)':
    'inferiorConjunctionDistance',
  'Mean values at inferior conjunction with Earth › Apparent diameter (seconds of arc)':
    'inferiorConjunctionDiameter',
  'Mean values at opposition from Earth › Distance from Earth (10⁶ km)': 'oppositionDistance',
  // Moon: kilometres, not 10⁶ km, so it gets its own key.
  'Mean values at opposition from Earth › Distance from Earth (equator, km)':
    'oppositionDistanceEquator',
  'Mean values at opposition from Earth › Apparent diameter (seconds of arc)': 'oppositionDiameter',
  'Mean values at opposition from Earth › Apparent visual magnitude': 'oppositionMagnitude',
  'Maximum apparent visual magnitude': 'maxApparentMagnitude',
  'Mean values at opposition including rings › Apparent visual magnitude':
    'oppositionMagnitudeWithRings',
  'Mean values at opposition including rings … Maximum apparent visual magnitude':
    'maxApparentMagnitudeWithRings',
};

/**
 * Keys of the magnetosphere rows. The model line has no colon: "Model GSFC-O₆" is label "Model",
 * value "GSFC-O₆"; Mercury prints only the model's name, "MESSENGER Model 2010" (label "").
 */
export const MAGNETOSPHERE_KEYS: KeyDict = {
  Model: 'model',
  'Dipole field strength': 'dipoleFieldStrength',
  'Dipole tilt to rotational axis': 'dipoleTilt',
  'Longitude of tilt': 'tiltLongitude',
  'Dipole offset': 'dipoleOffset', // Mercury prints "Dipole Offset"
  'Surface (1 Rh) field strength': 'surfaceField',
  'Surface (1 Re) field strength': 'surfaceField',
  'Surface (1 Rj) field strength': 'surfaceField',
  'Surface (1 Rs) field strength': 'surfaceField',
  'Surface (1 Ru) field strength': 'surfaceField',
  'Surface (1 Rn) field strength': 'surfaceField',
  'Geocentric Dipole': 'geocentricDipole', // Earth, under "Geomagnetic Poles - Model WMM2020"
  'Magnetic North Pole': 'magneticNorthPole', // Earth, idem
};

/** Keys of the atmosphere rows (the composition list that follows them is parsed separately). */
export const ATMOSPHERE_KEYS: KeyDict = {
  'Surface pressure': 'surfacePressure', // gas giants and Pluto print "Surface Pressure"
  'Surface pressure (night)': 'surfacePressure', // Moon
  'Surface density': 'surfaceDensity',
  'Scale height': 'scaleHeight',
  'Total mass of atmosphere': 'atmosphereMass',
  'Total mass of hydrosphere': 'hydrosphereMass', // Earth
  'Average temperature': 'averageTemperature',
  'Surface temperature': 'surfaceTemperature', // Pluto
  'Diurnal temperature range': 'diurnalTemperatureRange',
  'Diurnal temperature range (equator)': 'diurnalTemperatureRange', // Moon
  'Wind speeds': 'windSpeeds',
  'Mean molecular weight': 'meanMolecularWeight',
  'Abundance at surface': 'surfaceAbundance', // Moon
  'Temperature at 1 bar': 'temperatureAt1Bar',
  'Temperature at 0.1 bar': 'temperatureAt0p1Bar',
  'Density at 1 bar': 'densityAt1Bar',
};

/**
 * Keys of the rows of the moons a planet's page lists: "Satellites of Mars" (one column per moon),
 * Pluto's "Charon (P1)" ("label   value" lines) and "Other Moons of Pluto" (one row per moon).
 */
export const SATELLITE_KEYS: KeyDict = {
  'Semimajor axis (km)': 'semimajorAxis', // Mars prints "Semimajor axis* (km)"
  'Semi-Major Axis (km)': 'semimajorAxis', // Pluto's other moons, barycentric
  'Mean distance from Pluto (km)': 'meanDistance', // Charon
  'Sidereal orbit period (days)': 'siderealPeriod',
  'Orbital Period (days)': 'orbitalPeriod', // Pluto's other moons
  'Sidereal rotation period (days)': 'siderealRotation',
  'Rotation Period (days)': 'rotationPeriod', // Pluto's other moons
  'Orbital inclination (deg)': 'inclination',
  'Orbital inclination to Pluto (deg)': 'inclinationToPluto', // Charon
  'Orbital eccentricity': 'eccentricity',
  'Subplanetary axis radius (km)': 'subplanetaryRadius', // Phobos, Deimos: three semi-axes
  'Along-orbit axis radius (km)': 'alongOrbitRadius',
  'Polar axis radius (km)': 'polarRadius',
  'Equatorial radius (km)': 'equatorialRadius', // Charon
  'Mean Diameter (km)': 'meanDiameter', // Pluto's other moons, e.g. "48.4 x 33.8 x 31.4"
  'Mass (10¹⁵ kg)': 'mass', // Phobos, Deimos
  'Mass (10²¹ kg)': 'mass', // Charon
  'Mean density (kg/m³)': 'density',
  'Surface gravity (m/s²)': 'gravity', // Charon
  'Escape velocity (km/s)': 'escapeVelocity', // Charon
  'Geometric albedo': 'geometricAlbedo', // Charon and Pluto's other moons print "Geometric Albedo"
  'Bond albedo': 'bondAlbedo', // Charon prints "Bond Albedo"
  'Visual magnitude V(1,0)': 'vMagnitude', // Phobos, Deimos
  'Apparent visual magnitude (V₀)': 'apparentMagnitude', // Phobos, Deimos
  'Apparent visual magnitude': 'apparentMagnitude', // Charon
};

/** Keys of the main table (index.html), by the text of the row's link to planetfact_notes.html. */
export const MAIN_KEYS: KeyDict = {
  Mass: 'mass',
  Diameter: 'diameter',
  Density: 'density',
  Gravity: 'gravity',
  'Escape Velocity': 'escapeVelocity',
  'Rotation Period': 'rotationPeriod',
  'Length of Day': 'dayLength',
  'Distance from Sun': 'distanceFromSun',
  Perihelion: 'perihelion',
  Aphelion: 'aphelion',
  'Orbital Period': 'orbitalPeriod',
  'Orbital Velocity': 'orbitalVelocity',
  'Orbital Inclination': 'orbitalInclination',
  'Orbital Eccentricity': 'orbitalEccentricity',
  'Obliquity to Orbit': 'obliquity',
  'Mean Temperature': 'meanTemperature',
  'Surface Pressure': 'surfacePressure',
  'Number of Moons': 'moons',
  'Ring System?': 'ringSystem',
  'Global Magnetic Field?': 'magneticField',
};

type NotesBlock = 'bulk' | 'orbital' | 'elements' | 'magnetosphere' | 'atmosphere';

/** fact_notes.html terms worded differently from the body pages, mapped to the same Row keys. */
const NOTES_TERM_KEYS: Record<NotesBlock, KeyDict> = {
  bulk: { 'Moment of inertia (C/MR²)': 'momentOfInertia' }, // the body pages print (I/MR²)
  orbital: {},
  elements: {},
  magnetosphere: { 'Surface field strength': 'surfaceField' },
  atmosphere: {
    'Atmospheric composition': 'composition',
    'Atmospheric composition (by volume)': 'compositionByVolume',
  },
};

/**
 * fact_notes.html terms that no row is keyed by; they go to definitions.unkeyed under the section
 * that defines them: "Absolute magnitude (Comets)" (Bulk Parameters; no body page has comets) and
 * "Longitude" (Mean orbital elements: the general term behind the three longitude rows).
 */
const NOTES_UNKEYED_TERMS = ['Absolute magnitude (Comets)', 'Longitude'];

/** Last parenthesis of a label that is a unit (Row.unit / MainRow.unit). */
const UNITS = new Set([
  '10²⁴ kg',
  '10²⁴kg',
  '10²¹ kg', // Charon
  '10¹⁵ kg', // Phobos, Deimos
  '10¹⁰ km³',
  '10⁶ km',
  'km',
  'kg/m³',
  'm/s²',
  'km/s',
  'x 10⁶ km³/s²',
  'W/m²',
  'K',
  'x 10⁻⁶',
  'days',
  'hrs',
  'hours',
  'deg',
  'degrees',
  'cm/yr',
  'AU',
  'seconds of arc',
  'C',
  'bars',
]);

/**
 * Last parentheses of labels that qualify the quantity instead of giving its unit. "Moment of inertia
 * (I/MR²)" names the ratio the value is (fact_notes.html: "dimensionless"), and "Apparent visual
 * magnitude (V₀)" the symbol of the magnitude.
 */
const NOT_UNITS = new Set(['Flattening', 'equator', 'night', 'I/MR²', 'V₀']);

/** Unit of composition amounts printed without "%" outside a "Minor (ppm)" list, by heading. */
const COMPOSITION_UNITS: KeyDict = {
  'Column abundances in 10⁶ per cm²': '10⁶ per cm²', // Mercury
  'night, particles per cubic cm': 'particles per cubic cm', // Moon
};

// ---------------------------------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------------------------------

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  i: 'ⁱ',
  n: 'ⁿ',
};

const SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '−': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  s: 'ₛ',
  t: 'ₜ',
  x: 'ₓ',
};

/**
 * Subscripts with no complete Unicode form, written "_equator" so the letters still read as a
 * subscript: fact_notes.html's R<sub>equator</sub> and R<sub>polar</sub> become R_equator, R_polar
 * (Unicode has no subscript q, and keeps one word in one notation).
 */
const PLAIN_SUBSCRIPTS = new Set(['equator', 'polar']);

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  Eacute: 'É',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  ouml: 'ö',
  uuml: 'ü',
  deg: '°',
  plusmn: '±',
  micro: 'µ',
  times: '×',
};

/** Tags removed without a trace; every other tag separates words (becomes a space). */
const INLINE_TAGS = new Set([
  'a',
  'b',
  'i',
  'u',
  'em',
  'strong',
  'span',
  'font',
  'sup',
  'sub',
  'img',
  'tt',
  'big',
  'small',
  'code',
]);

function fail(message: string): never {
  throw new Error(message);
}

function toScript(content: string, map: Record<string, string>, where: string): string {
  const chars = [...content];
  if (chars.length > 0 && chars.every((c) => Object.hasOwn(map, c))) {
    return chars.map((c) => map[c]).join('');
  }
  if (map === SUBSCRIPT && PLAIN_SUBSCRIPTS.has(content)) return `_${content}`;
  return fail(
    `${where} "${content}" has no Unicode form (add it to PLAIN_SUBSCRIPTS to write it "_${content}")`,
  );
}

function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (_m, name: string) => {
    if (name.startsWith('#')) {
      const hex = name[1] === 'x' || name[1] === 'X';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    return ENTITIES[name] ?? fail(`unknown HTML entity &${name};`);
  });
}

/** <sup>24</sup> → ²⁴, <sub>2</sub> → ₂; a <sup> of asterisks only is a footnote marker and stays "*". */
function convertScripts(html: string): string {
  return html.replace(
    /<(sup|sub)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi,
    (_m, tag: string, inner: string) => {
      const content = decodeEntities(inner.replace(/<[^>]*>/g, '')).trim();
      if (content === '' || /^\*+$/.test(content)) return content;
      const sup = tag.toLowerCase() === 'sup';
      return toScript(content, sup ? SUPERSCRIPT : SUBSCRIPT, `<${tag}>`);
    },
  );
}

/** HTML → text with the page's own line breaks and spacing kept (what a <pre> block needs). */
function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, '\n');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = convertScripts(s);
  // "Radius/<br />Eq. radius" is one word broken after the slash.
  s = s.replace(/\/\s*<br\b[^>]*>\s*/gi, '/');
  s = s.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (_m, tag: string) =>
    INLINE_TAGS.has(tag.toLowerCase()) ? '' : ' ',
  );
  s = s.replace(/<![^>]*>/g, ' ');
  return decodeEntities(s);
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * The one text normalisation used for every string in factsheet.json (and by the tests to check
 * that each of them occurs on its source page): tags stripped (inline tags without a trace, others
 * as a space), entities decoded (&nbsp; → space), whitespace collapsed, <sup>/<sub> digits, signs
 * and the few letters Unicode has written as super/subscripts (10<sup>24</sup> → 10²⁴, H<sub>2</sub>O
 * → H₂O, C<sub>2</sub>H<sub>x</sub> → C₂Hₓ), a subscript word Unicode cannot write as "_word"
 * (R<sub>equator</sub> → R_equator). Typed carets ("10^24") are text and stay as printed. A <sup>
 * holding only asterisks stays "*": the label and value parsers move such a trailing marker to `note`.
 */
export function normalizeText(html: string): string {
  return collapse(htmlToText(html));
}

// ---------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------

/** A printed number: sign, digits, thousands commas, optional decimals or a bare trailing dot. */
const NUM = String.raw`[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?`;
/** An exponent as normalizeText writes <sup>-6</sup>: superscript sign and digits. */
const EXPONENT = String.raw`[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+`;
const QUALIFIER_RE = /^(<~|>>|<<|~|<|>)\s*(?=[+-]?\.?\d)/;
// One number, then optionally a unit. The number is plain ("1,898.13", "16,298.", "+11.8"; the
// Uranian rings' "~0.4-" and "~0.3+" carry a trailing sign) or a power of ten ("10⁻⁵", "3 x 10⁻⁶",
// "2.5 x 10¹⁶"). A unit is separated by whitespace and holds no ASCII digit ("92 bars",
// "0.306 Gauss-Re³", "kg"), so "440 K (167 C)", "48.4 x 33.8 x 31.4", "19 x 10 x 9" and
// "3 x 10⁻¹⁵ bar (2 x 10⁻¹² torr)" state more than one number.
const SINGLE_RE = new RegExp(
  String.raw`^(?:(?:(?<mantissa>${NUM})\s*[x×]\s*)?10(?<exponent>${EXPONENT})|(?<number>${NUM})[+-]?)(?:%|\s+[^0-9]*)?$`,
);
const RANGE_RE = new RegExp(String.raw`^(${NUM})\s*(?:-|to)\s*(${NUM})(?:\s+[^0-9]*)?$`);

function toNumber(printed: string): number {
  const n = Number(printed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : fail(`"${printed}" is not a number`);
}

/** "⁻⁶" → "-6". */
const fromSuperscript = (exponent: string): string =>
  [...exponent]
    .map((c) => (c === '⁻' ? '-' : c === '⁺' ? '+' : String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c))))
    .join('');

/** Reads one printed value; see Val in src/data/types.ts. */
export function parseVal(printed: string): Val {
  let text = collapse(printed);
  let note: string | undefined;
  const marker = /^(.*?)\s*(\*+)$/.exec(text);
  if (marker) {
    text = marker[1] ?? '';
    note = marker[2];
  }
  const val: Val = { text, value: null };
  const q = QUALIFIER_RE.exec(text);
  const rest = q ? text.slice(q[0].length) : text;
  const single = SINGLE_RE.exec(rest)?.groups;
  const range = single ? null : RANGE_RE.exec(rest);
  if (q) val.qualifier = q[1];
  if (single?.exponent !== undefined) {
    // "3 x 10⁻⁶" is the number 3e-6, "10⁵" is 1e5: read as written, so no rounding creeps in.
    val.value = toNumber(`${single.mantissa ?? '1'}e${fromSuperscript(single.exponent)}`);
  } else if (single) val.value = toNumber(single.number ?? '');
  else if (range) val.range = [toNumber(range[1] ?? ''), toNumber(range[2] ?? '')];
  if (note) val.note = note;
  return val;
}

/** Moves a footnote marker off a label: "Tropical orbit period* (days)" → label + note "*". */
function labelParts(printed: string): { label: string; note?: string } {
  const text = collapse(printed);
  const m = /^(.*?[\w)])(\*+)(.*)$/.exec(text);
  if (!m) return { label: text };
  const after = m[3] ?? '';
  if (after.includes('*')) fail(`two footnote markers in label "${text}"`);
  return { label: collapse(`${m[1] ?? ''}${after}`), note: m[2] };
}

function unitOf(label: string): string | undefined {
  const m = /\s\(([^()]+)\)$/.exec(label);
  if (!m) return undefined;
  const inner = m[1] ?? '';
  if (UNITS.has(inner)) return inner;
  if (NOT_UNITS.has(inner)) return undefined;
  const last = inner.split(', ').at(-1); // "(equator, km)"
  if (last !== undefined && last !== inner && UNITS.has(last)) return last;
  return fail(`unknown unit "(${inner})" in "${label}" (add it to UNITS or NOT_UNITS)`);
}

const lowerIndexes = new WeakMap<KeyDict, Map<string, string>>();

function lookupKey(dict: KeyDict, label: string, where: string): string {
  let index = lowerIndexes.get(dict);
  if (!index) {
    index = new Map(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v]));
    lowerIndexes.set(dict, index);
  }
  return index.get(label.toLowerCase()) ?? fail(`${where}: unmapped label "${label}"`);
}

const hasKey = (dict: KeyDict, label: string): boolean =>
  Object.keys(dict).some((k) => k.toLowerCase() === label.toLowerCase());

interface RowSpec {
  key: string;
  label: string;
  value: string;
  group?: string;
  earth?: string;
  ratio?: string;
}

/** A comparison cell with something printed in it; the Earth column keeps NASA's "-" (synodic period). */
const filled = (t: string | undefined): t is string => t !== undefined && t !== '';
/** A ratio cell that holds a value: "-" and blank cells are left out (Row.ratio). */
const ratioFilled = (t: string | undefined): t is string => filled(t) && t !== '-';

function toRow(s: RowSpec): Row {
  const { label, note } = labelParts(s.label);
  const unit = unitOf(label);
  return {
    key: s.key,
    label,
    ...(s.group !== undefined ? { group: s.group } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(note !== undefined ? { note } : {}),
    body: parseVal(s.value),
    ...(filled(s.earth) ? { earth: parseVal(s.earth) } : {}),
    ...(ratioFilled(s.ratio) ? { ratio: parseVal(s.ratio) } : {}),
  };
}

function keyed(dict: KeyDict, label: string, where: string): string {
  return lookupKey(dict, labelParts(label).label, where);
}

/** The Row key of a printed bulk/orbital/elements/pole label; throws for a label ROW_KEYS lacks. */
export function rowKey(block: keyof typeof ROW_KEYS, label: string): string {
  return keyed(ROW_KEYS[block], label, block);
}

function assertUniqueKeys(rows: readonly { key: string }[], where: string): void {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) fail(`${where}: key "${r.key}" appears twice`);
    seen.add(r.key);
  }
}

// ---------------------------------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------------------------------

function readRaw(file: string): string {
  return readFileSync(resolve(RAW_DIR, file), 'utf8').replace(/\r\n?/g, '\n');
}

function parseHtml(html: string): HTMLElement {
  return parse(html.replace(/<!DOCTYPE[^>]*>/i, ''), {
    comment: false,
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  });
}

interface HeadingPiece {
  kind: 'heading';
  level: number;
  text: string;
}
interface TablePiece {
  kind: 'table';
  el: HTMLElement;
}
interface PrePiece {
  kind: 'pre';
  raw: string;
}
/** A run of inline HTML between two block boundaries (or blank lines in the source). */
interface ParaPiece {
  kind: 'para';
  html: string;
}
type Piece = HeadingPiece | TablePiece | PrePiece | ParaPiece;
type ContentPiece = Exclude<Piece, HeadingPiece>;

const SKIP_TAGS = new Set(['head', 'script', 'style', 'noscript', 'address']);
const BLOCK_SELECTOR = 'p, div, table, pre, h1, h2, h3, h4, h5, h6, hr, center, address, ul, ol';

/** Flattens a page into headings, tables, <pre> blocks and paragraphs, in document order. */
function pieces(root: HTMLElement): Piece[] {
  const out: Piece[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf.trim() !== '') out.push({ kind: 'para', html: buf });
    buf = '';
  };
  const visit = (node: Node): void => {
    if (node instanceof TextNode) {
      node.rawText.split(/\n[ \t]*\n/).forEach((part, i) => {
        if (i > 0) flush();
        buf += part;
      });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = (node.rawTagName ?? '').toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (/^h[1-6]$/.test(tag)) {
      flush();
      out.push({
        kind: 'heading',
        level: Number(tag.slice(1)),
        text: normalizeText(node.innerHTML),
      });
    } else if (tag === 'table') {
      flush();
      out.push({ kind: 'table', el: node });
    } else if (tag === 'pre') {
      flush();
      out.push({ kind: 'pre', raw: node.innerHTML });
    } else if (tag === 'br') {
      buf += '<br>';
    } else if (INLINE_TAGS.has(tag) && !node.querySelector(BLOCK_SELECTOR)) {
      buf += node.outerHTML;
    } else {
      flush();
      node.childNodes.forEach(visit);
      flush();
    }
  };
  visit(root);
  flush();
  return out;
}

interface Section<K extends string> {
  kind: K;
  heading: string;
  items: ContentPiece[];
}

function sectionize<K extends string>(
  ps: Piece[],
  classify: (level: number, text: string) => K,
  initial: K,
): Section<K>[] {
  const out: Section<K>[] = [{ kind: initial, heading: '', items: [] }];
  for (const p of ps) {
    if (p.kind === 'heading')
      out.push({ kind: classify(p.level, p.text), heading: p.text, items: [] });
    else out[out.length - 1]?.items.push(p);
  }
  return out;
}

const isTable = (p: ContentPiece): p is TablePiece => p.kind === 'table';
const isPre = (p: ContentPiece): p is PrePiece => p.kind === 'pre';

/** Cross-references printed as sentences rather than as bulleted links. */
const CROSS_REFERENCES = [
  /^For information on the (Earth|Moon), see the (Earth|Moon) Fact Sheet\.?$/,
  /^If no sub- or superscripts appear on this page\b/,
];

/** The text of a paragraph, split at line breaks that end a sentence; [] for navigation. */
function paragraphTexts(p: ParaPiece): string[] {
  const out: string[] = [];
  for (const segment of p.html.split(/<br\b[^>]*>/i)) {
    const text = normalizeText(segment);
    if (text === '') continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && !/[.!?]$/.test(prev)) out[out.length - 1] = `${prev} ${text}`;
    else out.push(text);
  }
  // Navigation: bulleted links ("Notes on the factsheets", "Mars Home Page", …) and cross-references.
  if (/<img\b[^>]*bullet/i.test(p.html)) return [];
  return out.filter((t) => !CROSS_REFERENCES.some((re) => re.test(t)));
}

interface Cell {
  html: string;
  colspan: number;
}

function cellsOf(tr: HTMLElement): Cell[] {
  return tr.childNodes
    .filter((n): n is HTMLElement => n instanceof HTMLElement && /^t[dh]$/i.test(n.rawTagName))
    .map((n) => ({ html: n.innerHTML, colspan: Number(n.getAttribute('colspan') ?? '1') }));
}

function lastUpdated(html: string, file: string): string {
  const m = /Last Updated: (\d{1,2} [A-Z][a-z]+ \d{4}),/.exec(normalizeText(html));
  return m?.[1] ?? fail(`${file}: no "Last Updated:" line`);
}

interface Line {
  indent: number;
  text: string;
}

function expandTabs(line: string): string {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
  return out;
}

/** The lines of a <pre> block: indentation (tabs expanded to 8 columns) and trimmed text. */
function preLines(raw: string): Line[] {
  return htmlToText(raw)
    .split('\n')
    .map((l) => {
      const e = expandTabs(l).trimEnd();
      return { indent: e.length - e.trimStart().length, text: e.trim() };
    });
}

/** "Mass (10²⁴ kg)        0.33010" → [label, value] at the first run of two or more spaces. */
function splitColumns(text: string): [string, string] | undefined {
  const m = /^(\S.*?)\s{2,}(\S.*)$/.exec(text);
  return m ? [m[1] ?? '', m[2] ?? ''] : undefined;
}

/** "Dipole offset: 0.076 Re" → [label, value] at the first colon. */
function splitColon(text: string): [string, string] | undefined {
  const m = /^([A-Za-z][^:]*?)\s*:\s*(.*)$/.exec(text);
  return m ? [m[1] ?? '', m[2] ?? ''] : undefined;
}

function paragraphsOf(lines: Line[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of [...lines, { indent: 0, text: '' }]) {
    if (l.text) cur.push(l.text);
    else if (cur.length) {
      out.push(collapse(cur.join(' ')));
      cur = [];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Body fact sheets
// ---------------------------------------------------------------------------------------------------

type BodySection =
  | 'preamble'
  | 'ignore'
  | 'bulk'
  | 'orbital'
  | 'observational'
  | 'elements'
  | 'pole'
  | 'magnetosphere'
  | 'atmosphere'
  | 'satellites';

function classifyBodyHeading(level: number, text: string): BodySection {
  if (level === 1 || (level === 2 && /\/Earth Comparison$/.test(text))) return 'preamble';
  // Earth's pointer to the Moon page ("For information on the Moon, see the Moon Fact Sheet").
  if (level === 2 && text === 'The Moon') return 'ignore';
  // Moons listed on their planet's page: Pluto's, here; Mars's under an h3 "Satellites of Mars".
  if (level === 2 && /^(Charon \(P1\)|Other Moons of Pluto)$/.test(text)) return 'satellites';
  if (level === 3) {
    if (text === 'Bulk parameters') return 'bulk';
    if (/^Orbital parameters\b/.test(text)) return 'orbital';
    if (/ Observational Parameters$/.test(text)) return 'observational';
    if (/ Mean Orbital Elements \(J2000\)$/.test(text)) return 'elements';
    if (/^(North|Positive) Pole of Rotation$/.test(text)) return 'pole';
    if (/ Magnetosphere$/.test(text)) return 'magnetosphere';
    if (/ Atmosphere( \(Exosphere\))?$/.test(text)) return 'atmosphere';
    if (/^Satellites of /.test(text)) return 'satellites';
  }
  if (level === 6) return 'ignore'; // NASA Official / Last Updated
  return fail(`unknown heading h${level} "${text}"`);
}

/** Bulk and orbital tables: label | body | Earth | Ratio (Body/Earth), or label | body (Moon orbit). */
function comparisonRows(
  table: HTMLElement,
  block: 'bulk' | 'orbital',
  name: string,
  where: string,
): Row[] {
  const [head, ...trs] = table.querySelectorAll('tr');
  const header = cellsOf(head ?? fail(`${where}: empty table`)).map((c) => normalizeText(c.html));
  const wide = header.length === 4;
  const ok =
    header[0] === '' &&
    header[1] === name &&
    (wide ? header[2] === 'Earth' && header[3] === `Ratio (${name}/Earth)` : header.length === 2);
  if (!ok) fail(`${where}: unexpected ${block} table header ${JSON.stringify(header)}`);
  return trs.map((tr) => {
    const cells = cellsOf(tr).map((c) => normalizeText(c.html));
    if (cells.length !== header.length) fail(`${where}: ${block} row ${JSON.stringify(cells)}`);
    const [label = '', value = '', earth, ratio] = cells;
    if (value === '') fail(`${where}: no value for "${label}"`);
    return toRow({ key: keyed(ROW_KEYS[block], label, where), label, value, earth, ratio });
  });
}

/**
 * "label   value" lines: Earth's bulk and orbital blocks, every page's mean orbital elements and
 * Pluto's Charon block.
 */
function columnRows(raw: string, dict: KeyDict, where: string): Row[] {
  return preLines(raw)
    .filter((l) => l.text !== '')
    .map((l) => {
      const [label, value] = splitColumns(l.text) ?? fail(`${where}: no value in "${l.text}"`);
      if (/\s{2,}/.test(value)) fail(`${where}: more than two columns in "${l.text}"`);
      return toRow({ key: keyed(dict, label, where), label, value });
    });
}

/**
 * Observational parameters: "Label:  value" and "label    value" rows, headings with indented rows
 * under them (Row.group), indented continuation lines (Neptune's discoverer) and, on the Moon page,
 * a "* …" footnote paragraph.
 */
function observationalBlock(raw: string, where: string): { rows: Row[]; footnotes: string[] } {
  const specs: RowSpec[] = [];
  const footnotes: string[] = [];
  let group: { name: string; indent: number } | undefined;
  let paragraphGroup: string | undefined;
  let footnote: string[] | undefined;
  let last: RowSpec | undefined;
  const endParagraph = (): void => {
    if (footnote) footnotes.push(collapse(footnote.join(' ')));
    footnote = group = paragraphGroup = last = undefined;
  };
  for (const line of preLines(raw)) {
    if (line.text === '') {
      endParagraph();
      continue;
    }
    if (footnote) {
      footnote.push(line.text);
      continue;
    }
    if (line.text.startsWith('*')) {
      footnote = [line.text];
      continue;
    }
    const split = splitColon(line.text) ?? splitColumns(line.text);
    if (split) {
      const [label, value] = split;
      const plain = labelParts(label).label;
      if (group && line.indent <= group.indent) group = undefined;
      let path = group ? `${group.name} › ${plain}` : plain;
      const after = paragraphGroup && `${paragraphGroup} … ${plain}`;
      if (!group && after && hasKey(OBSERVATIONAL_KEYS, after)) path = after;
      last = { key: lookupKey(OBSERVATIONAL_KEYS, path, where), label, value, group: group?.name };
      specs.push(last);
    } else if (line.indent > 0 && last) {
      last.value = `${last.value} ${line.text}`;
    } else {
      group = { name: line.text, indent: line.indent };
      paragraphGroup = line.text;
      last = undefined;
    }
  }
  endParagraph();
  return { rows: specs.map(toRow), footnotes };
}

/**
 * Pole of rotation: a number ("132.99") or a formula in T or N ("317.681 - 0.106T",
 * "43.46 - 0.51 cos N", "N = 357.85 + 52.316T degrees"). A formula states several numbers, so its
 * value is null like any such text, and "a - b cos N" is a difference, not a range.
 */
function poleRows(raw: string, where: string): Row[] {
  return preLines(raw)
    .filter((l) => l.text !== '')
    .map((l) => {
      const definition = /^([A-Z])\s*=\s*(.+)$/.exec(l.text);
      const [label, value] =
        splitColon(l.text) ??
        (definition ? [definition[1] ?? '', definition[2] ?? ''] : fail(`${where}: "${l.text}"`));
      const row = toRow({ key: keyed(ROW_KEYS.pole, label, where), label, value });
      delete row.body.range;
      return row;
    });
}

/**
 * Magnetosphere: the model line (before the <pre> on most pages, inside it on Earth's), then
 * "Label: value" rows.
 */
function magnetosphereRows(models: string[], raw: string, where: string): Row[] {
  const specs: RowSpec[] = [];
  const model = (line: string): void => {
    // "Model GSFC-O₆" prints the label "Model"; Mercury's "MESSENGER Model 2010" is the bare name.
    const labelled = /^Model\s+(.+)$/.exec(line);
    specs.push({
      key: 'model',
      label: labelled ? 'Model' : '',
      value: labelled ? (labelled[1] ?? '') : line,
    });
  };
  models.forEach(model);
  let group: string | undefined;
  for (const l of preLines(raw)) {
    if (l.text === '') continue;
    const split = splitColon(l.text);
    if (split) {
      const [label, value] = split;
      specs.push({ key: keyed(MAGNETOSPHERE_KEYS, label, where), label, value, group });
    } else if (/^Model\s/.test(l.text)) {
      model(l.text);
    } else {
      group = l.text; // Earth: "Geomagnetic Poles - Model WMM2020"
    }
  }
  const rows = specs.map(toRow);
  assertUniqueKeys(rows, `${where} magnetosphere`);
  return rows;
}

/** Atmosphere: "Label: value" rows (with indented continuations), then the composition list. */
function atmosphereBlock(raw: string, where: string): { rows: Row[]; composition?: Composition } {
  const lines = preLines(raw);
  const start = lines.findIndex((l) =>
    /^(Atmospheric composition|Estimated Composition)\b/.test(l.text),
  );
  const specs: RowSpec[] = [];
  for (const l of start === -1 ? lines : lines.slice(0, start)) {
    if (l.text === '') continue;
    const split = splitColon(l.text);
    const last = specs[specs.length - 1];
    if (split) {
      const [label, value] = split;
      specs.push({ key: keyed(ATMOSPHERE_KEYS, label, where), label, value });
    } else if (l.indent > 0 && last) {
      last.value = last.value ? `${last.value} ${l.text}` : l.text;
    } else {
      // Jupiter, Saturn: "Wind speeds" with its values on the indented lines below.
      specs.push({ key: keyed(ATMOSPHERE_KEYS, l.text, where), label: l.text, value: '' });
    }
  }
  for (const s of specs) if (s.value === '') fail(`${where}: no value for "${s.label}"`);
  const rows = specs.map(toRow);
  assertUniqueKeys(rows, `${where} atmosphere`);
  return start === -1
    ? { rows }
    : { rows, composition: parseComposition(lines.slice(start), where) };
}

// ---------------------------------------------------------------------------------------------------
// Atmospheric composition
// ---------------------------------------------------------------------------------------------------

type ListGroup = 'major' | 'minor' | 'aerosols' | 'none';

interface Logical {
  group: ListGroup;
  label?: string;
  text: string;
  indent: number;
}

const LIST_LABEL = /^(Major|Minor \(ppm\)|Aerosols)\s*:\s*(.*)$/;
const NAME = String.raw`[A-Z][A-Za-z]*(?:[ -][A-Za-z]+)*`;
const AMOUNT = String.raw`(?<amount>(?:<~|>>|<<|~|<|>)?\s*\d[\d,]*(?:\.\d*)?(?:\s*-\s*\d[\d,]*(?:\.\d*)?)?)`;

/** The shapes of a single gas, tried in order on one list item. */
const GAS_PATTERNS: readonly RegExp[] = [
  // Name (Formula) - amount[%] [(uncertainty)]: "Carbon Dioxide (CO₂) - 95.1%",
  // "Helium 4 (⁴He) - 40,000", "Molecular hydrogen (H₂) - 89.8% (2.0%)"; Neptune drops the dash in
  // "Methane (CH₄) 1.5% (0.5%)".
  new RegExp(
    String.raw`^(?<name>${NAME}(?: \d+)?)\s*\((?<formula>[^()]+)\)\s*(?:-\s*)?${AMOUNT}\s*(?<percent>%?)(?:\s*\((?<uncertainty>[^()]+)\))?$`,
  ),
  // amount% Name (Formula): "96.5% Carbon Dioxide (CO₂)", Pluto "99% Nitrogen (N₂)".
  new RegExp(String.raw`^${AMOUNT}(?<percent>%)\s+(?<name>${NAME})\s*\((?<formula>[^()]+)\)$`),
  // Name - amount: Moon "Methane - 1000"; or a formula alone: Earth "CH₄ - 1.94" (no name printed).
  new RegExp(
    String.raw`^(?:(?<name>${NAME})|(?<formula>[A-Z][A-Za-z₀-₉]*[₀-₉][A-Za-z₀-₉]*))\s*-\s*${AMOUNT}(?<percent>%?)$`,
  ),
  // Name amount: Mercury's column abundances "Sodium 12,000-200,000", "Oxygen <40,000".
  new RegExp(String.raw`^(?<name>${NAME})\s+${AMOUNT}$`),
];

const parenDepth = (s: string): number =>
  (s.match(/\(/g)?.length ?? 0) - (s.match(/\)/g)?.length ?? 0);

/** Whether a physical line continues the list item(s) of the previous one. */
function continuesList(cur: Logical, l: Line): boolean {
  // Major/Minor/Aerosols lists continue on lines indented under their text; Saturn breaks an item
  // as "Ammonia" / "(NH₃) - 125 (75);" with the second half at the left margin.
  if (cur.group !== 'none') return l.indent > cur.indent || l.text.startsWith('(');
  // Unlabelled lists and remarks run on after a comma, inside an open parenthesis, or into a line
  // that starts in lower case.
  return /,$/.test(cur.text) || parenDepth(cur.text) > 0 || /^[a-z(]/.test(l.text);
}

function joinList(prev: string, next: string): string {
  if (/[;,]$/.test(prev)) return `${prev} ${next}`;
  // A line that ends on an amount ends its item even without a ";" (Earth: "… (CO₂) - 420").
  if (/[\d%)]$/.test(prev)) return `${prev}\n${next}`;
  return `${prev} ${next}`;
}

interface Item {
  text: string;
  start: number;
  end: number;
}

/** Splits a list at ";", line breaks and "," outside parentheses (not the "," of "12,000"). */
function listItems(s: string): Item[] {
  const items: Item[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    const thousands = c === ',' && /\d/.test(s[i - 1] ?? '') && /\d/.test(s[i + 1] ?? '');
    const separator = c === ';' || c === '\n' || (c === ',' && !thousands);
    if (i === s.length || (depth === 0 && separator)) {
      const raw = s.slice(start, i);
      const text = raw.trim();
      const lead = raw.length - raw.trimStart().length;
      if (text) items.push({ text, start: start + lead, end: start + lead + text.length });
      start = i + 1;
    }
  }
  return items;
}

function matchGas(
  text: string,
  list: ListGroup,
  basisNote: string | undefined,
  where: string,
): Gas | undefined {
  for (const re of GAS_PATTERNS) {
    const g = re.exec(text)?.groups;
    if (!g) continue;
    const group: Gas['group'] = list === 'major' ? 'major' : list === 'minor' ? 'minor' : 'other';
    const percent = g.percent === '%';
    if (group === 'major' && !percent) fail(`${where}: major gas without "%": "${text}"`);
    if (group === 'minor' && percent) fail(`${where}: "%" in the ppm list: "${text}"`);
    const unit = percent
      ? '%'
      : group === 'minor'
        ? 'ppm'
        : (COMPOSITION_UNITS[basisNote ?? ''] ?? fail(`${where}: no unit for "${text}"`));
    return {
      name: collapse(g.name ?? ''),
      ...(g.formula ? { formula: collapse(g.formula) } : {}),
      amount: parseVal(g.amount ?? ''),
      unit,
      ...(g.uncertainty ? { uncertainty: collapse(g.uncertainty) } : {}),
      group,
    };
  }
  return undefined;
}

/**
 * The composition list: "Major:" (%), "Minor (ppm):" and "Aerosols:" lists, or an unlabelled list
 * (Mercury, Moon, Pluto). Every single gas becomes a Gas; any other text (aerosols, trace lists,
 * caveats) goes to `remarks` verbatim. An item of a Major/Minor list that is not a gas fails.
 */
function parseComposition(lines: Line[], where: string): Composition {
  const [first, ...rest] = lines;
  const head =
    /^((?:Atmospheric composition|Estimated Composition)(?:\s*\(([^()]*)\))?\s*:?)\s*(.*)$/.exec(
      first?.text ?? '',
    );
  if (!first || !head) return fail(`${where}: no composition heading`);
  const basis = head[1] ?? '';
  const basisNote = head[2];
  const inline = head[3] ?? '';
  const logical: Logical[] = [];
  let cur: Logical | undefined;
  const flush = (): void => {
    if (cur) logical.push(cur);
    cur = undefined;
  };
  for (const l of inline ? [{ indent: first.indent, text: inline }, ...rest] : rest) {
    if (l.text === '') {
      flush();
      continue;
    }
    const label = LIST_LABEL.exec(l.text);
    if (label) {
      flush();
      const name = label[1] ?? '';
      const group = name === 'Major' ? 'major' : name === 'Aerosols' ? 'aerosols' : 'minor';
      cur = { group, label: name, text: label[2] ?? '', indent: l.indent };
    } else if (cur && continuesList(cur, l)) {
      cur.text = joinList(cur.text, l.text);
    } else {
      flush();
      cur = { group: 'none', text: l.text, indent: l.indent };
    }
  }
  flush();

  const gases: Gas[] = [];
  const remarks: string[] = [];
  for (const lg of logical) {
    if (lg.group === 'aerosols') {
      remarks.push(collapse(`${lg.label ?? ''}: ${lg.text}`));
      continue;
    }
    let from: Item | undefined;
    let to: Item | undefined;
    const endRemark = (): void => {
      // "…Aluminum 15; and possible trace amounts of…": the joining "and" belongs to the list.
      if (from && to)
        remarks.push(collapse(lg.text.slice(from.start, to.end)).replace(/^and\s+/, ''));
      from = to = undefined;
    };
    for (const item of listItems(lg.text)) {
      const gas = matchGas(item.text, lg.group, basisNote, where);
      if (gas) {
        endRemark();
        gases.push(gas);
      } else if (lg.group !== 'none') {
        fail(`${where}: "${item.text}" in the ${lg.label ?? ''} list is not a gas`);
      } else {
        from ??= item;
        to = item;
      }
    }
    endRemark();
  }
  return { basis, gases, remarks };
}

// ---------------------------------------------------------------------------------------------------
// Moons listed on a planet's page
// ---------------------------------------------------------------------------------------------------

/**
 * A table of moons, either way round: one column per moon under its name (Mars: label | Phobos |
 * Deimos) or one row per moon under the parameter headers (Pluto: name | Semi-Major Axis (km) | …).
 * Which one it is follows from where the parameter labels are; an unknown label still fails.
 */
function satelliteTable(table: HTMLElement, where: string): Satellite[] {
  const [head, ...trs] = table.querySelectorAll('tr');
  const [corner, ...columns] = cellsOf(head ?? fail(`${where}: empty table`)).map((c) =>
    normalizeText(c.html),
  );
  if (corner !== '' || columns.length === 0)
    fail(`${where}: unexpected header ${JSON.stringify([corner, ...columns])}`);
  const lines = trs.map((tr) => cellsOf(tr).map((c) => normalizeText(c.html)));
  for (const cells of lines) {
    if (cells.length !== columns.length + 1) fail(`${where}: row ${JSON.stringify(cells)}`);
  }
  const row = (label: string, value: string, moon: string): Row => {
    if (value === '') fail(`${where}: no value for ${moon} "${label}"`);
    return toRow({ key: keyed(SATELLITE_KEYS, label, where), label, value });
  };
  const isLabel = (text: string): boolean => hasKey(SATELLITE_KEYS, labelParts(text).label);
  if (columns.some(isLabel)) {
    return lines.map(([name = '', ...values]) => ({
      name,
      rows: values.map((value, i) => row(columns[i] ?? '', value, name)),
    }));
  }
  return columns.map((name, i) => ({
    name,
    rows: lines.map(([label = '', ...values]) => row(label, values[i] ?? '', name)),
  }));
}

// ---------------------------------------------------------------------------------------------------
// Body page
// ---------------------------------------------------------------------------------------------------

function parseBody(id: BodyId, url: string): BodySheet {
  const file = BODY_PAGES[id];
  const html = readRaw(file);
  const title = normalizeText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const name = /^(.+) Fact Sheet$/.exec(title)?.[1] ?? fail(`${file}: title "${title}"`);

  let bulk: Row[] | undefined;
  let orbital: Row[] | undefined;
  let orbitalCaption: string | undefined;
  let observational: Row[] = [];
  let elements: Row[] | undefined;
  let pole: Row[] | undefined;
  let poleCaption: string | undefined;
  let magnetosphere: Row[] | undefined;
  let magnetosphereCaption: string | undefined;
  const magnetosphereNotes: string[] = [];
  let atmosphere: Row[] | undefined;
  let atmosphereCaption: string | undefined;
  let composition: Composition | undefined;
  const satellites: SatelliteBlock[] = [];
  const footnotes: string[] = [];

  const seen = new Set<string>();
  for (const s of sectionize(pieces(parseHtml(html)), classifyBodyHeading, 'preamble')) {
    if (s.kind === 'ignore') continue;
    const where = `${file} "${s.heading}"`;
    if (s.kind !== 'preamble' && s.kind !== 'satellites') {
      if (seen.has(s.kind)) fail(`${where}: second ${s.kind} section`);
      seen.add(s.kind);
    }
    const tables = s.items.filter(isTable);
    const pres = s.items.filter(isPre);
    const preIndex = s.items.findIndex(isPre);
    const texts = (from = 0, to = s.items.length): string[] =>
      s.items.slice(from, to).flatMap((p) => (p.kind === 'para' ? paragraphTexts(p) : []));
    const onePre = (): string => {
      const [pre, ...extra] = pres;
      if (!pre || extra.length || tables.length) fail(`${where}: expected one <pre> block`);
      return pre.raw;
    };

    switch (s.kind) {
      case 'preamble': {
        const stray = texts();
        if (stray.length)
          fail(`${file}: unexpected text before the data: ${JSON.stringify(stray)}`);
        break;
      }
      case 'bulk':
      case 'orbital': {
        const [table] = tables;
        const [pre, ...extraPres] = pres;
        let rows: Row[];
        if (table && tables.length === 1) {
          rows = comparisonRows(table.el, s.kind, name, where);
          // Moon: its observational rows and the perigee/apogee footnote follow the orbit table.
          if (pre && s.kind === 'orbital' && extraPres.length === 0) {
            const obs = observationalBlock(pre.raw, where);
            observational = obs.rows;
            footnotes.push(...obs.footnotes);
          } else if (pre) fail(`${where}: unexpected <pre> block`);
        } else if (!table && pre && extraPres.length === 0) {
          rows = columnRows(pre.raw, ROW_KEYS[s.kind], where); // Earth
        } else {
          return fail(`${where}: expected one table or one <pre> block`);
        }
        if (s.kind === 'bulk') bulk = rows;
        else {
          orbital = rows;
          const caption = s.heading.replace(/^Orbital parameters\s*/, '');
          if (caption) orbitalCaption = caption;
        }
        footnotes.push(...texts());
        break;
      }
      case 'observational': {
        const obs = observationalBlock(onePre(), where);
        observational = obs.rows;
        footnotes.push(...obs.footnotes, ...texts());
        break;
      }
      case 'elements':
        elements = columnRows(onePre(), ROW_KEYS.elements, where);
        footnotes.push(...texts());
        break;
      case 'pole':
        pole = poleRows(onePre(), where);
        poleCaption = s.heading;
        footnotes.push(...texts());
        break;
      case 'magnetosphere': {
        const raw = onePre();
        const models = texts(0, preIndex);
        for (const m of models) if (!/\bModel\b/.test(m)) fail(`${where}: "${m}" before the block`);
        magnetosphere = magnetosphereRows(models, raw, where);
        magnetosphereCaption = s.heading;
        // Printed under the block, before its closing rule: Saturn's caveat on the dipole and the
        // radius the rows are measured in ("Rh denotes Mercurian model radius, …").
        magnetosphereNotes.push(...texts(preIndex + 1));
        break;
      }
      case 'atmosphere': {
        const atm = atmosphereBlock(onePre(), where);
        atmosphere = atm.rows;
        composition = atm.composition;
        atmosphereCaption = s.heading;
        footnotes.push(...texts());
        break;
      }
      case 'satellites': {
        let moons: Satellite[];
        if (tables.length === 1 && pres.length === 0 && tables[0]) {
          moons = satelliteTable(tables[0].el, where);
        } else if (tables.length === 0 && pres.length === 1) {
          moons = [{ name: s.heading, rows: columnRows(onePre(), SATELLITE_KEYS, where) }]; // Charon
        } else {
          return fail(`${where}: expected one table or one <pre> block`);
        }
        for (const m of moons) assertUniqueKeys(m.rows, `${where} ${m.name}`);
        satellites.push({ caption: s.heading, satellites: moons, notes: texts() });
        break;
      }
    }
  }
  if (!bulk || !orbital) return fail(`${file}: missing bulk or orbital parameters`);
  for (const [block, rows] of Object.entries({ bulk, orbital, observational, elements, pole })) {
    if (rows) assertUniqueKeys(rows, `${file} ${block}`);
  }

  const ringFile = RING_PAGES[id];
  return {
    id,
    name,
    url,
    lastUpdated: lastUpdated(html, file),
    bulk,
    orbital,
    ...(orbitalCaption !== undefined ? { orbitalCaption } : {}),
    observational,
    ...(elements ? { elements } : {}),
    ...(pole ? { pole, poleCaption } : {}),
    ...(magnetosphere ? { magnetosphere, magnetosphereCaption } : {}),
    ...(magnetosphereNotes.length ? { magnetosphereNotes } : {}),
    ...(atmosphere ? { atmosphere, atmosphereCaption } : {}),
    ...(composition ? { composition } : {}),
    ...(satellites.length ? { satellites } : {}),
    footnotes,
    ...(ringFile ? { rings: parseRings(ringFile, urlOf(ringFile)) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// Ring fact sheets
// ---------------------------------------------------------------------------------------------------

function parseRings(file: string, url: string): RingSheet {
  const html = readRaw(file);
  const ps = pieces(parseHtml(html));
  const at = ps.findIndex((p) => p.kind === 'table');
  const table = ps[at];
  if (!table || table.kind !== 'table') return fail(`${file}: no table`);
  const [head, ...trs] = table.el.querySelectorAll('tr');
  const [corner, ...headerCells] = cellsOf(head ?? fail(`${file}: empty table`));
  const headers = headerCells.map((c) => normalizeText(c.html));
  if (
    normalizeText(corner?.html ?? '') !== '' ||
    headers[0] !== 'Radius (km)' ||
    headers[1] !== 'Radius/Eq. radius'
  ) {
    fail(`${file}: unexpected header ${JSON.stringify(headers)}`);
  }

  const rings: Ring[] = [];
  let group: { name: string; indent: number } | undefined;
  for (const tr of trs) {
    const [nameCell, ...cells] = cellsOf(tr);
    const rawName = htmlToText(nameCell?.html ?? '').replace(/\n/g, ' ');
    const indent = rawName.length - rawName.trimStart().length;
    const name = collapse(rawName);
    const data: string[] = [];
    for (const c of cells) {
      const text = normalizeText(c.html);
      if (c.colspan > 1 && text !== '') fail(`${file}: text in a spanned cell of "${name}"`);
      data.push(text, ...Array<string>(c.colspan - 1).fill(''));
    }
    if (data.length > headers.length) fail(`${file}: "${name}" has more cells than headers`);
    const blank = data.every((d) => d === '');
    if (name === '' && blank) continue; // spacer row (Uranus)
    if (name.endsWith(':') && blank) {
      group = { name: name.slice(0, -1).trim(), indent }; // Neptune "Arcs in Adams Ring:"
      continue;
    }
    if (name === '') fail(`${file}: unnamed ring ${JSON.stringify(data)}`);
    if (group && indent <= group.indent) group = undefined;
    const val = (i: number): Val => (data[i] ? parseVal(data[i]) : { text: '', value: null });
    const columns: Record<string, Val> = {};
    headers.forEach((h, i) => {
      if (i >= 2 && data[i]) columns[h] = parseVal(data[i]);
    });
    rings.push({
      name,
      radius: val(0),
      ratio: val(1),
      columns,
      ...(group ? { group: group.name } : {}),
    });
  }

  const notes: string[] = [];
  for (const p of ps.slice(at + 1)) {
    if (p.kind === 'heading') break;
    if (p.kind === 'para') notes.push(...paragraphTexts(p));
    else if (p.kind === 'pre') notes.push(...paragraphsOf(preLines(p.raw)));
    else fail(`${file}: second table`);
  }
  return { url, lastUpdated: lastUpdated(html, file), headers, rings, notes };
}

// ---------------------------------------------------------------------------------------------------
// Main table (index.html) and its notes (planetfact_notes.html)
// ---------------------------------------------------------------------------------------------------

function parseMain(url: string): MainTable {
  return parseFactTable(PAGES.main, 'planetfact_notes.html', url, Object.keys(MAIN_KEYS).length);
}

/**
 * planet_table_ratio.html: the same layout as the main table, with each value divided by Earth's
 * and its rows linked to planetfact_ratio_notes.html. It has no temperature or inclination rows.
 */
function parseRatio(url: string): MainTable {
  return parseFactTable(PAGES.ratio, 'planetfact_ratio_notes.html', url, 18);
}

/** A 10-body table whose row headings link to a notes page (main table or ratio table). */
function parseFactTable(file: string, notesPage: string, url: string, rowCount: number): MainTable {
  const html = readRaw(file);
  const ps = pieces(parseHtml(html));
  const title = ps.find((p): p is HeadingPiece => p.kind === 'heading' && p.level === 1)?.text;
  const at = ps.findIndex((p) => p.kind === 'table');
  const table = ps[at];
  if (!title || !table || table.kind !== 'table') return fail(`${file}: no title or table`);
  const [head, ...trs] = table.el.querySelectorAll('tr');
  const columns = cellsOf(head ?? fail(`${file}: empty table`))
    .slice(1)
    .map((c) => /href="([a-z]+)fact\.html"/.exec(c.html)?.[1]);
  if (columns.join() !== BODY_IDS.join()) fail(`${file}: columns ${columns.join()}`);

  const rows: MainRow[] = [];
  for (const tr of trs) {
    const [first, ...cells] = cellsOf(tr);
    const link = new RegExp(`href="${notesPage.replace('.', '\\.')}#([a-z]+)">([^<]*)</a>`).exec(
      first?.html ?? '',
    );
    if (!link) {
      // The column header is repeated under the table.
      if (
        cells.map((c) => /href="([a-z]+)fact\.html"/.exec(c.html)?.[1]).join() !== BODY_IDS.join()
      ) {
        fail(`${file}: row without a notes link`);
      }
      continue;
    }
    const term = normalizeText(link[2] ?? '');
    const label = normalizeText(first?.html ?? '');
    const unit = unitOf(label);
    if (cells.length !== BODY_IDS.length) fail(`${file}: "${label}" has ${cells.length} values`);
    const values = Object.fromEntries(
      BODY_IDS.map((id, i) => [id, parseVal(normalizeText(cells[i]?.html ?? ''))]),
    ) as Record<BodyId, Val>;
    rows.push({
      key: lookupKey(MAIN_KEYS, term, file),
      label,
      ...(unit !== undefined ? { unit } : {}),
      anchor: link[1] ?? '',
      values,
    });
  }
  assertUniqueKeys(rows, file);
  if (rows.length !== rowCount) fail(`${file}: ${rows.length} rows`);

  // "* - See the Fact Sheet Notes." (the links below it are navigation).
  const notes = ps
    .slice(at + 1)
    .flatMap((p) => (p.kind === 'para' ? paragraphTexts(p) : []))
    .filter((t) => t.startsWith('*'));
  return { url, lastUpdated: lastUpdated(html, file), title, rows, notes };
}

/** planetfact_notes.html: one "<a name=…></a><p><b>Term</b> (units) - text</p>" per main-table anchor. */
function parseMainNotes(rows: MainRow[]): { main: Record<string, Definition>; notes: string[] } {
  return parseRowNotes(PAGES.mainNotes, rows);
}

/** One "<a name=…></a><p><b>Term</b> - text</p>" per row anchor, as on both table notes pages. */
function parseRowNotes(
  file: string,
  rows: MainRow[],
  aliases: Record<string, string> = {},
): { main: Record<string, Definition>; notes: string[] } {
  const html = readRaw(file);
  const byAnchor = new Map<string, Definition>();
  let end = 0;
  for (const m of html.matchAll(/<a name="([^"]+)"><\/a>\s*<p>([\s\S]*?)<\/p>/gi)) {
    const text = normalizeText(m[2] ?? '');
    const bold = normalizeText(/<b>([\s\S]*?)<\/b>/i.exec(m[2] ?? '')?.[1] ?? '');
    const parts = /^(.+?)\s+-\s+(.+)$/.exec(text);
    if (!bold || !parts?.[1]?.startsWith(bold))
      fail(`${file}#${m[1] ?? ''}: "${text.slice(0, 60)}"`);
    byAnchor.set(m[1] ?? '', { term: parts?.[1] ?? '', text: parts?.[2] ?? '' });
    end = (m.index ?? 0) + m[0].length;
  }
  const main: Record<string, Definition> = {};
  const anchorOf = (a: string) => aliases[a] ?? a;
  for (const row of rows) {
    main[row.key] =
      byAnchor.get(anchorOf(row.anchor)) ?? fail(`${file}: no definition #${row.anchor}`);
  }
  const used = new Set(rows.map((r) => anchorOf(r.anchor)));
  for (const anchor of byAnchor.keys()) if (!used.has(anchor)) fail(`${file}: unused #${anchor}`);
  // The closing paragraph: what "terrestrial planets" and "gas giants" refer to.
  const closing =
    /^\s*<p>([\s\S]*?)<\/p>/i.exec(html.slice(end))?.[1] ?? fail(`${file}: no closing note`);
  return { main, notes: paragraphTexts({ kind: 'para', html: closing }) };
}

// ---------------------------------------------------------------------------------------------------
// Sheet notes (fact_notes.html)
// ---------------------------------------------------------------------------------------------------

type NotesSection =
  'preamble' | 'intro' | NotesBlock | 'observational' | 'related' | 'subAndSuperscripts' | 'ignore';

function classifyNotesHeading(level: number, text: string): NotesSection {
  if (level === 1) return 'intro';
  if (level === 3) {
    const kinds: Record<string, NotesSection> = {
      'Bulk Parameters': 'bulk',
      'Orbital parameters': 'orbital',
      'Observational Parameters': 'observational',
      'Mean orbital elements': 'elements',
      Magnetospheres: 'magnetosphere',
      Atmospheres: 'atmosphere',
      'Related Definitions': 'related',
    };
    const kind = kinds[text];
    if (kind) return kind;
  }
  // "Sub- and Superscripts" explains the page's "10^24" notation: definitions.notes keeps it.
  if (level === 2 && text === 'Sub- and Superscripts') return 'subAndSuperscripts';
  if (level === 6) return 'ignore';
  return fail(`${PAGES.sheetNotes}: unknown heading h${level} "${text}"`);
}

interface TermEntry {
  term: string;
  lines: string[];
}

/** Column-style sections (bulk, orbital, elements): "Term   definition", continued on indented lines. */
function columnTerms(
  lines: Line[],
  block: 'bulk' | 'orbital' | 'elements',
): { entries: TermEntry[]; intro: string[] } {
  const terms = [
    ...Object.keys(ROW_KEYS[block]),
    ...Object.keys(NOTES_TERM_KEYS[block]),
    ...NOTES_UNKEYED_TERMS,
  ].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const entries: TermEntry[] = [];
  const intro: Line[] = [];
  for (const l of lines) {
    const lower = l.text.toLowerCase();
    const term =
      l.indent === 0
        ? terms.find(
            (t) => lower.startsWith(t.toLowerCase()) && /^(\s|$)/.test(l.text.slice(t.length)),
          )
        : undefined;
    const current = entries[entries.length - 1];
    if (term)
      entries.push({ term: l.text.slice(0, term.length), lines: [l.text.slice(term.length)] });
    else if (!current)
      intro.push(l); // the section's introduction
    else if (l.text && l.indent === 0)
      fail(`${PAGES.sheetNotes} ${block}: unknown term in "${l.text}"`);
    else current.lines.push(l.text);
  }
  return { entries, intro: paragraphsOf(intro) };
}

/** Colon-style sections (magnetospheres, atmospheres): "Term:  definition", continued below. */
function colonTerms(lines: Line[], block: 'magnetosphere' | 'atmosphere'): TermEntry[] {
  const entries: TermEntry[] = [];
  for (const l of lines) {
    if (l.text === '') continue;
    const split = l.indent === 0 ? splitColon(l.text) : undefined;
    const current = entries[entries.length - 1];
    if (split) entries.push({ term: split[0], lines: [split[1]] });
    else if (current) current.lines.push(l.text);
    else fail(`${PAGES.sheetNotes} ${block}: "${l.text}"`);
  }
  return entries;
}

/** "Related Definitions": "Term - definition", continued on indented lines. */
function relatedTerms(lines: Line[]): Definition[] {
  const out: Definition[] = [];
  for (const l of lines) {
    if (l.text === '') continue;
    const m = l.indent === 0 ? /^(.+?) - (.+)$/.exec(l.text) : null;
    const current = out[out.length - 1];
    if (m) out.push({ term: collapse(m[1] ?? ''), text: collapse(m[2] ?? '') });
    else if (current) current.text = collapse(`${current.text} ${l.text}`);
    else fail(`${PAGES.sheetNotes} related: "${l.text}"`);
  }
  return out;
}

/**
 * The page's introduction: the sentence that introduces the source list ("Most values listed in the
 * factsheets are from the following sources:"), the indented sources, the caveat paragraph.
 */
function sourcesAndCaveat(lines: Line[]): { heading: string; sources: string[]; caveat: string } {
  const [intro, ...rest] = paragraphBlocks(lines);
  const [heading, ...sources] = intro ?? [];
  const caveat = rest.map((p) => collapse(p.map((l) => l.text).join(' ')));
  const ok =
    heading?.text.endsWith('following sources:') &&
    sources.length > 0 &&
    sources.every((l) => l.indent > 0) &&
    caveat.length === 1 &&
    caveat[0]?.startsWith('Note that');
  if (!ok || !heading) return fail(`${PAGES.sheetNotes}: unexpected source list / caveat`);
  return { heading: heading.text, sources: sources.map((l) => l.text), caveat: caveat[0] ?? '' };
}

/** Lines grouped into blank-line separated paragraphs. */
function paragraphBlocks(lines: Line[]): Line[][] {
  const out: Line[][] = [];
  let cur: Line[] = [];
  for (const l of [...lines, { indent: 0, text: '' }]) {
    if (l.text) cur.push(l);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  return out;
}

function parseSheetNotes(): Omit<Definitions, 'pages' | 'main' | 'notes' | 'unkeyed'> & {
  notes: Record<string, string[]>;
  unkeyed: Record<string, Definition[]>;
} {
  const file = PAGES.sheetNotes;
  const html = readRaw(file);
  const sheet: Record<string, Definition> = {};
  const related: Definition[] = [];
  const unkeyed: Record<string, Definition[]> = {};
  const notes: Record<string, string[]> = {};
  let intro: { sources: string[]; caveat: string } | undefined;

  const define = (block: NotesBlock, e: TermEntry): void => {
    const term = collapse(e.term);
    const text = collapse(e.lines.join(' '));
    if (NOTES_UNKEYED_TERMS.includes(term)) {
      (unkeyed[block] ??= []).push({ term, text });
      return;
    }
    const dict: KeyDict =
      block === 'magnetosphere'
        ? MAGNETOSPHERE_KEYS
        : block === 'atmosphere'
          ? ATMOSPHERE_KEYS
          : ROW_KEYS[block];
    const extra = NOTES_TERM_KEYS[block];
    const key = hasKey(extra, term)
      ? lookupKey(extra, term, file)
      : lookupKey(dict, term, `${file} ${block}`);
    if (sheet[key]) fail(`${file}: two definitions for "${key}"`);
    sheet[key] = { term, text };
  };

  for (const s of sectionize(pieces(parseHtml(html)), classifyNotesHeading, 'preamble')) {
    if (s.kind === 'ignore' || s.kind === 'preamble') continue;
    if (s.kind === 'subAndSuperscripts') {
      // One plain paragraph; the bulleted link below it is navigation.
      const texts = s.items.flatMap((p) => (p.kind === 'para' ? paragraphTexts(p) : []));
      if (texts.length !== 1 || s.items.some((p) => p.kind !== 'para'))
        fail(`${file} "${s.heading}": expected one paragraph, got ${JSON.stringify(texts)}`);
      notes.subAndSuperscripts = texts;
      continue;
    }
    const [pre, ...extra] = s.items.filter(isPre);
    if (!pre || extra.length) fail(`${file} "${s.heading}": expected one <pre> block`);
    const lines = preLines(pre.raw);
    switch (s.kind) {
      case 'intro': {
        const { heading, ...rest } = sourcesAndCaveat(lines);
        intro = rest;
        notes.intro = [heading];
        break;
      }
      case 'bulk':
      case 'orbital':
      case 'elements': {
        const { entries, intro: paragraphs } = columnTerms(lines, s.kind);
        for (const e of entries) define(s.kind, e);
        if (paragraphs.length) notes[s.kind] = paragraphs;
        break;
      }
      case 'observational':
        notes.observational = paragraphsOf(lines);
        break;
      case 'magnetosphere':
      case 'atmosphere':
        for (const e of colonTerms(lines, s.kind)) define(s.kind, e);
        break;
      case 'related':
        related.push(...relatedTerms(lines));
        break;
    }
  }
  if (!intro) return fail(`${file}: no source list`);
  for (const term of NOTES_UNKEYED_TERMS) {
    if (!Object.values(unkeyed).some((list) => list.some((d) => d.term === term)))
      fail(`${file}: "${term}" is no longer defined (remove it from NOTES_UNKEYED_TERMS)`);
  }
  return {
    sheet,
    related,
    sources: intro.sources,
    caveat: intro.caveat,
    notes,
    unkeyed,
  };
}

// ---------------------------------------------------------------------------------------------------
// Assembly and output
// ---------------------------------------------------------------------------------------------------

interface Manifest {
  source: string;
  fetchedAt: string;
  files: { file: string; url: string; sha256: string }[];
}

let manifestCache: Manifest | undefined;

function manifest(): Manifest {
  manifestCache ??= JSON.parse(readFileSync(resolve(RAW_DIR, 'manifest.json'), 'utf8')) as Manifest;
  return manifestCache;
}

function urlOf(file: string): string {
  const entry = manifest().files.find((f) => f.file === file) ?? fail(`manifest.json: no ${file}`);
  const sha256 = createHash('sha256')
    .update(readFileSync(resolve(RAW_DIR, file)))
    .digest('hex');
  if (sha256 !== entry.sha256)
    fail(`data/raw/${file} differs from manifest.json (run npm run data:fetch)`);
  return entry.url;
}

/** A notes page's address and NASA's "Last Updated" date (urlOf checks the page's hash first). */
function notesPage(file: string): NotesPage {
  const url = urlOf(file);
  return { url, lastUpdated: lastUpdated(readRaw(file), file) };
}

/** Parses the whole snapshot. Pure: the same data/raw/ always gives the same object. */
export function buildFactSheet(): FactSheet {
  // Dated like every other source; this also checks the three pages against the manifest before
  // any of them is parsed.
  const pages: Definitions['pages'] = {
    main: notesPage(PAGES.mainNotes),
    ratio: notesPage(PAGES.ratioNotes),
    sheet: notesPage(PAGES.sheetNotes),
  };
  const main = parseMain(urlOf(PAGES.main));
  const mainNotes = parseMainNotes(main.rows);
  const ratio = parseRatio(urlOf(PAGES.ratio));
  // NASA's ratio table links "Obliquity to Orbit" to #orbo, but its notes page names that
  // definition "Axial Tilt" under #axit (the link is broken on NASA's site).
  const ratioNotes = parseRowNotes(PAGES.ratioNotes, ratio.rows, { orbo: 'axit' });
  const sheetNotes = parseSheetNotes();
  const bodies = Object.fromEntries(
    BODY_IDS.map((id) => [id, parseBody(id, urlOf(BODY_PAGES[id]))]),
  ) as Record<BodyId, BodySheet>;
  const definitions: Definitions = {
    pages,
    main: mainNotes.main,
    ratio: ratioNotes.main,
    sheet: sheetNotes.sheet,
    related: sheetNotes.related,
    sources: sheetNotes.sources,
    caveat: sheetNotes.caveat,
    notes: { main: mainNotes.notes, ...sheetNotes.notes },
    unkeyed: sheetNotes.unkeyed,
  };
  return {
    source: manifest().source,
    retrieved: manifest().fetchedAt,
    main,
    ratio,
    bodies,
    definitions,
  };
}

/** factsheet.json as written: 2-space JSON in the repo's Prettier style, so format checks agree. */
export async function renderJson(sheet: FactSheet): Promise<string> {
  const options = (await prettier.resolveConfig(JSON_OUT)) ?? {};
  return prettier.format(JSON.stringify(sheet, null, 2), {
    ...options,
    filepath: JSON_OUT,
    parser: 'json',
  });
}

const csvField = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** data/factsheet-main.csv: key, label, unit, then each body's cell as printed (value + marker). */
export function mainCsv(main: MainTable): string {
  const header = ['key', 'label', 'unit', ...BODY_IDS];
  const lines = main.rows.map((r) => [
    r.key,
    r.label,
    r.unit ?? '',
    ...BODY_IDS.map((id) => r.values[id].text + (r.values[id].note ?? '')),
  ]);
  return [header, ...lines].map((cells) => cells.map(csvField).join(',')).join('\n') + '\n';
}

async function main(): Promise<void> {
  const sheet = buildFactSheet();
  writeFileSync(JSON_OUT, await renderJson(sheet));
  writeFileSync(CSV_OUT, mainCsv(sheet.main));
  const bodies = Object.values(sheet.bodies);
  const rows = bodies.reduce(
    (n, b) =>
      n +
      [b.bulk, b.orbital, b.observational, b.elements, b.pole, b.magnetosphere, b.atmosphere]
        .map((r) => r?.length ?? 0)
        .reduce((a, c) => a + c, 0),
    0,
  );
  const gases = bodies.reduce((n, b) => n + (b.composition?.gases.length ?? 0), 0);
  const rings = bodies.reduce((n, b) => n + (b.rings?.rings.length ?? 0), 0);
  console.log(
    `${sheet.main.rows.length} main rows, ${bodies.length} bodies, ${rows} rows, ${gases} gases, ` +
      `${rings} rings, ${Object.keys(sheet.definitions.sheet).length + Object.keys(sheet.definitions.main).length} definitions`,
  );
  console.log('→ src/data/factsheet.json, data/factsheet-main.csv');
}

// Run only as `node scripts/parse-nasa.ts`, not when imported (tests). Real paths, so a symlinked
// checkout still runs.
const realPath = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
if (process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url))) {
  await main();
}
