// The home page: a schematic of the solar system whose bodies link to their pages.
//
// PLACEHOLDER from the restructuring: the static frame, the links and the dialog. The home-page work
// fills in the drawing, the corner items and the dialog's notes (see the redesign spec, §2).

import { BODY_SHEETS, type Sheet } from '../content/sheets.ts';
import { orreryModel } from '../data/orrery.ts';
import { esc, infoButton, infoDialog, type PageCtx, type Rendered } from './common.ts';

export function homeSheet(_sheet: Sheet, ctx: PageCtx): Rendered {
  const links = BODY_SHEETS.map(
    (s) =>
      `<li><a href="${ctx.base}${s.slug}/" data-body="${s.id}"><span>${esc(s.title)}</span></a></li>`,
  ).join('');
  const html = `<main class="sheet sheet-home" aria-labelledby="sheet-title">
    <span class="marks" aria-hidden="true"></span>
    <header class="corner tl">
      <h1 id="sheet-title"><svg class="title-lettering" data-text="PLANETARY" data-size="xl" aria-hidden="true"></svg><span class="visually-hidden">Planetary</span></h1>
      <p class="subtitle">NASA’s Planetary Fact Sheet, drawn · unofficial</p>
    </header>
    ${infoButton()}
    <div class="orrery">
      <svg class="drawing" id="orrery" role="img" aria-label="Schematic of the solar system, not to scale."></svg>
      <nav class="bodies" aria-label="Bodies"><ol>${links}</ol></nav>
    </div>
  </main>
  ${infoDialog('Planetary', '<p>NASA’s Planetary Fact Sheet, drawn as a set of engineering drawings. Unofficial: not affiliated with or endorsed by NASA.</p>')}`;
  return {
    html,
    data: { sheet: 'home', orrery: orreryModel(ctx.issued) },
    title: 'Planetary — NASA’s Planetary Fact Sheet, drawn',
    description:
      'NASA’s Planetary Fact Sheet drawn as engineering drawings: a moving schematic of the solar system and one sheet for each of its ten bodies, every dimension from NASA’s numbers. Unofficial; not affiliated with NASA.',
    ogAlt:
      'Blueprint-style schematic of the solar system, not to scale, with the planets on their orbits',
  };
}
