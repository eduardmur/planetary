// Client entry for every page: the shared parts (title lettering, the "?" dialog, Pause, capture
// mode), then the home page's or a body page's own script.

import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import './styles/sheet.css';
import './styles/drawing.css';

import { CAP, letter, type TextSize } from './draw/lettering.ts';
import { DrawList, SvgScene } from './draw/svg.ts';
import type { PageData } from './render/page.ts';
import { capture, expose, params, spinners } from './ui/env.ts';
import { initHome } from './ui/home.ts';
import { initSheet } from './ui/sheet.ts';
import { reducedMotion } from './views/view.ts';

const data = JSON.parse(document.getElementById('page-data')!.textContent!) as PageData;
if (capture) {
  document.documentElement.classList.add('capture', `capture-${params.get('capture') || 'sheet'}`);
}

// ---- Title lettering -----------------------------------------------------------------------------

/** Hershey lettering for <svg class="title-lettering" data-text data-size>. */
for (const el of document.querySelectorAll<SVGSVGElement>('svg.title-lettering')) {
  const size = (el.dataset.size ?? 'xl') as TextSize;
  const cap = CAP[size];
  const dl = new DrawList();
  const box = letter(dl, el.dataset.text ?? '', 0, cap * 1.2, { size, halo: false });
  const w = Math.max(...box.map((p) => p[0])) + 4;
  const h = Math.ceil(cap * 1.5);
  el.setAttribute('viewBox', `-1 -1 ${w} ${h}`);
  el.setAttribute('width', String(w));
  el.setAttribute('height', String(h));
  el.replaceChildren();
  new SvgScene(el).commit(dl);
}

// ---- The "?" dialog --------------------------------------------------------------------------------

// Invoker commands (command="show-modal" / "close") where the browser lacks them.
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[commandfor]')) {
    b.addEventListener('click', () => {
      const d = document.getElementById(b.getAttribute('commandfor') ?? '');
      if (!(d instanceof HTMLDialogElement)) return;
      if (b.getAttribute('command') === 'show-modal') d.showModal();
      else if (b.getAttribute('command') === 'close') d.close();
    });
  }
}
// A click on the backdrop closes the dialog where closedby="any" is not supported.
for (const d of document.querySelectorAll<HTMLDialogElement>('dialog')) {
  d.addEventListener('click', (e) => {
    const r = d.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close();
  });
}

// ---- Page script -----------------------------------------------------------------------------------

if (data.sheet === 'home') initHome(data);
else initSheet(data);

// ---- Pause ---------------------------------------------------------------------------------------

const pause = document.getElementById('pause');
let paused = reducedMotion();
const setPaused = (p: boolean) => {
  paused = p;
  for (const s of spinners) s.setPaused(p);
  if (pause) pause.textContent = p ? 'Play' : 'Pause';
};
setPaused(paused);
pause?.addEventListener('click', () => setPaused(!paused));
document.addEventListener('visibilitychange', () => {
  for (const s of spinners) s.setPaused(document.hidden || paused);
});

expose({ setPaused });
