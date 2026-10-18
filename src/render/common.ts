// Shared pieces of the static pages: types, escaping, NASA's values as printed, the "?" dialog.

import { FACTS, body, type BodyId, type Val } from '../data/index.ts';
import type { bodyModel, keyPlanModel } from '../data/model.ts';
import type { OrreryModel } from '../data/orrery.ts';
import type { Sheet } from '../content/sheets.ts';

export interface PageCtx {
  /** Site base path, e.g. "/planetary/". */
  base: string;
  /** Absolute site URL with trailing slash, for canonical and Open Graph links. */
  site: string;
  /** Date of issue (build date), YYYY-MM-DD. */
  issued: string;
  repo: string;
}

/** The data a page embeds for its client script. */
export interface PageData {
  sheet: Sheet['id'];
  /** Body pages. */
  body?: ReturnType<typeof bodyModel>;
  plan?: ReturnType<typeof keyPlanModel>;
  /** The home page. */
  orrery?: OrreryModel;
}

/** What a page renderer returns: the markup inside <body>, its data and its head text. */
export interface Rendered {
  html: string;
  data: PageData;
  title: string;
  description: string;
  ogAlt: string;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "19 May 2025" → "2025-05-19" (ISO 8601 on the sheets), never broken across lines. */
export function isoDate(nasa: string): string {
  const d = new Date(`${nasa} 12:00 UTC`);
  const iso = Number.isNaN(d.getTime()) ? nasa : d.toISOString().slice(0, 10);
  return `<span class="nowrap">${iso}</span>`;
}

/** A value as NASA prints it, with its footnote marker set as a superscript. */
export function val(v: Val | undefined): string {
  if (!v || !v.text) return '';
  return `${esc(v.text)}${v.note ? `<span class="fn">${esc(v.note)}</span>` : ''}`;
}

/** Split "Mass (10²⁴kg)" into the name and its unit, for quieter units. */
export function label(l: string): string {
  const m = l.match(/^(.*?)\s*(\([^()]*\))?\s*$/);
  if (!m || !m[2]) return esc(l);
  return `${esc(m[1]!)} <span class="unit">${esc(m[2])}</span>`;
}

/** Running text: "the Moon", other bodies by name. */
export const named = (id: BodyId, start = false) =>
  id === 'moon' ? (start ? 'The Moon' : 'the Moon') : body(id).name;

export const NOTES_MAIN = FACTS.main.url.replace(/index\.html$/, 'planetfact_notes.html');
export const NOTES_RATIO = FACTS.main.url.replace(/index\.html$/, 'planetfact_ratio_notes.html');
export const NOTES_SHEET = FACTS.source + 'fact_notes.html';

/** The "?" button. It opens the page's dialog of notes, sources and drawing data. */
export function infoButton(label = 'About, notes and sources'): string {
  return `<button type="button" class="info" commandfor="info" command="show-modal" aria-haspopup="dialog" aria-label="${esc(label)}">?</button>`;
}

/**
 * A title block's items on one line, "PL-08 · SHEET 8 / 11 · …": each item is kept whole, and a line
 * breaks only after a "·", never before one. Items are HTML.
 */
export function titleLine(items: string[]): string {
  return items.map((s) => `<span class="nowrap">${s}</span>`).join('&nbsp;· ');
}

/**
 * The page's one dialog. Without JavaScript it is shown inline after the sheet (see sheet.css), so
 * nothing in it is lost. Its heading takes focus when the dialog opens: src/main.ts adds autofocus,
 * so that a page without the script does not load scrolled down to the notes.
 */
export function infoDialog(title: string, body: string): string {
  return `<dialog id="info" class="info-dialog" closedby="any" aria-labelledby="info-title">
    <header><h2 id="info-title" tabindex="-1">${title}</h2><button type="button" class="close" commandfor="info" command="close" aria-label="Close">×</button></header>
    <div class="info-body">${body}</div>
  </dialog>`;
}
