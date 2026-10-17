// Static HTML for each sheet, rendered at build time. The schedule, notes and title block are real
// HTML (readable without JavaScript, by search engines and by screen readers); the drawings are empty
// <svg> elements that src/main.ts fills from the page's embedded data.

import {
  FACTS,
  body,
  mainRow,
  mainVal,
  ratioVal,
  row,
  type BodyId,
  type Val,
} from '../data/index.ts';
import { bodyModel, keyPlanModel, systemBodies } from '../data/model.ts';
import { BODY_IDS } from '../data/types.ts';
import { PARAMS, SHEET_ONLY } from '../content/params.ts';
import { SHEET_COUNT, SHEETS, bodyName, neighbours, type Sheet } from '../content/sheets.ts';

export interface PageCtx {
  /** Site base path, e.g. "/planetary-blueprints/". */
  base: string;
  /** Absolute site URL with trailing slash, for canonical and Open Graph links. */
  site: string;
  /** Date of issue (build date), YYYY-MM-DD. */
  issued: string;
  repo: string;
}

export interface PageData {
  sheet: Sheet['id'];
  defs: Record<string, { term: string; text: string; src: string }>;
  body?: ReturnType<typeof bodyModel>;
  plan?: ReturnType<typeof keyPlanModel>;
  lineup?: ReturnType<typeof bodyModel>[];
  system?: ReturnType<typeof systemBodies>;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "19 May 2025" → "2025-05-19" (ISO 8601 on the sheets), never broken across lines. */
function isoDate(nasa: string): string {
  const d = new Date(`${nasa} 12:00 UTC`);
  const iso = Number.isNaN(d.getTime()) ? nasa : d.toISOString().slice(0, 10);
  return `<span class="nowrap">${iso}</span>`;
}

/** A value as NASA prints it, with its footnote marker set as a superscript. */
function val(v: Val | undefined): string {
  if (!v || !v.text) return '';
  return `${esc(v.text)}${v.note ? `<span class="fn">${esc(v.note)}</span>` : ''}`;
}

/** Split "Mass (10²⁴kg)" into the name and its unit, for quieter units. */
function label(l: string): string {
  const m = l.match(/^(.*?)\s*(\([^()]*\))?\s*$/);
  if (!m || !m[2]) return esc(l);
  return `${esc(m[1]!)} <span class="unit">${esc(m[2])}</span>`;
}

/** Running text: "the Moon", other bodies by name. */
const named = (id: BodyId, start = false) =>
  id === 'moon' ? (start ? 'The Moon' : 'the Moon') : body(id).name;

const NOTES_MAIN = FACTS.main.url.replace(/index\.html$/, 'planetfact_notes.html');
const NOTES_SHEET = FACTS.source + 'fact_notes.html';

function definitions(): PageData['defs'] {
  const defs: PageData['defs'] = {};
  for (const p of PARAMS) {
    const d = FACTS.definitions.main[p.key];
    if (d) defs[p.key] = { term: d.term, text: d.text, src: NOTES_MAIN };
  }
  for (const [key, s] of Object.entries(SHEET_ONLY)) {
    const d = FACTS.definitions.sheet[key];
    defs[key] = { term: d?.term ?? s.term, text: d?.text ?? '', src: NOTES_SHEET };
  }
  return defs;
}

/** Which rows the drawings on this sheet actually show (the ⊢⊣ mark). */
function drawn(id: BodyId | 'ga'): Map<string, string> {
  const shapes = new Map(
    PARAMS.filter((p) => p.shape.length).map((p) => [p.key, p.shape.join('')]),
  );
  if (id === 'ga') {
    shapes.delete('magneticField'); // the line-up draws no dipoles
    return shapes;
  }
  const b = bodyModel(id);
  const plan = keyPlanModel(id);
  if (!b.rings) shapes.delete('ringSystem');
  if (!b.dipole) shapes.delete('magneticField');
  if (!plan.j2000) {
    shapes.delete('orbitalPeriod');
    shapes.delete('orbitalVelocity');
  }
  return shapes;
}

function head(sheet: Sheet, ctx: PageCtx, description: string): string {
  const url = ctx.site + sheet.slug + (sheet.slug ? '/' : '');
  const title =
    sheet.id === 'ga'
      ? "Planetary Blueprints — NASA's Planetary Fact Sheet, drawn"
      : `${sheet.title} — Planetary Blueprints`;
  const og = `${ctx.site}og/${sheet.id}.png`;
  const alt =
    sheet.id === 'ga'
      ? 'The ten bodies of NASA’s Planetary Fact Sheet drawn to one scale as an engineering drawing'
      : `${named(sheet.id, true)} drawn as an engineering drawing from NASA’s Planetary Fact Sheet`;
  return `<meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" content="#1d4580" />
    <link rel="icon" href="${ctx.base}favicon.svg" type="image/svg+xml" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Planetary Blueprints" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${og}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(alt)}" />
    <meta name="twitter:card" content="summary_large_image" />`;
}

/** NASA's own starred sentence for a row, from its notes page: the text from "*" on. */
function starNote(text: string | undefined): string | undefined {
  const i = text?.indexOf('*') ?? -1;
  return i >= 0 ? text!.slice(i + 1).trim() : undefined;
}

function generalNotes(sheet: Sheet): string {
  const ids: BodyId[] = sheet.id === 'ga' ? [...BODY_IDS] : [sheet.id];
  const plan = sheet.id === 'ga' ? undefined : keyPlanModel(sheet.id);
  const b = sheet.id === 'ga' ? undefined : bodyModel(sheet.id);
  const notes = [
    'VALUES AS PUBLISHED IN THE NASA NSSDCA PLANETARY FACT SHEETS (SOURCES BELOW). UNOFFICIAL — NOT A NASA PRODUCT.',
    'DIMENSIONS IN km; ORBITS IN 10⁶ km; ANGLES IN DEGREES.',
    'EACH LINE IS SIZED BY THE VALUE PRINTED ON IT. ( ) = REFERENCE DIMENSION; A WORKED-OUT VALUE SHOWS ITS FORMULA.',
    'AXIS DRAWN TO THE POSITIVE POLE (+, RIGHT-HAND RULE). SPIN SHOWN AT 1 s = 1 h. ROTATION PHASE ARBITRARY.',
    plan && !plan.j2000
      ? 'ORBIT ABOUT THE EARTH FROM NASA’S MAIN-TABLE PERIGEE AND APOGEE. NASA GIVES NO NODE OR PERIGEE LONGITUDE FOR THE MOON: ORIENTATION ARBITRARY, NO POSITION SHOWN.'
      : 'ORBIT ORIENTATION AND POSITIONS FROM NASA’S J2000 MEAN ELEMENTS (TWO-BODY): WITHIN 0.5° OF JPL HORIZONS 1990–2060, 0.3° FOR ALL BUT MERCURY.',
    'NASA: “THE VALUES LISTED ON THE FACTSHEETS ARE NOT ‘OFFICIAL’ VALUES … CARE SHOULD BE EXERCISED WHEN USING THESE VALUES.”',
  ];
  if (b?.rings) {
    notes.push(
      'RING EDGES FROM THE RINGS FACT SHEET (km): WIDE = OPAQUE RINGS, NARROW = FAINTER, PHANTOM = OPTICAL DEPTH UNDER ABOUT 0.01.' +
        (b.rings.notDrawn.length
          ? ` NOT DRAWN AT THIS SCALE: ${b.rings.notDrawn.map((n) => n.toUpperCase()).join(' · ')}.`
          : ''),
    );
  }
  // Starred values on this sheet, with NASA's own sentence for each (main table, then ratio table).
  const starred: string[] = [];
  const seen = new Set<string>();
  for (const p of PARAMS) {
    const rowName = mainRow(p.key)
      .label.replace(/\s*\(.*$/, '')
      .toUpperCase();
    const inMain = ids.some((id) => mainVal(id, p.key).note === '*');
    const inRatio =
      sheet.id !== 'ga' && sheet.id !== 'earth' && ratioVal(sheet.id, p.key)?.note === '*';
    const sources = [
      { hit: inMain, text: FACTS.definitions.main[p.key]?.text, tag: '' },
      { hit: inRatio, text: FACTS.definitions.ratio?.[p.key]?.text, tag: ' (× EARTH)' },
    ];
    for (const { hit, text, tag } of sources) {
      const sentence = hit ? starNote(text) : undefined;
      if (!sentence || seen.has(sentence)) continue;
      seen.add(sentence);
      starred.push(`* ${rowName}${tag}: ${sentence}`);
    }
  }
  // Body-page notes, only where the sheet letters their marker or draws what they qualify.
  const extra: string[] = [];
  if (sheet.id !== 'ga') {
    const core = b?.core?.note;
    for (const f of body(sheet.id).footnotes) if (core && f.startsWith(`${core} `)) extra.push(f);
    if (b?.dipole) extra.push(...(body(sheet.id).magnetosphereNotes ?? []));
  }
  const li = (n: string) => `<li>${esc(n)}</li>`;
  return `<ol>${[...notes, ...starred, ...extra].map(li).join('')}</ol>`;
}

function titleBlock(sheet: Sheet, ctx: PageCtx): string {
  const { prev, next } = neighbours(sheet.id);
  const href = (s: Sheet) => `${ctx.base}${s.slug}${s.slug ? '/' : ''}`;
  const short = (s: Sheet) => (s.id === 'ga' ? 'SHEET 1' : s.title.toUpperCase());
  const link = (url: string, text: string) => `<a href="${url}">${text}</a>`;
  let sources: string;
  if (sheet.id === 'ga') {
    sources = [
      `${link(FACTS.main.url, 'NSSDCA PLANETARY FACT SHEET')} ${isoDate(FACTS.main.lastUpdated)}`,
      'BODY AND RING FACT SHEETS (DATES ON SHEETS 2–11)',
      link(NOTES_MAIN, 'NOTES'),
    ].join(' · ');
  } else {
    const b = body(sheet.id);
    const plan = keyPlanModel(sheet.id);
    sources = [
      `${link(b.url, `NSSDCA ${esc(bodyName(sheet.id).toUpperCase())} FACT SHEET`)} ${isoDate(b.lastUpdated)}`,
      `${link(FACTS.main.url, 'PLANETARY FACT SHEET')} ${isoDate(FACTS.main.lastUpdated)}`,
      `${link(FACTS.ratio.url, 'RATIO TABLE')} ${isoDate(FACTS.ratio.lastUpdated)}`,
      ...(b.rings
        ? [`${link(b.rings.url, 'RINGS FACT SHEET')} ${isoDate(b.rings.lastUpdated)}`]
        : []),
      ...(plan.earth
        ? [`${link(body('earth').url, 'EARTH FACT SHEET')} ${isoDate(body('earth').lastUpdated)}`]
        : []),
      `${link(NOTES_MAIN, 'NOTES')}, ${link(NOTES_SHEET, 'FACT SHEET NOTES')}`,
    ].join(' · ');
  }
  const noPosition = sheet.id !== 'ga' && !keyPlanModel(sheet.id).j2000;
  return `<footer class="title-block" aria-label="Title block">
      <div class="name"><span class="k">Title</span><svg class="title-lettering" data-text="${esc(sheet.title.toUpperCase())}" aria-hidden="true"></svg><span class="visually-hidden">${esc(sheet.title)}</span></div>
      <div><span class="k">Dwg no.</span><span class="v">${sheet.dwg}</span></div>
      <div><span class="k">Sheet</span><span class="v">${sheet.number} / ${SHEET_COUNT}</span></div>
      <div><span class="k">Type</span><span class="v">${sheet.docType}</span></div>
      <div><span class="k">Issued</span><span class="v nowrap">${ctx.issued}</span></div>
      <div class="wide"><span class="k">Source</span><span class="v">${sources} · RETRIEVED <span class="nowrap">${FACTS.retrieved.slice(0, 10)}</span></span></div>
      <div class="wide"><span class="k">Epoch · spin</span><span class="v nav">
        ${noPosition ? '<span>POSITION NOT GIVEN</span>' : `<span>POSITIONS <time id="epoch" class="nowrap" datetime="${ctx.issued}">${ctx.issued}</time></span>`}
        <span class="si">1 s = 1 h</span>
        <button type="button" id="pause">Pause</button>
        <a href="${href(prev)}" rel="prev">‹ ${esc(short(prev))}</a>
        <a href="${href(next)}" rel="next">${esc(short(next))} ›</a>
      </span></div>
      <div class="wide status"><span class="v">PLANETARY BLUEPRINTS · UNOFFICIAL — NOT A NASA PRODUCT · <a href="${ctx.repo}">SOURCE CODE AND DATA</a></span></div>
    </footer>`;
}

function notesBlock(sheet: Sheet): string {
  return `<aside class="notes" aria-label="General notes">
      <h2 class="label">General notes</h2>${generalNotes(sheet)}
    </aside>`;
}

/** The definition of the row in focus; main.ts fills it. Kept in the layout so it can announce. */
const definitionBox = `<div class="definition" id="definition" role="region" aria-live="polite" aria-label="NASA definition">
        <p class="term"></p><p class="text"></p><p class="src"></p>
        <p class="idle"><span class="pointer">Point at a row, or tab to it, for NASA’s definition.</span><span class="touch">Tap a row for NASA’s definition.</span></p>
      </div>`;

/** Values the drawings take from the body's own page (not in the main table), as text too. */
function drawnFromBodyPage(id: BodyId): string {
  const b = bodyModel(id);
  const rows: string[] = [];
  const tr = (key: string, name: string, value: string) =>
    `<tr data-key="${key}" data-shape="A" tabindex="0"><th scope="row">${label(name)}<span class="visually-hidden">, drawn</span></th><td>${value}</td></tr>`;
  if (1 - b.polar / (b.diameter / 2) >= 0.01) {
    const r = row(id, 'bulk', 'polarRadius')!;
    rows.push(tr('polarRadius', r.label, val(r.body)));
  }
  const core = row(id, 'bulk', 'coreRadius');
  if (core) rows.push(tr('coreRadius', core.label, val(core.body)));
  if (b.dipole) {
    const tilt = body(id).magnetosphere?.find((r) => r.key === 'dipoleTilt');
    const offset = body(id).magnetosphere?.find((r) => r.key === 'dipoleOffset');
    if (tilt) rows.push(tr('dipoleTilt', tilt.label, val(tilt.body)));
    else rows.push(tr('dipoleTilt', 'Dipole tilt (derived)', esc(b.dipole.label)));
    if (offset) rows.push(tr('dipoleTilt', offset.label, val(offset.body)));
  }
  if (b.rings) {
    const name = (n: string) => (/^\d/.test(n) ? `Ring ${n}` : n);
    const list = b.rings.edges.map((e) => `${esc(name(e.name))} ${esc(e.text)}`).join('<br />');
    rows.push(tr('ringSystem', 'Ring edges drawn (km)', list));
  }
  if (!rows.length) return '';
  return `<table class="drawn">
        <caption class="label">Drawn from the NASA ${esc(body(id).name)} fact sheet</caption>
        <tbody>${rows.join('')}</tbody>
      </table>`;
}

function bodySheet(
  id: BodyId,
  sheet: Sheet,
  ctx: PageCtx,
): { html: string; data: PageData; description: string } {
  const name = body(id).name;
  const b = bodyModel(id);
  const plan = keyPlanModel(id);
  const shapes = drawn(id);
  const rows = PARAMS.map((p) => {
    const r = mainRow(p.key);
    const v = mainVal(id, p.key);
    const ratio = id === 'earth' ? undefined : ratioVal(id, p.key);
    const shape = shapes.get(p.key);
    const mark = shape ? '<span class="visually-hidden">, drawn</span>' : '';
    return `<tr data-key="${p.key}"${shape ? ` data-shape="${shape}"` : ''} tabindex="0"><th scope="row">${label(r.label)}${mark}</th><td>${val(v)}</td>${id === 'earth' ? '' : `<td class="ratio">${val(ratio)}</td>`}</tr>`;
  }).join('\n          ');
  const moon = id === 'moon';
  const apsides = moon ? ['perigee', 'apogee'] : ['perihelion', 'aphelion'];
  const description = `${named(id, true)} from NASA’s Planetary Fact Sheet as an engineering drawing: diameter ${mainVal(id, 'diameter').text} km, axis tilted ${mainVal(id, 'obliquity').text}°, rotation ${mainVal(id, 'rotationPeriod').text} h. Unofficial; not affiliated with NASA.`;
  const planLabel = `Key plan: the orbit of ${named(id)} seen normal to its plane, ${apsides[0]} ${mainVal(id, 'perihelion').text} and ${apsides[1]} ${mainVal(id, 'aphelion').text} ×10⁶ km.`;
  const edgeLabel = `Key plan, edge-on: the orbit of ${named(id)} along its line of nodes, inclined ${mainVal(id, 'orbitalInclination').text}° to the ecliptic.`;
  const planCaption = moon ? 'Key plan · about the Earth' : 'Key plan · normal to orbit plane';
  const edgeCaption = moon
    ? 'Key plan · edge-on to the ecliptic'
    : 'Key plan · edge-on, along the line of nodes';
  const html = `<main class="sheet" aria-labelledby="sheet-title">
    <span class="marks" aria-hidden="true"></span>
    <h1 id="sheet-title" class="visually-hidden">${esc(name)} — sheet ${sheet.number} of ${SHEET_COUNT}</h1>
    <section class="views" aria-label="Drawings">
      <noscript><p class="noscript">The drawings need JavaScript. The schedule and notes are complete without it.</p></noscript>
      <figure class="view view-a">
        <svg class="drawing" id="view-a" tabindex="0" role="img" aria-describedby="drawn-values" aria-label="View A: ${esc(named(id))} drawn to scale, axis tilted ${esc(mainVal(id, 'obliquity').text)} degrees. Drag sideways or use the arrow keys to turn it."></svg>
        <figcaption><span class="letter">A</span><span class="caption" data-plan="20° above the orbit plane" data-tilt="Orbit plane edge-on · tilt true size">20° above the orbit plane</span><span class="hint">· drag to turn</span><button type="button" class="swap" data-show="plan">Key plan</button></figcaption>
      </figure>
      <figure class="view key-plan">
        <svg class="drawing clip" id="key-plan" role="img" aria-label="${esc(planLabel)}" data-label="${esc(planLabel)}" data-edge-label="${esc(edgeLabel)}"></svg>
        <figcaption><span class="caption" data-plan="${planCaption}" data-edge="${edgeCaption}">${planCaption}</span><button type="button" class="swap" data-show="a">View A</button></figcaption>
      </figure>
    </section>
    <section class="schedule" aria-label="Schedule">
      <h2 class="label">Schedule — NASA Planetary Fact Sheet</h2>
      <table class="main">
        <thead><tr><th scope="col">Parameter</th><th scope="col">${esc(name.toUpperCase())}</th>${id === 'earth' ? '' : '<th scope="col">× Earth</th>'}</tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${definitionBox}
      <div id="drawn-values">${drawnFromBodyPage(id)}</div>
      <p class="more"><span>Rows marked ⊢⊣ are drawn. Point at one.</span><a href="${body(id).url}">NASA ${esc(name)} fact sheet ↗</a></p>
    </section>
    ${notesBlock(sheet)}
    ${titleBlock(sheet, ctx)}
  </main>`;
  return { html, data: { sheet: id, defs: definitions(), body: b, plan }, description };
}

function gaSheet(
  sheet: Sheet,
  ctx: PageCtx,
): { html: string; data: PageData; description: string } {
  const shapes = drawn('ga');
  const head = BODY_IDS.map(
    (id, i) =>
      `<th scope="col"><a href="${ctx.base}${id}/">${esc(bodyName(id).toUpperCase())}<small>SHEET ${i + 2}</small></a></th>`,
  ).join('');
  const rows = PARAMS.map((p) => {
    const r = mainRow(p.key);
    const shape = shapes.get(p.key);
    const mark = shape ? '<span class="visually-hidden">, drawn</span>' : '';
    return `<tr data-key="${p.key}"${shape ? ` data-shape="${shape}"` : ''} tabindex="0"><th scope="row">${label(r.label)}${mark}</th>${BODY_IDS.map((id) => `<td>${val(mainVal(id, p.key))}</td>`).join('')}</tr>`;
  }).join('\n          ');
  const description =
    'NASA’s Planetary Fact Sheet redrawn as a set of engineering drawings: the ten bodies at one true scale and real tilt, spinning at 1 second = 1 hour, with every dimension taken from NASA’s numbers. Unofficial.';
  const planLabel =
    'Plan of the orbits at true scale, viewed from the north ecliptic pole, with each body’s position.';
  const edgeLabel = 'Elevation of the orbits, the ecliptic edge-on, showing their inclinations.';
  const html = `<main class="sheet sheet-ga" aria-labelledby="sheet-title">
    <span class="marks" aria-hidden="true"></span>
    <h1 id="sheet-title" class="visually-hidden">Planetary Blueprints — general arrangement, sheet 1 of ${SHEET_COUNT}</h1>
    <section class="ga-table" aria-label="NASA Planetary Fact Sheet">
      <table>
        <colgroup><col class="param" />${BODY_IDS.map(() => '<col />').join('')}</colgroup>
        <thead>
          <tr class="lineup-row"><th scope="row"><span class="label">Line-up</span><br /><span class="unit">one scale · real tilt</span><br /><span class="unit">1 s = 1 h</span><br /><span class="unit">Moon and Pluto under 1 px</span></th><td colspan="${BODY_IDS.length}"><svg class="drawing" id="lineup" tabindex="0" role="img" aria-label="The ten bodies drawn to one scale, each with its axis at NASA's obliquity."></svg></td></tr>
          <tr><th scope="col">Parameter</th>${head}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${definitionBox}
    </section>
    <section class="ga-plan" aria-label="Plan">
      <figure class="view"><svg class="drawing clip" id="plan" role="img" aria-label="${esc(planLabel)}" data-label="${esc(planLabel)}" data-edge-label="${esc(edgeLabel)}"></svg>
      <figcaption><span class="letter">P</span><span class="caption" data-plan="Plan · from north ecliptic pole · bodies not to scale" data-edge="Elevation · ecliptic edge-on · bodies not to scale">Plan · from north ecliptic pole · bodies not to scale</span></figcaption></figure>
    </section>
    <section class="ga-detail" aria-label="Detail A">
      <figure class="view"><svg class="drawing clip" id="detail" role="img" aria-label="Detail A: the orbits of Mercury, Venus, Earth and Mars, enlarged." data-label="Detail A: the orbits of Mercury, Venus, Earth and Mars, enlarged." data-edge-label="Detail A, edge-on to the ecliptic."></svg>
      <figcaption><span class="letter">A</span><span class="caption" data-plan="Detail · inner bodies" data-edge="Detail · ecliptic edge-on">Detail · inner bodies</span></figcaption></figure>
    </section>
    <div class="og-title" aria-hidden="true"><svg class="title-lettering" data-text="PLANETARY BLUEPRINTS"></svg><p>NASA’s Planetary Fact Sheet, drawn to scale · every dimension from NASA’s numbers</p></div>
    ${notesBlock(sheet)}
    ${titleBlock(sheet, ctx)}
  </main>`;
  return {
    html,
    data: {
      sheet: 'ga',
      defs: definitions(),
      lineup: BODY_IDS.map(bodyModel),
      system: systemBodies(),
    },
    description,
  };
}

export function renderPage(sheet: Sheet, ctx: PageCtx): string {
  const r = sheet.id === 'ga' ? gaSheet(sheet, ctx) : bodySheet(sheet.id, sheet, ctx);
  return `<!doctype html>
<html lang="en">
  <head>
    ${head(sheet, ctx, r.description)}
  </head>
  <body data-sheet="${sheet.id}">
    ${r.html}
    <script type="application/json" id="page-data">${JSON.stringify(r.data).replace(/</g, '\\u003c')}</script>
    <script type="module" src="${ctx.base}src/main.ts"></script>
  </body>
</html>
`;
}

/** GitHub Pages' 404 page, as a blank sheet that links back to sheet 1. */
export function render404(base: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sheet not found — Planetary Blueprints</title>
    <meta name="robots" content="noindex" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        background: #1d4580;
        color: #f1f4f6;
        font: 15px/1.4 'Arial Narrow', system-ui, sans-serif;
      }
      main {
        box-sizing: border-box;
        margin: 12px;
        height: calc(100% - 24px);
        border: 2.5px solid #f1f4f6;
        display: grid;
        place-content: center;
        text-align: center;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        font-weight: 400;
        font-size: 28px;
        margin: 0 0 12px;
      }
      a {
        color: inherit;
      }
      a:hover {
        color: #ffd54a;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Sheet not found</h1>
      <p><a href="${base}">Sheet 1 — general arrangement</a></p>
    </main>
  </body>
</html>
`;
}

export { SHEETS };
