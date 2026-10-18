// Shape of src/data/factsheet.json, produced by scripts/parse-nasa.ts from the NASA snapshot in data/raw/.
//
// Rule of the project: every value shown on a sheet is NASA's. `text` keeps the string exactly as the
// page prints it (so precision, "~", "Unknown" and ranges survive); `value` is the number it states,
// for drawing. Nothing in this file is computed or rounded by us.

export const BODY_IDS = [
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
] as const;

export type BodyId = (typeof BODY_IDS)[number];

/** One printed value. */
export interface Val {
  /**
   * The value exactly as printed: HTML tags and entities removed, whitespace collapsed, superscript and
   * subscript digits written as Unicode (10²⁴, H₂O), the footnote marker moved to `note`.
   * Examples: "0.64169", "1,432.041", "-5832.6", "16,298.", "~65.", "Unknown", "18.28 - 28.58", "Yes".
   */
  text: string;
  /**
   * The number `text` states when it states exactly one number (commas removed), else null. A power
   * of ten is one number: "3 x 10⁻⁶" → 0.000003, "10⁵" → 100000. A formula such as the pole's
   * "40.589 - 0.036T" states several, so its value is null.
   */
  value: number | null;
  /**
   * A leading qualifier when printed: "~", "<", ">", "<~", ">>", "<<". `value` is still filled. A
   * trailing sign (Uranus's rings: "~0.4-", "~0.3+") stays in `text` only.
   */
  qualifier?: string;
  /** Both ends when `text` is a range such as "89,400 - 123,000"; `value` is then null. */
  range?: [number, number];
  /** Footnote marker printed next to the value, e.g. "*" or "**". */
  note?: string;
}

/** One row of a NASA table or of a "label   value" block. */
export interface Row {
  /** Stable camelCase key (see ROW_KEYS in scripts/parse-nasa.ts); unknown labels fail the parse. */
  key: string;
  /**
   * Label exactly as NASA prints it, e.g. "Mass (10²⁴ kg)", "Equatorial radius (1 bar level) (km)";
   * "" for a line printed without one (Mercury's magnetosphere model, "MESSENGER Model 2010").
   */
  label: string;
  /** Heading the row sits under inside a block, e.g. "Distance from Earth" for "Minimum (10⁶ km)". */
  group?: string;
  /** Unit taken from the label's last parenthesis when it is a unit, e.g. "10²⁴ kg", "km", "deg". */
  unit?: string;
  /** Footnote marker printed on the label itself, e.g. Mars "Tropical orbit period*". */
  note?: string;
  body: Val;
  /** The Earth column of a per-body comparison table. */
  earth?: Val;
  /** NASA's "Ratio (Body/Earth)" column; "-" and blank cells are left out. */
  ratio?: Val;
}

/** A gas in an atmospheric composition list. */
export interface Gas {
  /**
   * Name as printed, e.g. "Carbon Dioxide", "Molecular hydrogen", "Helium 4"; "" when only the
   * formula is printed (Earth "CH₄ - 1.94").
   */
  name: string;
  /** Formula as printed, Unicode subscripts, e.g. "CO₂", "⁴He". */
  formula?: string;
  /** Amount as printed, e.g. "95.1", "12,000-200,000", "<40,000". */
  amount: Val;
  /** Unit of `amount`: "%", "ppm", or the page's own unit (e.g. "10⁶/cm²", "particles/cm³"). */
  unit: string;
  /** Uncertainty printed in parentheses after the amount, e.g. "2.4%". */
  uncertainty?: string;
  /** Group the gas is listed under: "major", "minor", or "other". */
  group: 'major' | 'minor' | 'other';
}

export interface Composition {
  /** The heading as printed, e.g. "Atmospheric composition (by volume, dry air):". */
  basis: string;
  gases: Gas[];
  /** Lines of the composition block that are not single gases (trace lists, aerosols, caveats), verbatim. */
  remarks: string[];
}

/** One ring, ringlet or gap from a ring fact sheet. */
export interface Ring {
  /** Name as printed, e.g. "B inner edge", "Cassini division", "Epsilon", "Adams (1989N1R)". */
  name: string;
  /** Radius column (km), e.g. "117,507", "89,400 - 123,000", "~41,900"; empty text when blank. */
  radius: Val;
  /** "Radius/Eq. radius" column. */
  ratio: Val;
  /** The other columns by their printed header, e.g. {"Optical Depth": …, "Width (km)": …}; blank cells left out. */
  columns: Record<string, Val>;
  /** Section the ring is listed under, e.g. "Arcs in Adams Ring". */
  group?: string;
}

export interface RingSheet {
  url: string;
  lastUpdated: string;
  /** Column headers as printed, in order. */
  headers: string[];
  rings: Ring[];
  /** Notes printed under the table, verbatim. */
  notes: string[];
}

/** A moon listed on its planet's page. */
export interface Satellite {
  /** Name as printed, e.g. "Phobos", "Charon (P1)", "Styx (P5)". */
  name: string;
  /**
   * Its values in the page's order (keys: SATELLITE_KEYS in scripts/parse-nasa.ts); `body` holds the
   * moon's value.
   */
  rows: Row[];
}

/**
 * A block of moons on a body page: Mars "Satellites of Mars"; Pluto "Charon (P1)", "Other Moons of
 * Pluto".
 */
export interface SatelliteBlock {
  /** The block's heading as printed. */
  caption: string;
  satellites: Satellite[];
  /**
   * Notes printed under the block, verbatim: "*Mean orbital distance from the center of Mars.",
   * "Orbital values are barycentric".
   */
  notes: string[];
}

