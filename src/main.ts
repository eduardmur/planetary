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

// The heading takes focus as the dialog opens. Set from here, after parsing, it focuses nothing on
// load; in the markup it would scroll a page without the script down to the inline notes.
document.getElementById('info-title')?.setAttribute('autofocus', '');

// The open dialog stops the page scrolling. Where the page had a scrollbar, its gutter stays, so
// nothing behind the dialog moves; measured as "?" is pressed, before the dialog opens.
const root = document.documentElement;
document.addEventListener(
  'click',
  (e) => {
    if (e.target instanceof Element && e.target.closest('button[command="show-modal"]'))
      root.classList.toggle('has-scrollbar', innerWidth > root.clientWidth);
  },
  true,
);

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
// Light dismiss where closedby="any" is not supported (older Safari): close only when the press and
// the click both land on the backdrop, as native light dismiss does.
if (!('closedBy' in HTMLDialogElement.prototype)) {
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
    const onBackdrop = (e: MouseEvent) => {
      if (e.target !== d) return false; // the backdrop hit-tests as the dialog
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let downOnBackdrop = false;
    d.addEventListener('pointerdown', (e) => {
      downOnBackdrop = onBackdrop(e);
    });
    d.addEventListener('click', (e) => {
      if (downOnBackdrop && onBackdrop(e)) d.close();
      downOnBackdrop = false;
    });
  }
}

// ---- Page script -----------------------------------------------------------------------------------

if (data.sheet === 'home') initHome(data);
else initSheet(data);
// The page is set up: it keeps its layout for the script (see JS_CLASS in src/render/page.ts).
root.classList.add('live');

// ---- Pause ---------------------------------------------------------------------------------------

const pause = document.getElementById('pause');
let paused = reducedMotion();
const setPaused = (p: boolean) => {
  paused = p;
  for (const s of spinners) s.setPaused(p);
  if (pause) {
    // The text stays for screen readers; narrow layouts may draw it as an icon from data-paused.
    pause.textContent = p ? 'Play' : 'Pause';
    pause.dataset.paused = String(p);
  }
};
setPaused(paused);
pause?.addEventListener('click', () => setPaused(!paused));
document.addEventListener('visibilitychange', () => {
  for (const s of spinners) s.setPaused(document.hidden || paused);
});

expose({ setPaused });
