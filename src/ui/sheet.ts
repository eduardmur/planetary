// Client side of a body's page: fills View A and the key plan and ties NASA's rows to them. Content
// changes only on a click, a tap, Enter or Space: a row, or a line in a drawing, opens that row's
// popover, and the one open popover is the selection. Its geometry turns yellow, the views turn where
// the angle needs it, and #key goes into the URL and into the tabs, so the next body opens on the
// same row.

import '../styles/body.css';

import { ALIASES } from '../content/params.ts';
import type { PageData } from '../render/page.ts';
import { BodyView } from '../views/body.ts';
import { KeyPlanView } from '../views/keyplan.ts';
import { reducedMotion } from '../views/view.ts';
import {
  capture,
  captureClock,
  epoch,
  expose,
  exposeViews,
  params,
  phone,
  spinners,
} from './env.ts';

interface Focusable {
  setFocus(key: string | null, o?: { instant?: boolean }): void;
}

/** Phones in portrait, and browsers without anchor positioning, dock the popover at the bottom. */
const docked = () =>
  matchMedia('(max-width: 860px) and (orientation: portrait)').matches ||
  !CSS.supports('anchor-name: --a');

export function initSheet(data: PageData) {
  // Positions are for today; a capture may fix the day (?capture&date=YYYY-MM-DD).
  const fixed = capture ? Date.parse(`${params.get('date')}T00:00:00Z`) : NaN;
  const day = Number.isNaN(fixed) ? epoch : new Date(fixed);
  const epochEl = document.getElementById('epoch');
  if (epochEl) {
    const iso = day.toISOString().slice(0, 10);
    epochEl.textContent = iso;
    epochEl.setAttribute('datetime', iso);
  }

  const svg = (id: string) => document.getElementById(id) as SVGSVGElement | null;
  const focusables: Focusable[] = [];
  const views = document.querySelector<HTMLElement>('.views');

  // NASA's rows: each has its disclosure button and its popover.
  const parts = new Map(
    [...document.querySelectorAll<HTMLTableRowElement>('table.main tr[data-key]')].map((row) => [
      row.dataset.key!,
      {
        row,
        button: row.querySelector<HTMLButtonElement>('th button')!,
        def: row.querySelector<HTMLElement>('.def')!,
      },
    ]),
  );
  const shapeOf = (key: string | null) => (key && parts.get(key)?.row.dataset.shape) || '';

  if (data.body && data.plan) {
    const a = new BodyView(svg('view-a')!, data.body);
    const p = new KeyPlanView(svg('key-plan')!, data.plan, day);
    const viewA = svg('view-a')!;
    const keyPlan = document.querySelector<HTMLElement>('.key-plan')!;
    // On desktop the key plan is an inset in the lower right: View A fits around it and keeps its
    // labels off it.
    const inset = () => {
      a.clearInset = !phone.matches;
      const va = viewA.getBoundingClientRect(),
        kp = keyPlan.getBoundingClientRect();
      a.inset = a.clearInset
        ? {
            x0: kp.left - va.left,
            y0: kp.top - va.top,
            x1: kp.right - va.left,
            y1: kp.bottom - va.top,
          }
        : null;
      a.measure();
    };
    inset();
    phone.addEventListener('change', inset);
    new ResizeObserver(inset).observe(document.querySelector('.views')!);
    if (capture) a.clock = captureClock;
    focusables.push(a, p, {
      // Phones show one drawing at a time: the key plan while an orbit row is selected.
      setFocus(key) {
        if (!phone.matches || !views) return;
        const shape = shapeOf(key);
        if (shape.includes('P')) showPlan(true);
        else if (shape.includes('A')) showPlan(false);
      },
    });
    spinners.push(a);
    exposeViews({ a, p });
  }

  function showPlan(on: boolean) {
    if (!views || views.classList.contains('show-plan') === on) return;
    views.classList.toggle('show-plan', on);
    window.dispatchEvent(new Event('resize'));
    // Keep keyboard focus on the toggle that is now visible.
    const visible = document.querySelector<HTMLButtonElement>(
      `figcaption .swap[data-show="${on ? 'a' : 'plan'}"]`,
    );
    if (document.activeElement?.classList.contains('swap')) visible?.focus();
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('figcaption .swap'))
    b.addEventListener('click', () => showPlan(b.dataset.show === 'plan'));

  /** Captions follow the views as they turn: edge-on for the inclination, square to the axis plane
   *  for the obliquity. */
  function captions(key: string | null) {
    const edge = key === 'orbitalInclination';
    for (const c of document.querySelectorAll<HTMLElement>('.caption')) {
      const turned = edge ? c.dataset.edge : key === 'obliquity' ? c.dataset.tilt : undefined;
      c.textContent = turned ?? c.dataset.plan ?? c.textContent;
    }
    for (const s of document.querySelectorAll<SVGSVGElement>('svg[data-edge-label]'))
      s.setAttribute('aria-label', (edge ? s.dataset.edgeLabel : s.dataset.label) ?? '');
  }

  // ---- Selection: the one open popover ----------------------------------------------------------

  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('.tabs .strip a')];
  const buttons = [...parts.values()].map((p) => p.button);
  const isOpen = (def: HTMLElement) => def.matches(':popover-open');
  /** A row's key, from itself or from an older key that now lives in its popover. */
  const rowKey = (k: string | null | undefined) => {
    const key = k ? (ALIASES[k] ?? k) : null;
    return key && parts.has(key) ? key : null;
  };

  /** Roving tabindex: the table is one Tab stop, on the selected (or last focused) row. */
  const rove = (to: HTMLButtonElement) => {
    for (const b of buttons) b.tabIndex = b === to ? 0 : -1;
  };

  let current: string | null = null;
  /** Set by select() around the toggle it causes: the views turn at once (deep links). */
  let instant = false;

  /** Keep the selected row in sight: just under the sticky block when the popover is docked. */
  function reveal(key: string) {
    parts.get(key)!.row.scrollIntoView({
      block: docked() ? 'start' : 'nearest',
      behavior: instant || capture || reducedMotion() ? 'instant' : 'smooth',
    });
  }

  /** Under its row, or over it where there is more room: decided here, alike in every engine. */
  const header = document.querySelector<HTMLElement>('.tabs');
  function place() {
    if (!current) return;
    const { row, def } = parts.get(current)!;
    const r = row.getBoundingClientRect();
    const head = header?.getBoundingClientRect().bottom ?? 0;
    const side = r.top - head > innerHeight - r.bottom ? 'above' : 'below';
    if (def.dataset.side !== side) def.dataset.side = side;
  }
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('resize', place);

  /** Bring the page in line with the selection: rows, views, captions, the URL and the tabs. */
  function sync(key: string | null) {
    current = key;
    for (const [k, p] of parts) {
      p.button.setAttribute('aria-expanded', String(k === key));
      p.row.classList.toggle('hot', k === key);
    }
    for (const f of focusables) f.setFocus(key, { instant });
    captions(key);
    history.replaceState(null, '', key ? `#${key}` : location.pathname + location.search);
    for (const t of tabs) t.href = t.href.replace(/#.*$/, '') + (key ? `#${key}` : '');
    if (key) {
      rove(parts.get(key)!.button);
      reveal(key);
      place();
    }
  }

  /** Select a row by its key or an alias, or nothing (null). Unknown keys are ignored. */
  function select(k: string | null, o: { instant?: boolean } = {}) {
    const key = rowKey(k);
    if (k !== null && !key) return;
    instant = !!o.instant;
    if (key) {
      const def = parts.get(key)!.def;
      if (!isOpen(def)) def.showPopover();
    } else if (current) parts.get(current)!.def.hidePopover();
    instant = false;
  }

  // The row buttons and × toggle their popovers natively, select() through the same calls: either
  // way the selection follows here, as the toggle happens. One popover is open at a time.
  let switching = false;
  for (const [key, p] of parts) {
    p.button.setAttribute('aria-expanded', 'false');
    p.def.addEventListener('beforetoggle', (e) => {
      if (e.newState === 'open') {
        switching = true;
        for (const [other, q] of parts) if (other !== key && isOpen(q.def)) q.def.hidePopover();
        switching = false;
        sync(key);
      } else if (!switching && current === key) sync(null);
    });
    // × hands focus back to the row it belongs to.
    p.def.querySelector('.close')?.addEventListener('click', () => p.button.focus());
  }
  rove(buttons[0]!);

  // ---- Pointer --------------------------------------------------------------------------------

  /** Row keys of the topmost line under the pointer that belongs to a row (wide hit strokes
   *  included). View A captures the pointer while pressed, so its clicks land on the <svg> itself. */
  function keysAt(drawing: Element, x: number, y: number): string[] | null {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!drawing.contains(el)) continue;
      const keys = (el.getAttribute('data-ref') ?? '')
        .split(' ')
        .map(rowKey)
        .filter((k): k is string => !!k);
      if (keys.length) return keys;
    }
    return null;
  }

  // On the sheet rather than the document: iOS Safari sends taps on plain paper only to listeners
  // below <body>.
  document.querySelector<HTMLElement>('main.sheet')?.addEventListener('click', (e) => {
    const t = e.target as Element;
    const drawing = t.closest<SVGSVGElement>('svg.drawing');
    if (drawing) {
      // Not after a drag, and not the second click of a double-click (which resets View A).
      if (drawing.dataset.dragged === '1' || e.detail > 1) return;
      // A line selects its row, or lets go of it when it is the selected one; blank paper deselects.
      const keys = keysAt(drawing, e.clientX, e.clientY);
      select(keys && !(current && keys.includes(current)) ? keys[0]! : null);
      return;
    }
    const row = t.closest<HTMLTableRowElement>('table.main tr[data-key]');
    if (row && !t.closest('.def, button')) parts.get(row.dataset.key!)!.button.click();
    else if (!t.closest('tr[data-key], .def, button, a, .tabs, dialog')) select(null);
  });

  // ---- Keyboard --------------------------------------------------------------------------------

  const table = document.querySelector<HTMLTableElement>('table.main');
  table?.addEventListener('focusin', (e) => {
    if (buttons.includes(e.target as HTMLButtonElement)) rove(e.target as HTMLButtonElement);
  });
  // ↑ ↓ Home End move along the rows, and move the selection with them while a popover is open.
  table?.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(e.target as HTMLButtonElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const b = buttons[Math.max(0, Math.min(buttons.length - 1, to))]!;
    b.focus();
    if (current) select(b.closest('tr')!.dataset.key!);
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.key === 'Escape') {
      // The dialog closes itself; otherwise Esc lets go of the selection, and focus that was in
      // the popover (or nowhere) goes back to its row.
      if (document.querySelector('dialog[open]') || !current) return;
      const p = parts.get(current)!;
      const at = document.activeElement;
      const back = !at || at === document.body || p.def.contains(at);
      select(null);
      if (back) p.button.focus();
      return;
    }
    // ← → open the previous or next body, on the same row. Arrows keep their own meaning in the
    // drawings (turn), the table (rows), a dialog and form fields.
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if ((e.target as Element).closest('svg.drawing, table, dialog, input, textarea, select'))
      return;
    const i = tabs.findIndex((t) => t.getAttribute('aria-current') === 'page');
    if (i < 0) return;
    const n = tabs.length;
    location.assign(tabs[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]!.href);
  });

  // ---- Deep links ------------------------------------------------------------------------------

  /** The key in the URL's hash, or null; a malformed hash is ignored. */
  const hashKey = () => {
    try {
      return decodeURIComponent(location.hash.slice(1)) || null;
    } catch {
      return null;
    }
  };
  // #obliquity opens the sheet with that row selected and the views already turned; older keys
  // (#polarRadius) open the row that now holds them and rewrite the hash.
  select(hashKey(), { instant: true });
  window.addEventListener('hashchange', () => select(hashKey(), { instant: true }));

  // Where the tab strip scrolls (phones, narrow windows), start with this body's tab in the middle,
  // and again once the condensed web font has narrowed the tabs.
  const strip = document.querySelector<HTMLElement>('.tabs .strip');
  const here = strip?.querySelector<HTMLElement>('[aria-current="page"]');
  const centre = () => {
    if (!strip || !here) return;
    const s = strip.getBoundingClientRect(),
      h = here.getBoundingClientRect();
    strip.scrollLeft += h.left + h.width / 2 - (s.left + s.width / 2);
  };
  centre();
  void document.fonts.ready.then(centre);

  expose({ show: (key: string | null) => select(key) });
}
