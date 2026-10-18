// The home page: a schematic of the solar system whose bodies link to their pages, four items in the
// frame's corners, and everything else (notes, sources, data) behind "?".

import { BODY_SHEETS, SHEET_COUNT, type Sheet } from '../content/sheets.ts';
import { DISCREPANCIES, FACTS } from '../data/index.ts';
import { orreryModel, type OrreryModel } from '../data/orrery.ts';
import { MIN_SYMBOL, RADIAL_POWER } from '../views/orrery.ts';
import {
  NOTES_MAIN,
  NOTES_RATIO,
  NOTES_SHEET,
  esc,
  infoButton,
  infoDialog,
  isoDate,
  titleLine,
  type PageCtx,
  type Rendered,
} from './common.ts';

const notesPages = FACTS.definitions.pages;

/** How the schematic is drawn, in drafting voice. */
function notes(m: OrreryModel): string[] {
  return [
    'SCHEMATIC, NOT TO SCALE. SEEN FROM 30–60° ABOVE THE ECLIPTIC (THE ANGLE FITS THE WINDOW), ♈︎ TO THE RIGHT.',
    `DISTANCES FROM THE SUN COMPRESSED: A POINT AT r (10⁶ km) IS DRAWN AT R·(r / ${m.qMaxText})^${RADIAL_POWER}, WHERE ${m.qMaxText} IS PLUTO’S APHELION AND R FITS THE WINDOW. DIRECTIONS AND INCLINATIONS ARE TRUE; ORBIT SPACING AND SHAPES ARE NOT.`,
    `BODIES ARE SYMBOLS: SYMBOL DIAMETER GROWS AS THE SQUARE ROOT OF NASA’S DIAMETER, AT LEAST ${MIN_SYMBOL} px. AXES POINT TO NASA’S POLE OF ROTATION (POSITIVE POLE, RIGHT-HAND RULE).`,
    'THE RING ROUND THE EARTH IS THE MOON’S ORBIT, ENLARGED, IN THE ECLIPTIC PLANE. NASA GIVES NO NODE OR PERIGEE LONGITUDE FOR THE MOON: ORIENTATION ARBITRARY, NO POSITION SHOWN.',
    'ORBITS FROM NASA’S MAIN-TABLE PERIHELION, APHELION AND INCLINATION; NODE, PERIHELION DIRECTION AND POSITIONS FROM THE J2000 MEAN ELEMENTS (TWO-BODY): WITHIN 0.5° OF JPL HORIZONS 1990–2060, 0.3° FOR ALL BUT MERCURY.',
    'TIME: TODAY 00:00 UTC, RUNNING AT 1 MIN = 1 YEAR (365.25 d). AT 2060 THE CLOCK RETURNS TO TODAY. POINTING AT A BODY STOPS IT.',
    'NASA: “THE VALUES LISTED ON THE FACTSHEETS ARE NOT ‘OFFICIAL’ VALUES … CARE SHOULD BE EXERCISED WHEN USING THESE VALUES.”',
  ];
}

function about(sheet: Sheet, ctx: PageCtx, m: OrreryModel): string {
  const link = (href: string, text: string) => `<a href="${href}">${text}</a>`;
  const n = DISCREPANCIES.length;
  // sheet.css keeps each data link whole; this one is too long for a phone, so it may also break
  // before its count, and nowhere else.
  const conflicts = `<span class="nowrap">Where NASA’s pages disagree</span> <span class="nowrap">(${n} conflict${n === 1 ? '' : 's'}) ↗</span>`;
  return `<p>NASA’s Planetary Fact Sheet, drawn as a set of engineering drawings. Unofficial: not affiliated with or endorsed by NASA.</p>
      <p class="js-only">Point at a planet for its name; click it to open its sheet. On a phone, tap it.</p>
      <h3>This drawing</h3>
      <ol class="drafting">${notes(m)
        .map((n) => `<li>${esc(n)}</li>`)
        .join('')}</ol>
      <h3>Sources</h3>
      <ul>
        <li>${link(FACTS.main.url, 'NSSDCA Planetary Fact Sheet ↗')} (Last Updated ${isoDate(FACTS.main.lastUpdated)})</li>
        <li>The body and ring fact sheets (dated on each body’s sheet)</li>
        <li>${link(NOTES_MAIN, 'planetfact_notes.html ↗')} ${isoDate(notesPages.main.lastUpdated)} · ${link(NOTES_RATIO, 'planetfact_ratio_notes.html ↗')} ${isoDate(notesPages.ratio.lastUpdated)} · ${link(NOTES_SHEET, 'fact_notes.html ↗')} ${isoDate(notesPages.sheet.lastUpdated)}</li>
        <li>Retrieved <span class="nowrap">${FACTS.retrieved.slice(0, 10)}</span></li>
      </ul>
      <h3>Data and code</h3>
      <p>${link(`${ctx.base}data/factsheet.json`, 'factsheet.json')}&nbsp;· ${link(`${ctx.base}data/factsheet-main.csv`, 'factsheet-main.csv')}&nbsp;· ${link(`${ctx.repo}/blob/main/data/discrepancies.md`, conflicts)}&nbsp;· ${link(ctx.repo, 'Source code ↗')}</p>
      <p class="label">${titleLine([sheet.dwg, `SHEET ${sheet.number} / ${SHEET_COUNT}`, esc(sheet.title.toUpperCase()), esc(sheet.docType), `ISSUED ${ctx.issued}`])}</p>`;
}

export function homeSheet(sheet: Sheet, ctx: PageCtx): Rendered {
  const model = orreryModel(ctx.issued);
  const links = BODY_SHEETS.map(
    (s) =>
      `<li><a href="${ctx.base}${s.slug}/" data-body="${s.id}"><span>${esc(s.title)}</span></a></li>`,
  ).join('');
  const html = `<main class="sheet sheet-home" aria-labelledby="sheet-title">
    <span class="marks" aria-hidden="true"></span>
    <header class="corner tl">
      <h1 id="sheet-title"><svg class="title-lettering" data-text="PLANETARY" data-size="xl" aria-hidden="true"></svg><span class="title-text">Planetary</span></h1>
      <p class="subtitle">NASA’s Planetary Fact Sheet, drawn · unofficial</p>
    </header>
    ${infoButton()}
    <div class="orrery">
      <p class="noscript">The drawing needs JavaScript, which is off or did not load. Every body’s sheet is linked below.</p>
      <svg class="drawing" id="orrery" role="img" aria-label="Schematic of the solar system, not to scale: the planets move on their orbits at 1 minute = 1 year, from today’s positions."></svg>
      <nav class="bodies" aria-label="Bodies"><ol>${links}</ol></nav>
    </div>
    <p class="corner bl label js-only"><span>Not to scale · <span class="nowrap">1 min = 1 year</span></span></p>
    <p class="corner br js-only"><time id="clock"></time> <button type="button" id="pause">Pause</button></p>
    <svg class="title-lettering og-only" data-text="SCHEMATIC · NOT TO SCALE" data-size="l" aria-hidden="true"></svg>
  </main>
  ${infoDialog('Planetary', about(sheet, ctx, model))}`;
  return {
    html,
    data: { sheet: 'home', orrery: model },
    title: 'Planetary — NASA’s Planetary Fact Sheet, drawn',
    description:
      'NASA’s Planetary Fact Sheet drawn as engineering drawings: a moving schematic of the solar system and one sheet for each of its ten bodies, every dimension from NASA’s numbers. Unofficial; not affiliated with NASA.',
    ogAlt:
      'Blueprint-style schematic of the solar system, not to scale, with the planets on their orbits',
  };
}
