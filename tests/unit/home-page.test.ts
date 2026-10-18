// The home page as built: the bodies' links, nothing of the old general arrangement, and behind "?"
// the notes that say how the schematic is drawn, with NASA's sources and dates.

import { describe, expect, it } from 'vitest';
import { sheetById } from '../../src/content/sheets.ts';
import { FACTS } from '../../src/data/index.ts';
import { BODY_IDS } from '../../src/data/types.ts';
import { renderPage } from '../../src/render/page.ts';

const ctx = {
  base: '/planetary/',
  site: 'https://eduardmur.github.io/planetary/',
  issued: '2026-10-18',
  repo: 'https://github.com/eduardmur/planetary',
};
const html = renderPage(sheetById('home'), ctx);
const dialog = html.match(/<dialog id="info"[\s\S]*?<\/dialog>/)![0];

describe('home page', () => {
  it('links the ten bodies in NASA’s order, the Moon after the Earth', () => {
    const nav = html.match(/<nav class="bodies" aria-label="Bodies">([\s\S]*?)<\/nav>/)![1]!;
    const links = [...nav.matchAll(/<a href="\/planetary\/(\w+)\/" data-body="(\w+)">/g)];
    expect(links.map((m) => m[2])).toEqual([...BODY_IDS]);
    expect(links.every((m) => m[1] === m[2])).toBe(true);
  });

  it('has no table and no rows', () => {
    expect(html).not.toContain('data-key');
    expect(html).not.toContain('<table');
  });

  it('has its four corner items and one drawing', () => {
    expect(html).toContain('data-text="PLANETARY"');
    expect(html).toContain('NASA’s Planetary Fact Sheet, drawn · unofficial');
    expect(html.replace(/<[^>]+>/g, '')).toContain('Not to scale · 1 min = 1 year');
    expect(html).toContain('<time id="clock">');
    expect(html).toContain('<button type="button" id="pause">Pause</button>');
    expect(html.match(/<svg class="drawing"/g)).toHaveLength(1);
  });

  it('says it is unofficial and not to scale, and gives the radial scale', () => {
    expect(dialog).toContain('Unofficial: not affiliated with or endorsed by NASA.');
    expect(dialog).toContain('SCHEMATIC, NOT TO SCALE.');
    expect(dialog).toContain('(r / 7375.9)^0.4');
    expect(dialog).toContain('AT LEAST 6 px');
  });

  it('describes itself without claiming a true scale', () => {
    const description = html.match(/<meta name="description" content="([^"]*)"/)![1]!;
    expect(description).not.toMatch(/true scale|drawn to scale/i);
    expect(html).not.toMatch(/true scale|drawn to scale|one scale/i);
  });

  it('quotes NASA’s caveat in its own words', () => {
    const quote = dialog
      .match(/NASA: “(.*?)”/)![1]!
      .toLowerCase()
      .replace(/[‘’]/g, '"');
    const caveat = FACTS.definitions.caveat.toLowerCase();
    for (const part of quote.replace(/\.$/, '').split(' … ')) expect(caveat).toContain(part);
  });

  it('lists its sources with NASA’s dates and the retrieval date', () => {
    expect(dialog).toContain(`href="${FACTS.main.url}"`);
    expect(dialog).toContain('(Last Updated <span class="nowrap">2025-03-18</span>)');
    for (const page of ['planetfact_notes', 'planetfact_ratio_notes', 'fact_notes'])
      expect(dialog).toContain(`${page}.html ↗</a>`);
    expect(dialog).toContain(`Retrieved <span class="nowrap">${FACTS.retrieved.slice(0, 10)}`);
    expect(dialog).toContain('href="/planetary/data/factsheet.json"');
    expect(dialog).toContain(`href="${ctx.repo}/blob/main/data/discrepancies.md"`);
  });

  it('ends with its title block on one line', () => {
    expect(dialog).toContain(
      'PL-01 · SHEET 1 / 11 · SOLAR SYSTEM · SCHEMATIC, NOT TO SCALE · ISSUED <span class="nowrap">2026-10-18</span>',
    );
  });

  it('embeds the schematic’s nine bodies for the script', () => {
    const json = html.match(
      /<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/,
    )![1]!;
    const data = JSON.parse(json);
    expect(data.orrery.bodies).toHaveLength(9);
    expect(data.defs).toBeUndefined();
  });
});
