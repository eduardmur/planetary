// A body's page: the tabs, View A and the key plan, NASA's 20 rows with a popover each (NASA's
// definition, the ratio to Earth, the values drawn from the body's own page, where NASA's pages
// disagree), and the "?" dialog with the notes, the sources and the title block.

import {
  DISCREPANCIES,
  FACTS,
  body,
  mainRow,
  mainVal,
  ratioVal,
  row,
  type BodyId,
  type Discrepancy,
  type Section,
} from '../data/index.ts';
import { bodyModel, keyPlanModel, ringList } from '../data/model.ts';
import { PARAMS } from '../content/params.ts';
import { BODY_SHEETS, SHEET_COUNT, type Sheet } from '../content/sheets.ts';
import { CAP, measure } from '../draw/lettering.ts';
import { VISIBLE_FLATTENING, type RingEdge } from '../views/body.ts';
import {
  NOTES_MAIN,
  NOTES_RATIO,
  NOTES_SHEET,
  esc,
  infoButton,
  infoDialog,
  isoDate,
  label,
  named,
  titleLine,
  val,
  type PageCtx,
  type Rendered,
} from './common.ts';

/** The rows drawn on this body's sheet (⊢⊣), with the views that draw them. */
function drawn(id: BodyId): Map<string, string> {
  const shapes = new Map(
    PARAMS.filter((p) => p.shape.length).map((p) => [p.key, p.shape.join('')]),
  );
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

/** The sentence a definition gives for starred values ("* For the Moon, …"). */
function starNote(text: string | undefined): string | undefined {
  const i = text?.indexOf('*') ?? -1;
  return i >= 0 ? text!.slice(i + 1).trim() : undefined;
}

// ---- Header ------------------------------------------------------------------------------------

/** PLANETARY (the home link), the ten bodies as tabs, and "?". */
function tabs(id: BodyId, ctx: PageCtx): string {
  const links = BODY_SHEETS.map(
    (s) =>
      `<li><a href="${ctx.base}${s.slug}/" data-body="${s.id}"${s.id === id ? ' aria-current="page"' : ''}>${esc(s.title)}</a></li>`,
  ).join('');
  // Sized exactly as src/main.ts letters it, so nothing moves when the lettering arrives.
  const w = measure('PLANETARY') * CAP.l + 4;
  const h = Math.ceil(CAP.l * 1.5);
  // ‹ › show where the strip hides tabs, and scroll it for a mouse (src/ui/body.ts).
  const more = (dir: number, glyph: string) =>
    `<span class="more" data-dir="${dir}" aria-hidden="true">${glyph}</span>`;
  return `<header class="tabs">
      <a class="home" href="${ctx.base}"><svg class="title-lettering" data-text="PLANETARY" data-size="l" width="${w}" height="${h}" aria-hidden="true"></svg><span class="sun" aria-hidden="true">☉</span><span class="visually-hidden">Planetary</span></a>
      <nav aria-label="Bodies">${more(-1, '‹')}<ol class="strip">${links}</ol>${more(1, '›')}</nav>
      ${infoButton('Notes and sources')}
    </header>`;
}

// ---- Row popovers --------------------------------------------------------------------------------

/** A value from the body's own fact sheet, with its definition from NASA's fact_notes.html. */
function item(name: string, value: string, key: string, ...notes: string[]): string {
  const d = FACTS.definitions.sheet[key];
  return `<div><dt>${label(name)}</dt><dd class="v">${value}</dd>${d ? `<dd class="d">${esc(d.text)}</dd>` : ''}${notes.map((n) => `<dd class="n">${n}</dd>`).join('')}</div>`;
}

const LINE: Record<RingEdge['line'], string> = { wide: 'wide', thin: 'narrow', phantom: 'phantom' };
const ringName = (n: string) => (/^\d/.test(n) ? `Ring ${n}` : n);

/** Values of the body's page that set where a main-table row is drawn, and how. */
const SETS: Record<string, { section: Section; key: string; note: string }> = {
  perihelion: {
    section: 'elements',
    key: 'perihelionLongitude',
    note: 'ϖ, a J2000 mean element: it sets the direction of the apsides line.',
  },
  orbitalInclination: {
    section: 'elements',
    key: 'ascendingNode',
    note: 'Ω, a J2000 mean element: it sets the direction of the line of nodes.',
  },
  orbitalPeriod: {
    section: 'orbital',
    key: 'siderealPeriod',
    note: 'The ticks on the orbit are 1/24 of this period apart.',
  },
};

/** What a row's popover adds from the body's own fact sheet: the values its drawing also uses. */
function alsoDrawn(id: BodyId, key: string): string {
  const page = body(id);
  const b = bodyModel(id);
  const section = (from: string, html: string) =>
    `<section class="also"><h3>Also drawn, from NASA’s ${from}</h3>${html}</section>`;
  const fromPage = (items: string[], after = '') =>
    items.length
      ? section(
          `${esc(page.name)} fact sheet <time>${isoDate(page.lastUpdated)}</time>`,
          `<dl>${items.join('')}</dl>${after}`,
        )
      : '';
  const sets = SETS[key];
  if (sets) {
    const r = row(id, sets.section, sets.key);
    return fromPage(r ? [item(r.label, val(r.body), sets.key, sets.note)] : []);
  }
  switch (key) {
    case 'diameter': {
      const items: string[] = [];
      if (1 - b.polar / (b.diameter / 2) >= VISIBLE_FLATTENING) {
        const r = row(id, 'bulk', 'polarRadius')!;
        items.push(item(r.label, val(r.body), 'polarRadius'));
      }
      const core = row(id, 'bulk', 'coreRadius');
      if (core) {
        const mark = core.body.note;
        const notes = mark ? page.footnotes.filter((f) => f.startsWith(`${mark} `)) : [];
        items.push(item(core.label, val(core.body), 'coreRadius', ...notes.map(esc)));
      }
      return fromPage(items);
    }
    case 'ringSystem': {
      // Every row of NASA's ring sheet: the edges drawn, under NASA's names, then those not drawn.
      const rings = page.rings;
      const list = ringList(id);
      if (!list || !rings) return '';
      const edges = list.drawn
        .map(
          (e) =>
            `<div><dt>${esc(ringName(e.name))}</dt><dd>${esc(e.text)}</dd><dd>${LINE[e.line]}</dd></div>`,
        )
        .join('');
      // Each entry is kept whole and a line breaks only after a "·", as in the title line. A group of
      // rows (Adams's arcs) is too long for that: it breaks only after a comma or its colon, so that
      // every name keeps its number.
      const entries = (all: string[]) =>
        all
          .map((s) =>
            esc(s)
              .split(/(?<=[,:]) /)
              .map((w) => `<span class="nowrap">${w}</span>`)
              .join(' '),
          )
          .join('&nbsp;· ');
      const lists = [
        list.omitted.length ? `Not drawn: ${entries(list.omitted)}.` : '',
        list.beyond.length ? `Not drawn at this scale: ${entries(list.beyond)}.` : '',
      ].filter(Boolean);
      // NASA's notes in one paragraph where they are sentences; a note that is not one (Neptune's
      // parenthesis) stands apart, so that it does not run into the next.
      const sentence = (s: string | undefined) => !!s && /[.!?]$/.test(s);
      const paras: string[] = [];
      rings.notes.forEach((n, i) => {
        if (sentence(rings.notes[i - 1]) && sentence(n)) paras[paras.length - 1] += ` ${esc(n)}`;
        else paras.push(esc(n));
      });
      const notes = paras.map((p) => `<p class="n">${p}</p>`).join('');
      return section(
        `${esc(page.name)} rings fact sheet <time>${isoDate(rings.lastUpdated)}</time>`,
        `<p class="k">Ring edges drawn <span class="unit">(km)</span></p><dl class="edges">${edges}</dl>${lists.length ? `<p>${lists.join(' ')}</p>` : ''}<p>Wide = opaque rings, narrow = fainter, phantom = optical depth under about 0.01.</p>${notes}`,
      );
    }
    case 'magneticField': {
      if (!b.dipole) return '';
      const mag = page.magnetosphere ?? [];
      const tilt = mag.find((r) => r.key === 'dipoleTilt');
      const offset = mag.find((r) => r.key === 'dipoleOffset');
      const geo = mag.find((r) => r.key === 'geocentricDipole');
      const items: string[] = [];
      if (tilt) items.push(item(tilt.label, val(tilt.body), 'dipoleTilt'));
      else if (geo)
        // Earth's page gives no tilt: the drawing works it out from the dipole's latitude.
        items.push(
          item(
            FACTS.definitions.sheet.dipoleTilt?.term ?? 'Dipole tilt',
            esc(b.dipole.label),
            'dipoleTilt',
            `From ${esc(geo.label)} ${esc(geo.body.text)}${geo.group ? ` (${esc(geo.group)})` : ''}.`,
          ),
        );
      if (offset)
        items.push(
          item(
            offset.label,
            `${val(offset.body)} <span class="q">· direction not given</span>`,
            'dipoleOffset',
          ),
        );
      const notes = (page.magnetosphereNotes ?? []).map((n) => `<p class="n">${esc(n)}</p>`);
      return fromPage(items, notes.join(''));
    }
  }
  return '';
}

/**
 * A line of the ledger, in its own words: two pages that disagree, or one page that disagrees with
 * itself (named once, in the lead). Lines that compare the same thing on the same page with the same
 * note share one paragraph, as Uranus's three ring ratios do; map() passes the row's whole list.
 */
const conflict = (d: Discrepancy, i: number, list: Discrepancy[]): string => {
  const together = (e: Discrepancy | undefined) =>
    !!e && e.within === d.within && e.what === d.what && e.note === d.note;
  if (together(list[i - 1])) return ''; // already in the paragraph before
  let end = i + 1;
  while (together(list[end])) end++;
  const src = (s: string) => (s === d.within ? '' : ` <span class="nowrap">(${esc(s)})</span>`);
  // A value never breaks inside itself; a worked one may break before its result.
  const whole = (v: string) =>
    v
      .split(' = ')
      .map((s, j) => `<span class="nowrap">${j ? '= ' : ''}${esc(s)}</span>`)
      .join(' ');
  const pairs = list
    .slice(i, end)
    .map((e) => `${whole(e.a)}${src(e.aSrc)} vs ${whole(e.b)}${src(e.bSrc)}`);
  const lead = d.within ? `NASA’s ${esc(d.within)} disagrees with itself` : 'NASA’s pages disagree';
  return `<p class="conflict">${lead} on ${esc(d.what)}: ${pairs.join('; ')}.${d.note ? ` ${esc(d.note)}` : ''}</p>`;
};

/** What a drawn row lights up, where its value sizes nothing. */
const SHOWN: Partial<Record<string, string>> = {
  orbitalVelocity:
    'Drawn: today’s position and the direction of motion. The arrow is a symbol; its length is not the speed.',
};

/**
 * A row's popover: the label and NASA's value, its ratio to Earth, NASA's definition verbatim, what
 * else the drawing takes from the body's page, where NASA's pages disagree, and the notes link.
 * "auto" without the script: one open at a time, closed by Esc or a click elsewhere. The script
 * makes them "manual" and keeps the one selection itself.
 */
function popover(id: BodyId, key: string, isDrawn: boolean): string {
  const r = mainRow(key);
  const def = FACTS.definitions.main[key];
  const ratio = id === 'earth' ? undefined : ratioVal(id, key);
  // NASA's starred ratio sentence, unless the definition above already says it.
  const ratioNote = ratio?.note === '*' ? starNote(FACTS.definitions.ratio?.[key]?.text) : '';
  const shown = SHOWN[key];
  return `<div popover="auto" id="def-${key}" class="def" role="group" aria-labelledby="t-${key}">${[
    `<header><h2 id="t-${key}">${label(r.label)}</h2><button type="button" class="close" popovertarget="def-${key}" popovertargetaction="hide" aria-label="Close">×</button></header>`,
    `<p class="value"><b>${val(mainVal(id, key))}</b>${ratio?.text ? ` <span class="ratio">× Earth ${val(ratio)}</span>` : ''}</p>`,
    def ? `<p class="text">${esc(def.text)}</p>` : '',
    ratioNote && !def?.text.includes(ratioNote)
      ? `<p class="ratio-note">× Earth*: ${esc(ratioNote)}</p>`
      : '',
    isDrawn
      ? shown
        ? `<p class="n">${esc(shown)}</p>`
        : ''
      : '<p class="not-drawn">Not drawn.</p>',
    alsoDrawn(id, key),
    ...DISCREPANCIES.filter((d) => d.body === id && d.key === key).map(conflict),
    `<p class="src"><a href="${NOTES_MAIN}#${r.anchor}">NASA notes ↗</a></p>`,
  ].join('')}</div>`;
}

/** One of NASA's rows: the label as a disclosure button for its popover, and the value as printed. */
function scheduleRow(id: BodyId, key: string, shape: string | undefined): string {
  const r = mainRow(key);
  const mark = shape ? '<span class="visually-hidden">, drawn</span>' : '';
  return `<tr data-key="${key}"${shape ? ` data-shape="${shape}"` : ''}><th scope="row"><button type="button" id="b-${key}" popovertarget="def-${key}">${label(r.label)}${mark}</button></th><td>${val(mainVal(id, key))}${popover(id, key, !!shape)}</td></tr>`;
}

// ---- The "?" dialog ------------------------------------------------------------------------------

function info(id: BodyId, sheet: Sheet, ctx: PageCtx): string {
  const b = body(id);
  const name = b.name;
  const plan = keyPlanModel(id);
  const earth = body('earth');
  const out = (href: string, text: string) => `<a href="${href}">${text} ↗</a>`;
  const notes = [
    'DIMENSIONS IN km; ORBITS IN 10⁶ km; ANGLES IN DEGREES.',
    'EACH LINE IS SIZED BY THE VALUE PRINTED ON IT. ( ) = REFERENCE DIMENSION; A WORKED-OUT VALUE SHOWS ITS FORMULA.',
    'AXIS DRAWN TO THE POSITIVE POLE (+, RIGHT-HAND RULE). SPIN SHOWN AT 1 s = 1 h. ROTATION PHASE ARBITRARY.',
    plan.j2000
      ? 'ORBIT FROM NASA’S MAIN-TABLE PERIHELION, APHELION AND INCLINATION; NODE, PERIHELION DIRECTION AND POSITIONS FROM THE J2000 MEAN ELEMENTS (TWO-BODY): WITHIN 0.5° OF JPL HORIZONS 1990–2060, 0.3° FOR ALL BUT MERCURY.'
      : 'ORBIT ABOUT THE EARTH FROM NASA’S MAIN-TABLE PERIGEE AND APOGEE. NASA GIVES NO NODE OR PERIGEE LONGITUDE FOR THE MOON: ORIENTATION ARBITRARY, NO POSITION SHOWN.',
    plan.j2000
      ? 'KEY PLAN: SUN, BODY AND MOTION ARROW ARE SYMBOLS, NOT TO SCALE.'
      : 'KEY PLAN: THE EARTH IS A SYMBOL, NOT TO SCALE.',
    'NASA: “THE VALUES LISTED ON THE FACTSHEETS ARE NOT ‘OFFICIAL’ VALUES … CARE SHOULD BE EXERCISED WHEN USING THESE VALUES.”',
  ];
  const sources = [
    `${out(b.url, `NSSDCA ${esc(name)} fact sheet`)} ${isoDate(b.lastUpdated)}`,
    `${out(FACTS.main.url, 'Planetary Fact Sheet')} ${isoDate(FACTS.main.lastUpdated)}`,
    `${out(FACTS.ratio.url, 'Ratio table')} ${isoDate(FACTS.ratio.lastUpdated)}`,
    ...(b.rings
      ? [`${out(b.rings.url, `${esc(name)} rings fact sheet`)} ${isoDate(b.rings.lastUpdated)}`]
      : []),
    ...(plan.earth
      ? [`${out(earth.url, 'Earth fact sheet')} ${isoDate(earth.lastUpdated)} (Earth’s orbit)`]
      : []),
    [
      `${out(NOTES_MAIN, 'planetfact_notes.html')} ${isoDate(FACTS.definitions.pages.main.lastUpdated)}`,
      `${out(NOTES_RATIO, 'planetfact_ratio_notes.html')} ${isoDate(FACTS.definitions.pages.ratio.lastUpdated)}`,
      `${out(NOTES_SHEET, 'fact_notes.html')} ${isoDate(FACTS.definitions.pages.sheet.lastUpdated)}`,
    ].join(' · '),
    `Retrieved <span class="nowrap">${FACTS.retrieved.slice(0, 10)}</span>`,
  ];
  const conflicts = DISCREPANCIES.filter((d) => d.body === id).length;
  const positions = plan.j2000
    ? `POSITIONS <time id="epoch" datetime="${ctx.issued}">${ctx.issued}</time>`
    : 'POSITION NOT GIVEN';
  const title = titleLine([
    sheet.dwg,
    `SHEET ${sheet.number} / ${SHEET_COUNT}`,
    esc(sheet.docType),
    `ISSUED ${ctx.issued}`,
    positions,
    'SPIN 1 s = 1 h',
  ]);
  const li = (s: string) => `<li>${s}</li>`;
  // .pointer and .touch follow the input (body.css); what needs the script is .js-only.
  const act = '<span class="pointer">Click</span><span class="touch">Tap</span>';
  return `<p><a href="${ctx.base}"><span class="sun">☉</span> Planetary</a>: the solar system, moving. NASA’s Planetary Fact Sheet, drawn as a set of engineering drawings. Unofficial: not affiliated with or endorsed by NASA.</p>
      <h3>Reading this sheet</h3>
      <ul>
        <li class="js-only">${act} a row, or a line in the drawing, for NASA’s definition; what it measures turns yellow.</li>
        <li class="nojs-only">${act} a row’s name for NASA’s definition.</li>
        <li class="js-only pointer">While a definition is open, ↑ ↓<span class="steps-note"> or ‹ › above the table</span> step through the rows.</li>
        <li class="js-only">Rows marked ⊢⊣ are drawn. Drag view A to turn it; <span class="pointer">double-click</span><span class="touch">double-tap</span> to reset. Spin: 1 s = 1 h.</li>
        <li class="js-only">Tabs<span class="pointer"> and ← →</span> switch bodies and keep the selected row.</li>
        <li>PLANETARY at the top left (<span class="sun">☉</span> on a phone or a small window) returns to the solar system.</li>
      </ul>
      <h3>General notes</h3>
      <ol class="drafting">${notes.map((n) => li(esc(n))).join('')}</ol>
      <h3>Sources</h3>
      <ul class="sources">${sources.map(li).join('')}</ul>
      <h3>Data and code</h3>
      <p><a href="${ctx.base}data/factsheet.json">JSON</a>&nbsp;· <a href="${ctx.base}data/factsheet-main.csv">CSV</a>&nbsp;· ${out(`${ctx.repo}/blob/main/data/discrepancies.md`, `Where NASA’s pages disagree <span class="nowrap">(${conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : 'no conflicts'} for ${esc(named(id))})</span>`)}&nbsp;· ${out(ctx.repo, 'Source code')}</p>
      <p class="title-line">${title}</p>
      <p class="status">Planetary · Unofficial — not a NASA product · not affiliated with or endorsed by NASA</p>`;
}

// ---- The page ------------------------------------------------------------------------------------

export function bodySheet(id: BodyId, sheet: Sheet, ctx: PageCtx): Rendered {
  const name = body(id).name;
  const b = bodyModel(id);
  const plan = keyPlanModel(id);
  const shapes = drawn(id);
  const rows = PARAMS.map((p) => scheduleRow(id, p.key, shapes.get(p.key))).join('\n          ');
  const moon = id === 'moon';
  const obliquity = esc(mainVal(id, 'obliquity').text);
  const description = `${named(id, true)} from NASA’s Planetary Fact Sheet as an engineering drawing: diameter ${mainVal(id, 'diameter').text} km, axis tilted ${mainVal(id, 'obliquity').text}°, rotation ${mainVal(id, 'rotationPeriod').text} h. Unofficial; not affiliated with NASA.`;
  const planLabel = moon
    ? 'Key plan: the orbit of the Moon about the Earth, seen normal to its plane. Orientation arbitrary; no position shown.'
    : `Key plan: the orbit of ${named(id)} seen normal to its plane, with the Sun at the focus and today’s position.`;
  const edgeLabel = `Key plan, edge-on: the orbit of ${named(id)} along its line of nodes, inclined ${mainVal(id, 'orbitalInclination').text}° to the ecliptic.`;
  const planCaption = moon
    ? 'Key plan · about the Earth · orientation arbitrary'
    : 'Key plan · normal to orbit plane';
  const edgeCaption = moon
    ? 'Key plan · edge-on to the ecliptic'
    : 'Key plan · edge-on, along the line of nodes';
  const html = `<main class="sheet sheet-body" aria-labelledby="sheet-title">
    <span class="marks" aria-hidden="true"></span>
    <a class="skip" href="#schedule">Skip to table</a>
    ${tabs(id, ctx)}
    <h1 id="sheet-title" class="visually-hidden">${esc(name)}</h1>
    <section class="views" aria-label="Drawings">
      <p class="noscript">The drawings need JavaScript, which is off or did not load. NASA’s values and definitions work without it.</p>
      <figure class="view view-a">
        <svg class="drawing" id="view-a" tabindex="0" role="img" aria-label="View A: ${esc(named(id))}, axis tilted ${obliquity} degrees from the orbit normal, with a scale bar in km. Drag sideways or use the arrow keys to turn it."></svg>
        <figcaption><span class="letter">A</span><span class="caption" data-plan="20° above the orbit plane" data-tilt="Tilt true size · orbit plane edge-on" data-edge-on="Orbit plane edge-on">20° above the orbit plane</span><span class="hint">· drag to turn · <span class="si">1 s = 1 h</span></span><button type="button" class="swap" data-show="plan">Key plan</button><button type="button" id="pause">Pause</button></figcaption>
      </figure>
      <figure class="view key-plan">
        <svg class="drawing clip" id="key-plan" role="img" aria-label="${esc(planLabel)}" data-label="${esc(planLabel)}" data-edge-label="${esc(edgeLabel)}"></svg>
        <figcaption><span class="caption" data-plan="${planCaption}" data-edge="${edgeCaption}">${planCaption}</span><button type="button" class="swap" data-show="a">View A</button></figcaption>
      </figure>
    </section>
    <section class="schedule" id="schedule" aria-labelledby="schedule-caption">
      <div class="og" aria-hidden="true"><svg class="title-lettering" data-text="${esc(name.toUpperCase())}" data-size="xl"></svg><p>Planetary · Unofficial</p></div>
      <table class="main">
        <caption id="schedule-caption" class="label">NASA Planetary Fact Sheet</caption>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <div class="steps" role="group" aria-label="Rows"><button type="button" class="step" data-step="-1" aria-label="Previous row">‹</button><button type="button" class="step" data-step="1" aria-label="Next row">›</button></div>
      <p class="legend"><span class="mark" aria-hidden="true"></span> drawn · <span class="pointer">click</span><span class="touch">tap</span> a row for NASA’s definition</p>
    </section>
  </main>
  ${infoDialog(`${esc(name)}: notes and sources`, info(id, sheet, ctx))}`;
  return {
    html,
    data: { sheet: id, body: b, plan },
    description,
    title: `${sheet.title} — Planetary`,
    ogAlt: `${named(id, true)} drawn as an engineering drawing from NASA’s Planetary Fact Sheet`,
  };
}
