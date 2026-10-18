# Concept

**Planetary** redraws NASA's [Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/)
as a set of engineering drawings: a schematic of the solar system, and one sheet for each of the ten
bodies in NASA's table. Every number that has a shape is drawn; the rest are listed exactly as NASA
gives them.

This file records the decisions behind the design, so that later changes can be checked against them.

## The one rule

**A line is sized by the NASA string printed on it.** A dimension reading `Ø12 756` is drawn from the
string `12,756` in NASA's table, not from a nearby number on another page. Anything we compute is shown
in parentheses with its formula, e.g. `(9.35°) = 90° − 80.65°`. Anything NASA does not give (a dipole
offset's direction, the Moon's node longitude, a rotation phase) is not drawn and the sheet says so.

NASA's pages disagree with each other in about twenty places (Pluto's main-table eccentricity 0.244
against the 0.2488 its own perihelion and aphelion imply; Venus's rotation −5832.5 h on the table and
−5832.6 h on its page). We do not fix them. Each value is shown where NASA prints it, and the conflicts
are listed in [data/discrepancies.md](../data/discrepancies.md).

## Sheets

The set has 11 sheets: sheet 1 is the home page, sheets 2–11 are the bodies in NASA's order (Mercury,
Venus, Earth, Moon, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto).

**Sheet 1, the home page.** A schematic of the solar system and nothing else: the orbits, the Sun and
the planets moving at 1 minute = 1 year from today's positions. Pointing at a planet shows its name and
holds the clock; clicking it opens its sheet. The Moon is the ring round the Earth. It is not to scale
and says so: distances from the Sun are compressed (r → R·(r / 7375.9)^0.4) and the planets are symbols
(Ø ∝ √ NASA's diameter, at least 6 px), while directions, inclinations and poles of rotation stay true.
Four corner items: the name, "?", the not-to-scale note, and the date with Pause.

**Sheets 2–11, one body each.** A header with the planet tabs and "?"; under it the drawings and NASA's
table.

- View A: the body. Outline at the 1-bar level for the giants, a 30° graticule (visible half only), the
  rotation axis drawn to the positive pole, the orbit normal, the obliquity, the spin arrow, the
  equatorial diameter, and the rings from NASA's ring sheets. Turntable: drag sideways to turn it.
- Key plan: the orbit, seen normal to its plane, with the Sun at the focus, Earth's orbit as a phantom
  line and the body's position at the epoch.
- Table: NASA's 20 main-table rows for this body, in NASA's order, values verbatim. Rows that have a
  shape carry a dimension mark and light up their geometry; the drawing lights up its row.
- Row popover: NASA's definition, verbatim; the ratio to Earth; the values the drawing takes from the
  body's own page (polar radius and core with the diameter, the dipole with the magnetic field, ring
  edges with the rings); and the places where NASA's pages disagree about this row.
- "?" dialog: the general notes in drafting voice, the source pages with NASA's own "Last Updated"
  dates, the retrieval date, the title block, and the unofficial notice.

Details appear with their row: the polar semi-axis and the core with the diameter, the dipole with
"Global Magnetic Field?", ring radii with "Ring System?", the apsides and their dimensions with
perihelion, aphelion, distance and eccentricity, the edge view with the inclination, and equal-time
ticks with the orbital period.

## What is drawn from where

| Drawn                                              | Source string                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Body size, obliquity, spin rate                    | Main table: Diameter, Obliquity to Orbit, Rotation Period                             |
| Polar semi-axis (giants), core radius, dipole tilt | Body page: Polar radius, Core radius, Dipole tilt                                     |
| Rings                                              | Ring fact sheets, radius column (km), never the ratio column                          |
| Orbit shape                                        | Main table: Perihelion, Aphelion, Orbital Inclination                                 |
| Orbit orientation, position at the epoch           | Body page: Mean Orbital Elements (J2000) and Sidereal orbit period, Kepler's equation |
| Table values, ratio to Earth                       | Main table and ratio table, verbatim                                                  |
| Definitions                                        | planetfact_notes.html, planetfact_ratio_notes.html, fact_notes.html, verbatim         |

Spin uses one convention end to end: the axis is the right-hand-rule pole at NASA's obliquity, and the
body turns counter-clockwise about it at |rotation period|. Venus, Uranus and Pluto therefore turn
clockwise seen from the north side of their orbits. The minus sign of the period is never applied a
second time.

Positions come from NASA's J2000 mean elements, which have no rates. Against JPL Horizons they stay
within 0.5° from 1990 to 2060 (0.3° for every body except Mercury); the sheets say so. There is no date picker.

## Drawing conventions

- ISO 128 line types, two widths at 1:2. Wide: matter (outlines, ring edges). Narrow: everything else.
  Dashed narrow: hidden outlines (rings behind the body, the core). Long-dash dot: axes, centre lines,
  paths of motion. Long-dash double-dot: reference objects (Earth's orbit, the orbit normal).
- ISO 129 dimensions: closed filled arrowheads, text above and parallel to the line, values grouped with
  thin spaces (`12 756`), reference dimensions in parentheses.
- Single-stroke lettering in the drawings (Hershey Simplex), plotted with the same pen as the lines.
- Flat cyanotype paper. No grid, no grain, no glow. One highlight colour, checker's yellow, for the
  parameter in focus.
- Graphic scale bars instead of ratio scales, which mean nothing on a screen of unknown size.
- General notes in drafting voice carry the conventions instead of explanatory copy.

## Deliberately left out

Units toggle, date picker, view buttons, tours, intro animations, sound, photos, starfield, a back
graticule, Earth phantoms on every sheet, section views, NASA's group labels ("gas giants"), and any
"dwarf planet" or "ice giant" vocabulary that is not on NASA's pages. Content that changes on hover
(other than the planet names on the home page), panels that open by pushing the page down, and a
comparison table on the home page.

## Interaction

On a body's sheet, content changes only on a click, a tap, Enter or Space; hovering changes only the
cursor and a faint row wash. A row or a drawn line selects its parameter: the geometry turns yellow and
NASA's definition opens in a popover under the row, or above it when there is more room there, within
the table column (a sheet at the bottom of a phone held upright). It closes with ×, Esc, a second click
or a click on blank paper. While it is open, ‹ › step to the previous or next row, above the table on
the desktop layout and in the popover's header elsewhere; the stepper above the table stays under the
pointer as the page scrolls. ↑ ↓ step from the keyboard. Nothing that opens pushes the layout. Drag
sideways on view A to turn it, double-click to reset. The tabs and ← → move between bodies and keep the
selected row. A pause button stops the motion; reduced-motion settings start paused. Deep links such as
`/saturn/#obliquity` open a sheet with that row selected.

## Build

Vite and TypeScript, no UI framework, no runtime dependencies besides the font. A small 3D→SVG renderer
(orthographic camera, analytic hidden lines for spheroids and rings, ISO dimensioning) draws everything
as vectors. NASA's pages are snapshotted in `data/raw/` and parsed into `src/data/factsheet.json`; tests
check every parsed value against its own cell. Every sheet is a static page with its own title,
description and Open Graph image. Media for posts is rendered from the app itself.
