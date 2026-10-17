# Concept

**Planetary Blueprints** redraws NASA's [Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/)
as a set of engineering drawings: one sheet per body, plus a general arrangement. Every number that has
a shape is drawn; the rest are listed exactly as NASA gives them.

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

The set has 11 sheets: sheet 1 is the general arrangement, sheets 2–11 are the bodies in NASA's order
(Mercury, Venus, Earth, Moon, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto).

**Sheet 1, general arrangement.** NASA's main table, with the ten bodies drawn as its column heads: one
true scale, each at its real obliquity, each spinning at 1 s = 1 h. Pointing at a row lights up what it
measures in every drawing. Below it, a plan of the orbits at true scale with the positions at the epoch,
and detail A for the inner system.

**Sheets 2–11, one body each.**

- View A: the body. Outline at the 1-bar level for the giants, a 30° graticule (visible half only), the
  rotation axis drawn to the positive pole with an N tick, the orbit normal, the obliquity, the spin arrow,
  the equatorial diameter, the polar semi-axis where flattening is visible, the rings from NASA's ring
  sheets, the core where NASA gives one (Earth, Mars). Turntable: drag sideways to turn it.
- Key plan: the orbit, seen normal to its plane, with the Sun at the focus, perihelion and aphelion
  dimensioned, Earth's orbit as a phantom line and the body's position at the epoch. Pointing at the
  inclination turns the plan edge-on along the line of nodes, where the angle is true size.
- Schedule: NASA's 20 main-table rows for this body, in NASA's order, with NASA's ratio to Earth. Rows
  that have a shape carry a dimension mark and light up their geometry; the drawing lights up its row.
- Notes: NASA's definition of the row in focus, verbatim. By default, the sheet's footnotes.
- Title block: sheet, source pages with NASA's own "Last Updated" dates, retrieval date, epoch, spin
  time scale, "Unofficial — not a NASA product".

Some details only appear when asked for: the magnetic dipole axis when pointing at "Global Magnetic
Field?", ring names and radii when pointing at "Ring System?", equal-time ticks on the orbit when
pointing at the orbital period.

## What is drawn from where

| Drawn                                              | Source string                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Body size, obliquity, spin rate                    | Main table: Diameter, Obliquity to Orbit, Rotation Period                             |
| Polar semi-axis (giants), core radius, dipole tilt | Body page: Polar radius, Core radius, Dipole tilt                                     |
| Rings                                              | Ring fact sheets, radius column (km), never the ratio column                          |
| Orbit shape                                        | Main table: Perihelion, Aphelion, Orbital Inclination                                 |
| Orbit orientation, position at the epoch           | Body page: Mean Orbital Elements (J2000) and Sidereal orbit period, Kepler's equation |
| Schedule values, ratio to Earth                    | Main table and ratio table, verbatim                                                  |
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
"dwarf planet" or "ice giant" vocabulary that is not on NASA's pages.

## Interaction

Drag sideways on view A to turn it, double-click to reset. Point at (or tap, or tab to) a row or a
drawn feature to light it up and read NASA's definition. ← → move between sheets. A pause button stops
the spin; reduced-motion settings stop it too. Deep links such as `/saturn/#obliquity` open a sheet with
that row in focus.

## Build

Vite and TypeScript, no UI framework, no runtime dependencies besides the font. A small 3D→SVG renderer
(orthographic camera, analytic hidden lines for spheroids and rings, ISO dimensioning) draws everything
as vectors. NASA's pages are snapshotted in `data/raw/` and parsed into `src/data/factsheet.json`; tests
check every parsed value against its own cell. Every sheet is a static page with its own title,
description and Open Graph image. Media for posts is rendered from the app itself.
