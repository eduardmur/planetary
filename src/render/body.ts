// A body's page: View A and the key plan, NASA's 20 rows, and NASA's definitions.

import { FACTS, body, mainRow, mainVal, ratioVal, row, type BodyId } from '../data/index.ts';
import { bodyModel, keyPlanModel } from '../data/model.ts';
import { PARAMS } from '../content/params.ts';
import { BODY_SHEETS, SHEET_COUNT, bodyName, type Sheet } from '../content/sheets.ts';
import {
  NOTES_MAIN,
  NOTES_SHEET,
  esc,
  infoButton,
  infoDialog,
  isoDate,
  label,
  named,
  val,
  type PageCtx,
  type PageData,
  type Rendered,
} from './common.ts';

function definitions(): NonNullable<PageData['defs']> {
  const defs: NonNullable<PageData['defs']> = {};
  for (const p of PARAMS) {
    const d = FACTS.definitions.main[p.key];
    if (d) defs[p.key] = { term: d.term, text: d.text, src: NOTES_MAIN };
  }
  for (const key of ['polarRadius', 'coreRadius', 'dipoleTilt']) {
    const d = FACTS.definitions.sheet[key];
    if (d) defs[key] = { term: d.term, text: d.text, src: NOTES_SHEET };
  }
  return defs;
}

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

function starNote(text: string | undefined): string | undefined {
  const i = text?.indexOf('*') ?? -1;
  return i >= 0 ? text!.slice(i + 1).trim() : undefined;
}

function generalNotes(id: BodyId): string {
  const ids: BodyId[] = [id];
  const plan = keyPlanModel(id);
  const b = bodyModel(id);
  const notes = [
    'VALUES AS PUBLISHED IN THE NASA NSSDCA PLANETARY FACT SHEETS (SOURCES BELOW). UNOFFICIAL — NOT A NASA PRODUCT.',
    'DIMENSIONS IN km; ORBITS IN 10⁶ km; ANGLES IN DEGREES.',
    'EACH LINE IS SIZED BY THE VALUE PRINTED ON IT. ( ) = REFERENCE DIMENSION; A WORKED-OUT VALUE SHOWS ITS FORMULA.',
    'AXIS DRAWN TO THE POSITIVE POLE (+, RIGHT-HAND RULE). SPIN SHOWN AT 1 s = 1 h. ROTATION PHASE ARBITRARY.',
    !plan.j2000
      ? 'ORBIT ABOUT THE EARTH FROM NASA’S MAIN-TABLE PERIGEE AND APOGEE. NASA GIVES NO NODE OR PERIGEE LONGITUDE FOR THE MOON: ORIENTATION ARBITRARY, NO POSITION SHOWN.'
      : 'ORBIT ORIENTATION AND POSITIONS FROM NASA’S J2000 MEAN ELEMENTS (TWO-BODY): WITHIN 0.5° OF JPL HORIZONS 1990–2060, 0.3° FOR ALL BUT MERCURY.',
    'NASA: “THE VALUES LISTED ON THE FACTSHEETS ARE NOT ‘OFFICIAL’ VALUES … CARE SHOULD BE EXERCISED WHEN USING THESE VALUES.”',
  ];
  if (b.rings) {
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
    const inRatio = id !== 'earth' && ratioVal(id, p.key)?.note === '*';
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
  const core = b.core?.note;
  for (const f of body(id).footnotes) if (core && f.startsWith(`${core} `)) extra.push(f);
  if (b.dipole) extra.push(...(body(id).magnetosphereNotes ?? []));
  const li = (n: string) => `<li>${esc(n)}</li>`;
  return `<ol>${[...notes, ...starred, ...extra].map(li).join('')}</ol>`;
}

function titleBlock(sheet: Sheet & { id: BodyId }, ctx: PageCtx): string {
  const i = BODY_SHEETS.findIndex((s) => s.id === sheet.id);
  const prev = BODY_SHEETS[(i + BODY_SHEETS.length - 1) % BODY_SHEETS.length]!;
  const next = BODY_SHEETS[(i + 1) % BODY_SHEETS.length]!;
  const href = (s: Sheet) => `${ctx.base}${s.slug}${s.slug ? '/' : ''}`;
  const short = (s: Sheet) => s.title.toUpperCase();
  const link = (url: string, text: string) => `<a href="${url}">${text}</a>`;
  let sources: string;
  {
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
  const noPosition = !keyPlanModel(sheet.id).j2000;
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
      <div class="wide status"><span class="v">PLANETARY · UNOFFICIAL — NOT A NASA PRODUCT · <a href="${ctx.repo}">SOURCE CODE AND DATA</a></span></div>
    </footer>`;
}

function notesBlock(id: BodyId): string {
  return `<aside class="notes" aria-label="General notes">
      <h2 class="label">General notes</h2>${generalNotes(id)}
    </aside>`;
}

const definitionBox = `<div class="definition" id="definition" role="region" aria-live="polite" aria-label="NASA definition">
        <p class="term"></p><p class="text"></p><p class="src"></p>
        <p class="idle"><span class="pointer">Point at a row, or tab to it, for NASA’s definition.</span><span class="touch">Tap a row for NASA’s definition.</span></p>
      </div>`;

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

export function bodySheet(id: BodyId, sheet: Sheet, ctx: PageCtx): Rendered {
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
  const html = `<main class="sheet sheet-body" aria-labelledby="sheet-title">
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
    ${notesBlock(id)}
    ${titleBlock({ ...sheet, id }, ctx)}
    ${infoButton('Notes and sources')}
  </main>
  ${infoDialog(`${esc(name)}: notes and sources`, `<p>Unofficial: not affiliated with or endorsed by NASA.</p>${generalNotes(id)}`)}`;
  return {
    html,
    data: { sheet: id, defs: definitions(), body: b, plan },
    description,
    title: `${sheet.title} — Planetary`,
    ogAlt: `${named(id, true)} drawn as an engineering drawing from NASA’s Planetary Fact Sheet`,
  };
}