export interface BodySheet {
  id: BodyId;
  /** "Mars" */
  name: string;
  url: string;
  /** From "Last Updated: 19 May 2025, DRW" → "19 May 2025". */
  lastUpdated: string;
  bulk: Row[];
  orbital: Row[];
  /** Heading of the orbital block when it is not plain "Orbital parameters", e.g. the Moon's "(for orbit about the Earth)". */
  orbitalCaption?: string;
  observational: Row[];
  /** "Mean Orbital Elements (J2000)"; absent for the Moon. */
  elements?: Row[];
  /** "North Pole of Rotation" (Pluto: "Positive Pole of Rotation"). */
  pole?: Row[];
  poleCaption?: string;
  magnetosphere?: Row[];
  magnetosphereCaption?: string;
  /**
   * Sentences of the magnetosphere block that are not "label: value" rows, verbatim, e.g. "Rs denotes
   * Saturnian model radius, defined here to be 60,330 km".
   */
  magnetosphereNotes?: string[];
  atmosphere?: Row[];
  atmosphereCaption?: string;
  composition?: Composition;
  /** Moons the page lists (Mars, Pluto), in the page's order. */
  satellites?: SatelliteBlock[];
  /** Footnotes and remarks printed on the page outside the blocks above, verbatim (e.g. Mars core radius note). */
  footnotes: string[];
  /** Ring fact sheet, for bodies that have one. */
  rings?: RingSheet;
}

export interface MainRow {
  /** Stable key, e.g. "mass", "rotationPeriod". */
  key: string;
  /** Label as printed, e.g. "Mass (10²⁴kg)". */
  label: string;
  unit?: string;
  /** Anchor of the row's definition on planetfact_notes.html, e.g. "mass". */
  anchor: string;
  values: Record<BodyId, Val>;
}

export interface MainTable {
  url: string;
  lastUpdated: string;
  title: string;
  rows: MainRow[];
  /** Footnote line(s) under the table, verbatim. */
  notes: string[];
}

export interface Definition {
  /** Term as printed, e.g. "Obliquity to Orbit (degrees)". */
  term: string;
  /**
   * NASA's explanation, verbatim (whitespace collapsed): fact_notes.html's own powers keep their caret
   * ("10^24 kilograms", see notes.subAndSuperscripts); its R<sub>equator</sub> is written "R_equator".
   */
  text: string;
}

/** One of NASA's notes pages: its address and NASA's date for it. */
export interface NotesPage {
  url: string;
  /** From "Last Updated: 20 December 2021, DRW" → "20 December 2021". */
  lastUpdated: string;
}

export interface Definitions {
  /**
   * The three notes pages the definitions come from, keyed as the definitions are: `main`
   * planetfact_notes.html, `ratio` planetfact_ratio_notes.html, `sheet` fact_notes.html.
   */
  pages: Record<'main' | 'ratio' | 'sheet', NotesPage>;
  /** planetfact_ratio_notes.html, keyed by the ratio table's row keys. */
  ratio?: Record<string, Definition>;
  /** planetfact_notes.html, keyed by MainRow.key. Footnote paragraphs ("* For the Moon…") are part of `text`. */
  main: Record<string, Definition>;
  /** fact_notes.html, keyed by Row.key where a definition exists. */
  sheet: Record<string, Definition>;
  /** fact_notes.html "Related Definitions" (AU, bar, ecliptic, …). */
  related: Definition[];
  /** fact_notes.html source list (introduced by notes.intro) and caveat paragraph, verbatim. */
  sources: string[];
  caveat: string;
  /**
   * Notes paragraphs that define no single term, verbatim, by section: "intro" (the sentence that
   * introduces `sources`: "Most values listed …"), "orbital", "observational", "elements" (the
   * introductions of those fact_notes.html sections, e.g. the epoch of the orbital values),
   * "subAndSuperscripts" (how the page writes powers, "10^24") and "main" (planetfact_notes.html:
   * what "terrestrial planets" and "gas giants" mean).
   */
  notes?: Record<string, string[]>;
  /**
   * fact_notes.html terms that no Row.key names, verbatim, by the section that defines them: "bulk"
   * (Absolute magnitude (Comets)), "elements" (Longitude).
   */
  unkeyed?: Record<string, Definition[]>;
}

/**
 * A place where NASA prints values that cannot be roundings of one number: two pages against each
 * other, or one page against itself. From src/data/discrepancies.json (written by scripts/ledger.ts;
 * data/discrepancies.md lists them too).
 */
export interface Discrepancy {
  body: BodyId;
  /** The table row whose popover shows it: a main-table key (ringSystem for the ring sheets). */
  key: string;
  /** What is compared, as running text, e.g. "rotation period (h)". */
  what: string;
  /**
   * Each value as printed, or worked out from printed values ("2 × 2440.5 = 4881"), with where it
   * comes from: a page ("venusfact.html", "main table") or a formula ("K − 273.15").
   */
  a: string;
  aSrc: string;
  b: string;
  bSrc: string;
  /**
   * The page (or table) both values come from, when it disagrees with itself, e.g. "main table",
   * "plutofact.html". Absent when two pages disagree.
   */
  within?: string;
  /** What Planetary does about it, e.g. "Planetary draws the rings from the km column." */
  note?: string;
}

export interface FactSheet {
  /** Base URL of the NASA section. */
  source: string;
  /** ISO time the snapshot in data/raw/ was downloaded (data/raw/manifest.json). */
  retrieved: string;
  main: MainTable;
  /** NASA's ratio-to-Earth table (planet_table_ratio.html): 18 of the main table's rows, keyed alike. */
  ratio: MainTable;
  bodies: Record<BodyId, BodySheet>;
  definitions: Definitions;
}
