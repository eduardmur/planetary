# Planetary Blueprints

NASA's [Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/), drawn as a set of
engineering drawings. Every dimension on a sheet is a number from NASA's tables, or is worked out
from one and shows its formula.

Unofficial: not affiliated with or endorsed by NASA.

[Open the drawings](https://eduardmur.github.io/planetary/) ·
[Saturn](https://eduardmur.github.io/planetary/saturn/) ·
[Uranus](https://eduardmur.github.io/planetary/uranus/#magneticField) ·
[Pluto](https://eduardmur.github.io/planetary/pluto/#orbitalInclination)

![Saturn's sheet: the planet turning inside its rings; the obliquity row of NASA's table lights up the 26.7° angle between the axis and the orbit normal](docs/media/saturn.gif)

The set has eleven sheets. The first is a general arrangement: NASA's main table, with the ten bodies
drawn above their columns at one scale and at their real axial tilt. Then there is one sheet each for
Mercury, Venus, Earth, the Moon, Mars, Jupiter, Saturn, Uranus, Neptune and Pluto, in NASA's order.

![The ten bodies at one scale, each turning at 1 second = 1 hour](docs/media/lineup.gif)

## Reading a sheet

- Point at a row of the schedule, or tap it, and the geometry it measures turns yellow. NASA's
  definition of the row appears under the table (on a phone, under the row). Pointing at a drawn line
  finds its row.
- Rows marked ⊢⊣ have a shape and are drawn. The others (mass, density, temperature and so on) are
  listed exactly as NASA gives them and are not drawn.
- View A shows the body from 20° above its orbit plane. Drag it sideways to turn it. Pointing at the
  obliquity turns it into the orbit plane, where the tilt shows at its true size.
- The key plan shows the orbit seen square-on. Pointing at the orbital inclination turns it edge-on, for
  the same reason.
- The lines follow ISO 128:
  - thick: outlines, and the edges of the opaque rings (Saturn's A and B rings, Uranus's ε ring);
  - thin: the latitude and longitude grid, and the fainter rings;
  - dashed: anything hidden, such as rings behind the planet or the core;
  - long dash and dot: axes, the equator and orbits;
  - long dash and two dots: reference lines, such as the orbit normal, Earth's orbit and the magnetic
    dipole, and the faintest rings (optical depth under about 0.01).
- ← and → move between sheets.

![Uranus: the magnetic dipole, tilted 58.6° from the rotation axis, shown when "Global Magnetic Field?" is in focus](docs/media/sheet-uranus-dipole.png)

## What is to scale

- Sizes, tilts, ring radii and orbits are drawn to scale from NASA's values. Each view has its own
  scale bar.
- Every body spins at 1 second = 1 hour. Jupiter turns in 9.9 seconds. Venus takes 97 minutes and
  looks still, which is what it does.
- Positions are for today. They come from NASA's J2000 mean orbital elements and Kepler's equation, and
  stay within 0.5° of JPL Horizons from 1990 to 2060 (0.3° for every body except Mercury).
- In the plan of the whole system, the bodies are symbols and are not to scale.

## The data

`src/data/factsheet.json` holds every value from the NASA pages the sheets use: the main table, the
ratio table, each body's page and the four ring pages. Each value keeps NASA's own text (`"~41,900"`,
`"16,298."`) next to its number, with footnote markers such as `*` in a field of their own. The raw pages are kept in `data/raw/`, with their SHA-256
hashes and the date they were downloaded.

NASA's pages sometimes disagree with each other. For example, the main table gives Pluto's eccentricity
as 0.244, but the perihelion and aphelion in the same table give 0.2488. The sheets do not choose
between them: each value is shown where NASA prints it, and each line is sized by the value printed on
it. [`data/discrepancies.md`](data/discrepancies.md) lists every case where the main table and a body
page disagree, and [DATA.md](DATA.md) explains the sources, the parsing rules and the schema.

The tests check that:

- every parsed value appears verbatim in its source page;
- every drawn size equals the number printed on it;
- Venus, Uranus and Pluto, and only they, turn clockwise seen from the north side of their orbits;
- positions match JPL Horizons.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/planetary/
npm test           # unit tests
npm run build
npm run e2e        # browser tests against the build
```

To refresh the data from NASA, run `npm run data:fetch`, then `npm run data:parse`, then
`node scripts/ledger.ts`. A weekly GitHub Action does the same and opens a pull request when NASA's
pages change.

## How it is made

There is no WebGL and no framework. A small renderer in `src/draw/` projects spheroids, rings and orbits
with an orthographic camera, finds the hidden lines analytically and writes SVG. The lettering uses the
single-stroke Hershey font, drawn with the same pen as the lines. Each sheet is a static HTML page with
its schedule already in place, and the client script is about 20 kB gzipped.

## Credits and licences

- Data: NASA Space Science Data Coordinated Archive (NSSDCA), Planetary Fact Sheets, curated by
  Dr. David R. Williams. The data is a US Government work and in the public domain. The JSON and CSV
  here are CC0.
- Code: [MIT](LICENSE).
- Fonts: the Hershey fonts were originally created by Dr. A. V. Hershey while working at the U. S.
  National Bureau of Standards. IBM Plex Sans Condensed is used under the SIL Open Font License.

See [CREDITS.md](CREDITS.md).
