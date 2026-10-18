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
const portrait = matchMedia('(max-width: 860px) and (orientation: portrait)');
const docked = () => portrait.matches || !CSS.supports('anchor-name: --a');
/** Short screens (phones on their side): a selected row goes to the edge that leaves its popover
 *  the most room. */
const short = matchMedia('(max-height: 500px)');

export function initBody(data: PageData) {
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
  const root = document.documentElement;
  const frame = document.querySelector<HTMLElement>('main.sheet');
  const views = document.querySelector<HTMLElement>('.views');
  const schedule = document.querySelector<HTMLElement>('.schedule');
  const focusables: Focusable[] = [];

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
  // Without the script the popovers are "auto": one at a time, closed by Esc or a click elsewhere.
  // From here the script keeps the one selection itself. The switch closes a popover opened before
  // the script ran; it opens again below.
  const early = [...parts].find(([, p]) => p.def.matches(':popover-open'))?.[0] ?? null;
  for (const p of parts.values()) p.def.popover = 'manual';
  const shapeOf = (key: string | null) => (key && parts.get(key)?.row.dataset.shape) || '';

  let viewA: BodyView | null = null;
  if (data.body && data.plan) {
    const a = (viewA = new BodyView(svg('view-a')!, data.body));
    const p = new KeyPlanView(svg('key-plan')!, data.plan, day);
    const keyPlan = document.querySelector<HTMLElement>('.key-plan')!;
    // On desktop the key plan is an inset in the lower right: View A fits around it and keeps its
    // labels off it.
    const inset = () => {
      a.clearInset = !phone.matches;
      const va = a.svg.getBoundingClientRect(),
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
    // The caption says where the reader has turned View A.
    a.onTurned = () => captions(current);
    focusables.push(a, p, { setFocus: swap });
    spinners.push(a);
    exposeViews({ a, p });
  }

  /** Phones show one drawing at a time: the key plan while an orbit row is selected, View A while
   *  a row it draws is. */
  function swap(key: string | null) {
    if (!phone.matches || !views) return;
    const shape = shapeOf(key);
    if (shape.includes('P')) showPlan(true);
    else if (shape.includes('A')) showPlan(false);
  }
  function showPlan(on: boolean) {
    if (!views || views.classList.contains('show-plan') === on) return;
    views.classList.toggle('show-plan', on);
    // Keep keyboard focus on the toggle that is now visible. It is in sight already, in the sticky
    // drawing; Chromium would still scroll the table to it.
    const visible = document.querySelector<HTMLButtonElement>(
      `figcaption .swap[data-show="${on ? 'a' : 'plan'}"]`,
    );
    if (document.activeElement?.classList.contains('swap')) visible?.focus({ preventScroll: true });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('figcaption .swap'))
    b.addEventListener('click', () => showPlan(b.dataset.show === 'plan'));

  /** Captions follow the views: View A's says where its camera is (or is turning to), in full and
   *  in short; the key plan's turns edge-on with the inclination. */
  const capsA = document.querySelectorAll<HTMLElement>('.view-a .caption > span');
  const capP = document.querySelector<HTMLElement>('.key-plan .caption');
  function captions(key: string | null) {
    const edge = key === 'orbitalInclination';
    if (viewA) {
      const at = viewA.aspect;
      for (const c of capsA) {
        const text =
          at === 'tilt' ? c.dataset.tilt : at === 'edge' ? c.dataset.edgeOn : c.dataset.plan;
        if (text !== undefined && c.textContent !== text) c.textContent = text;
      }
    }
    capP?.toggleAttribute('data-edge', edge);
    for (const s of document.querySelectorAll<SVGSVGElement>('svg[data-edge-label]'))
      s.setAttribute('aria-label', (edge ? s.dataset.edgeLabel : s.dataset.label) ?? '');
  }

  // ---- Selection: the one open popover ----------------------------------------------------------

  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('.tabs .strip a')];
  const buttons = [...parts.values()].map((p) => p.button);
  const order = [...parts.keys()];
  const steps = [...document.querySelectorAll<HTMLButtonElement>('.steps .step')];
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
  // A tablet turned (or a window narrowed) into the one-drawing layout shows the drawing the
  // selected row needs.
  phone.addEventListener('change', () => swap(current));
  /** Set by select() around the toggle it causes: the views turn at once (deep links). */
  let instant = false;
  /** The same, kept for the open popover's toggle event, which comes after select() returns. */
  let openedInstant = false;
  const behavior = (now = false): ScrollBehavior =>
    now || instant || capture || reducedMotion() ? 'instant' : 'smooth';

  // Docked, the sheet covers the foot of the screen. While it is open, a "tail" of padding under the
  // table lets every row, down to the last, scroll up above it; after the sheet closes the tail
  // shrinks only where it lies below the screen, so nothing on screen ever moves.
  let tail = 0;
  const setTail = (px: number) => {
    const t = Math.max(0, Math.ceil(px));
    if (t === tail) return;
    tail = t;
    schedule?.style.setProperty('--tail', `${t}px`);
  };
  function trim() {
    if (!tail || !schedule || (current && docked())) return;
    const below = schedule.getBoundingClientRect().bottom - innerHeight;
    if (below > 0) setTail(tail - Math.min(tail, below));
  }

  /**
   * Keep the selected row in sight. Docked: between the sticky block and the sheet, once the sheet
   * is open and has its height. Otherwise the nearest way, and on the desktop layout clear of the row
   * stepper; on short screens the row goes to the edge that leaves its popover the most room.
   */
  function reveal(key: string, now = false) {
    const { row, def } = parts.get(key)!;
    const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    if (docked()) {
      if (!isOpen(def)) return;
      const r = row.getBoundingClientRect();
      // The sheet sits on the foot of the screen; its own top can lag a turn of the phone.
      const stop = innerHeight - def.getBoundingClientRect().height - 8;
      // Room for the last row above the sheet.
      const last = rowEls.at(-1)!.getBoundingClientRect().bottom - stop;
      const max = root.scrollHeight - innerHeight;
      if (scrollY + last > max) setTail(tail + scrollY + last - max);
      const under = r.bottom - stop;
      const dy = under > 0 ? Math.min(under, r.top - pad) : Math.min(0, r.top - pad);
      if (Math.abs(dy) >= 1) scrollTo({ top: scrollY + dy, behavior: behavior(now) });
      return;
    }
    let block: ScrollLogicalPosition = 'nearest';
    if (short.matches) {
      const top = scrollY + row.getBoundingClientRect().top - pad;
      block = top <= root.scrollHeight - innerHeight ? 'start' : 'end';
      // The side it will have there, kept while the page scrolls there, so it does not flip midway.
      pinned = { key, side: block === 'start' ? 'below' : 'above', until: performance.now() + 800 };
    } else if (shown(stepper)) {
      // Below the stepper, which is 2 px under the header or where the reader's steps hold it. A row
      // stepped to with it comes at once: a smooth scroll would leave the stepper over it for a few
      // frames.
      const r = row.getBoundingClientRect();
      const top = Math.max(pad + 2, held?.top ?? 0) + stepper!.offsetHeight + 2;
      const foot = innerHeight - (parseFloat(getComputedStyle(root).scrollPaddingBottom) || 0);
      const dy = r.top < top ? r.top - top : Math.max(0, Math.min(r.bottom - foot, r.top - top));
      if (Math.abs(dy) >= 1) scrollTo({ top: scrollY + dy, behavior: behavior(now || !!held) });
      return;
    }
    row.scrollIntoView({ block, behavior: behavior(now) });
  }
  let pinned: { key: string; side: string; until: number } | null = null;
  window.addEventListener('scrollend', () => (pinned = null));

  /**
   * Under its row, or over it where there is more room: placed here, alike in every engine, and
   * kept up as the page scrolls. Plain fixed positioning, from the row and the table: an anchored
   * popover that changes size as the page scrolls lands off its row in Chromium, and WebKit scrolls
   * one back to its top. The popover stays between the header (on the desktop layout, the row stepper
   * under it) and the foot of the frame, or of the screen where the frame runs on below it; a popover
   * under a row that has gone under the header goes under it too.
   */
  const header = document.querySelector<HTMLElement>('.tabs');
  const caption = document.querySelector<HTMLElement>('table.main caption');
  const stepper = document.querySelector<HTMLElement>('.steps');
  const table = document.querySelector<HTMLTableElement>('table.main');
  const PLACED = ['top', 'bottom', 'left', 'width', 'max-height', 'min-height', 'clip-path'];
  /** The room a popover has: under the header (on the desktop layout, from the first rule under the
   *  row stepper) and above the foot of the frame, or of the screen (above the home indicator) where
   *  the frame runs on below it. */
  function bounds() {
    const head = header?.getBoundingClientRect().bottom ?? 0;
    let ceiling = head;
    if (shown(stepper)) {
      // A row's rule, not the stepper's foot, which can lie across a row: the row the stepper stands
      // on stays whole above a popover, but for its end under the stepper.
      const under = Math.max(head, stepper!.getBoundingClientRect().bottom);
      ceiling =
        rowEls.map((r) => r.getBoundingClientRect().top).find((v) => v >= under - 0.5) ?? under;
    }
    const frameFoot = frame?.getBoundingClientRect().bottom ?? Infinity;
    const safe = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const floor = frameFoot <= innerHeight - safe ? frameFoot - 4 : innerHeight - safe;
    return { head, ceiling, floor };
  }
  /** Laid out at all (the stepper is only on the desktop layout); a fixed element has no
   *  offsetParent, so that cannot tell. */
  const shown = (el: Element | null) => !!el && el.getClientRects().length > 0;
  /** Where the stepper was when the reader stepped to this row with it (its top): it stays there
   *  while they step on, though the page scrolls to the next row, so the pointer never has to
   *  follow it. Any other selection lets it go. */
  let held: { top: number; key: string } | null = null;
  /** The stepper rides on the caption line and stays under the header once the table has scrolled
   *  up under it, so the rows can be stepped through without moving the pointer. */
  function placeStepper(head: number) {
    if (!stepper || !schedule) return;
    if (!current || !shown(stepper)) {
      for (const k of ['position', 'top', 'right']) stepper.style.removeProperty(k);
      return;
    }
    // Where its CSS puts it on the caption line (4 px down, 8 px in from the column's right edge),
    // but on the screen, never under the header, and not above where the reader's steps hold it.
    const sc = schedule.getBoundingClientRect();
    stepper.style.position = 'fixed';
    stepper.style.top = `${Math.max(head + 2, sc.top + 4, held?.top ?? -Infinity)}px`;
    stepper.style.right = `${root.clientWidth - sc.right + 8}px`;
  }
  function place() {
    placeStepper(header?.getBoundingClientRect().bottom ?? 0);
    if (!current) return;
    const { row, def } = parts.get(current)!;
    if (docked()) {
      for (const k of PLACED) def.style.removeProperty(k);
      return;
    }
    const r = row.getBoundingClientRect();
    const t = table!.getBoundingClientRect();
    const { head, ceiling, floor } = bounds();
    const pin = pinned?.key === current && performance.now() < pinned.until ? pinned.side : null;
    const side = pin ?? (r.top - ceiling > floor - r.bottom ? 'above' : 'below');
    if (def.dataset.side !== side) def.dataset.side = side;
    const room = side === 'above' ? r.top - ceiling - 4 : floor - Math.max(r.bottom, head) - 4;
    def.style.left = `${t.left}px`;
    def.style.width = `${t.width}px`;
    def.style.top = side === 'below' ? `${r.bottom + 4}px` : 'auto';
    def.style.bottom = side === 'above' ? `${root.clientHeight - r.top + 4}px` : 'auto';
    def.style.maxHeight = `${Math.max(0, room)}px`;
    // The part of a popover under its row that has gone under the header.
    const under = side === 'below' ? head - r.bottom - 4 : 0;
    def.style.clipPath = under > 0 ? `inset(${under}px 0 0 0)` : '';
    fit();
  }

  /**
   * The open popover's far edge goes to the next row rule (or the caption, the last row, the
   * legend), so it never cuts a line of text in half; never past the room place() gave it. Measured
   * once the popover is open: place() runs before it has a height.
   */
  const rowEls = [...parts.values()].map((p) => p.row);
  const legend = document.querySelector<HTMLElement>('.sheet-body .legend');
  function fit() {
    if (!current) return;
    const { row, def } = parts.get(current)!;
    def.style.minHeight = '';
    if (docked() || !isOpen(def)) return;
    const d = def.getBoundingClientRect();
    const { ceiling, floor } = bounds();
    const tops = rowEls.map((r) => r.getBoundingClientRect().top);
    const cap = caption?.getBoundingClientRect().top ?? -Infinity;
    const leg = legend?.getBoundingClientRect();
    // Less than a line of text left between the popover and the end of its room reads as a misprint:
    // then the popover runs on to the end of the room instead.
    const LINE = 18;
    if (def.dataset.side === 'above') {
      // Rules above the popover's natural top, in order down the page: the legend's (where it comes
      // before the table, on phones), the caption's, then the rows'.
      const stops = [...(leg && leg.top < cap ? [leg.top - 3] : []), cap - 3, ...tops];
      let y = stops.findLast((v) => v <= d.top + 0.5 && v >= ceiling);
      if (y === undefined || y - ceiling < LINE) y = ceiling;
      def.style.minHeight = `${d.bottom - y}px`;
    } else {
      const top = row.getBoundingClientRect().bottom + 4;
      const last = rowEls.at(-1)!.getBoundingClientRect().bottom;
      const stops = [...tops, last, ...(leg && leg.top > last ? [leg.bottom + 3] : [])];
      // A rule beyond the room runs it to the end of the room; past the last rule there is no text
      // left to cut, and the popover keeps its own height.
      const next = stops.find((v) => v >= d.bottom - 0.5);
      const y =
        next === undefined ? (floor - d.bottom < LINE ? floor : d.bottom) : Math.min(next, floor);
      def.style.minHeight = `${y - top}px`;
    }
  }

  window.addEventListener(
    'scroll',
    () => {
      place();
      trim();
    },
    { passive: true },
  );
  window.addEventListener('resize', () => {
    if (!docked()) setTail(0);
    place();
  });
  void document.fonts.ready.then(fit);

  // Safari throws past 100 history writes in 10 s, and Chrome drops them past 200: write at once
  // when the last write is at least 150 ms old, otherwise once the burst pauses.
  let lastWrite = -Infinity;
  let pending: number | undefined;
  function writeHash() {
    clearTimeout(pending);
    const write = () => {
      lastWrite = performance.now();
      try {
        history.replaceState(
          null,
          '',
          current ? `#${current}` : location.pathname + location.search,
        );
      } catch {
        // Refused by a rate limit: the page stays right, and the next selection writes again.
      }
    };
    const wait = lastWrite + 150 - performance.now();
    if (wait <= 0) write();
    else pending = window.setTimeout(write, wait);
    flush = write;
  }
  /** Write a pending hash now, before the page is left (Back must come back to the right row). */
  let flush: (() => void) | null = null;
  const flushHash = () => {
    if (pending === undefined) return;
    clearTimeout(pending);
    pending = undefined;
    flush?.();
  };

  /** Bring the page in line with the selection: rows, views, captions, the tabs and the URL. */
  function sync(key: string | null) {
    const was = current;
    current = key;
    if (held?.key !== key) held = null;
    if (was && was !== key) for (const k of PLACED) parts.get(was)!.def.style.removeProperty(k);
    for (const [k, p] of parts) {
      p.button.setAttribute('aria-expanded', String(k === key));
      p.row.classList.toggle('hot', k === key);
    }
    for (const f of focusables) f.setFocus(key, { instant });
    captions(key);
    for (const t of tabs) t.href = t.href.replace(/#.*$/, '') + (key ? `#${key}` : '');
    const i = key ? order.indexOf(key) : -1;
    for (const b of steps) {
      const end = b.dataset.step === '-1' ? i <= 0 : i < 0 || i >= order.length - 1;
      b.setAttribute('aria-disabled', String(end));
    }
    if (key) {
      rove(parts.get(key)!.button);
      // A docked sheet is revealed from its toggle event, once it has its height.
      if (!docked()) reveal(key);
      place();
    } else {
      trim();
      placeStepper(0);
    }
    writeHash();
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

  /** A click on View A's blank paper that may be the first of a double-click closes after a beat. */
  let closing: number | undefined;

  // The row buttons and × toggle their popovers natively, select() through the same calls: either
  // way the selection follows here, as the toggle happens. One popover is open at a time.
  let switching = false;
  for (const [key, p] of parts) {
    p.button.setAttribute('aria-expanded', 'false');
    p.def.addEventListener('beforetoggle', (e) => {
      if (e.newState === 'open') {
        clearTimeout(closing);
        openedInstant = instant;
        switching = true;
        for (const [other, q] of parts) if (other !== key && isOpen(q.def)) q.def.hidePopover();
        switching = false;
        sync(key);
      } else if (!switching && current === key) sync(null);
    });
    p.def.addEventListener('toggle', (e) => {
      if (e.newState !== 'open' || current !== key) return;
      if (docked()) reveal(key, openedInstant);
      fit();
    });
    // × hands focus back to the row it belongs to.
    p.def.querySelector('.close')?.addEventListener('click', () => p.button.focus());
  }
  rove(buttons[0]!);

  // ‹ › step to the previous or next row: on the caption line (the desktop layout), which stays put
  // meanwhile, or in the popover's header (elsewhere), where focus on one goes on to the same button
  // in the next popover. ↑ ↓ step from either too.
  function stepFrom(b: HTMLButtonElement, by: number) {
    if (!current) return;
    const key = order[Math.max(0, Math.min(order.length - 1, order.indexOf(current) + by))]!;
    const inStepper = !!stepper?.contains(b);
    const focused = document.activeElement === b;
    if (inStepper) held = { top: stepper!.getBoundingClientRect().top, key };
    select(key);
    if (!inStepper && focused)
      parts
        .get(key)!
        .def.querySelector<HTMLButtonElement>(`.step[data-step="${b.dataset.step}"]`)
        ?.focus({ preventScroll: true });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('.step')) {
    b.addEventListener('click', () => stepFrom(b, Number(b.dataset.step)));
    b.addEventListener('keydown', (e) => {
      const by = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (by === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      stepFrom(b, by);
    });
  }

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

  const viewAEl = svg('view-a');
  /** The selection before the last click on a drawing, and where the page was scrolled then. */
  let beforeClick: string | null = null;
  let beforeY = 0;
  /** A double-click or a double tap on View A resets the view and leaves the selection as it was
   *  before its first click, and the table where it was (on a phone that click's row has scrolled
   *  it). */
  const keepSelection = () => {
    clearTimeout(closing);
    if (current === beforeClick) return;
    select(beforeClick);
    // Again a frame later: Chromium adds the next step of a smooth scroll in flight to the first.
    const back = () => scrollTo({ top: beforeY, behavior: 'instant' });
    back();
    requestAnimationFrame(back);
  };
  frame?.addEventListener(
    'dblclick',
    (e) => {
      if (viewAEl?.contains(e.target as Node)) keepSelection();
    },
    true,
  );

  // On the sheet rather than the document: iOS Safari sends taps on plain paper only to listeners
  // below <body>.
  frame?.addEventListener('click', (e) => {
    const t = e.target as Element;
    const drawing = t.closest<SVGSVGElement>('svg.drawing');
    if (drawing) {
      // The second tap of a double tap, which has reset View A.
      if (drawing.dataset.dbltap === '1') {
        delete drawing.dataset.dbltap;
        keepSelection();
        return;
      }
      if (e.detail <= 1) {
        beforeClick = current;
        beforeY = scrollY;
      }
      // Not after a drag, and not the second click of a double-click (which resets View A).
      if (drawing.dataset.dragged === '1' || e.detail > 1) return;
      // A line selects its row, or lets go of it when it is the selected one; blank paper deselects.
      const keys = keysAt(drawing, e.clientX, e.clientY);
      const next = keys && !(current && keys.includes(current)) ? keys[0]! : null;
      clearTimeout(closing);
      // On View A, letting go waits a beat: the click may be the first of a double-click.
      if (next === null && current && drawing === viewAEl)
        closing = window.setTimeout(() => select(null), 300);
      else select(next);
      return;
    }
    const row = t.closest<HTMLTableRowElement>('table.main tr[data-key]');
    if (row && !t.closest('.def, button')) parts.get(row.dataset.key!)!.button.click();
    else if (!t.closest('tr[data-key], .def, button, a, .tabs, dialog')) select(null);
  });

  // ---- Keyboard --------------------------------------------------------------------------------

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
      // the popover or on the stepper (or nowhere) goes back to its row.
      if (document.querySelector('dialog[open]') || !current) return;
      const p = parts.get(current)!;
      const at = document.activeElement;
      const back = !at || at === document.body || p.def.contains(at) || !!stepper?.contains(at);
      select(null);
      if (back) p.button.focus();
      return;
    }
    // ← → open the previous or next body, on the same row; in the table ↑ ↓ walk the rows and ← →
    // the bodies. Arrows keep their own meaning in the drawings (turn), on the stepper (rows), in a
    // popover, a dialog and form fields.
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const n = tabs.length;
    const step = e.key === 'ArrowRight' ? 1 : n - 1;
    // On a tab the keyboard is visibly on, ← → move along the strip from that tab; Enter opens it.
    const j = tabs.indexOf(e.target as HTMLAnchorElement);
    if (j >= 0 && tabs[j]!.matches(':focus-visible')) {
      e.preventDefault();
      tabs[(j + step) % n]!.focus();
      return;
    }
    if ((e.target as Element).closest('svg.drawing, .steps, .def, dialog, input, textarea, select'))
      return;
    const i = tabs.findIndex((t) => t.getAttribute('aria-current') === 'page');
    if (i < 0) return;
    flushHash();
    location.assign(tabs[(i + step) % n]!.href);
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
  // (#polarRadius) open the row that now holds them and rewrite the hash. A row opened before the
  // script ran stays open.
  const linked = hashKey();
  select(rowKey(linked) ? linked : early, { instant: true });
  window.addEventListener('hashchange', () => {
    select(hashKey(), { instant: true });
    // A fragment that is not a row (the skip link's #schedule), or an older key of the open row,
    // leaves the selection as it is: its #key stays in the address.
    if (current && location.hash !== `#${current}`) writeHash();
  });

  // ---- Tab strip -------------------------------------------------------------------------------

  // Where the strip scrolls (phones, narrow windows), it starts with this body's tab in the middle,
  // and again once the condensed web font has narrowed the tabs. The side with hidden tabs fades,
  // and a mouse can scroll it with the wheel or the ‹ › at its ends.
  const strip = document.querySelector<HTMLElement>('.tabs .strip');
  const nav = strip?.parentElement;
  const here = strip?.querySelector<HTMLElement>('[aria-current="page"]');
  const range = document.createRange();
  const edges = () => {
    if (!strip || !nav) return;
    // A side hides tabs where the name of the end tab runs past it, not where only padding does.
    const s = strip.getBoundingClientRect();
    range.selectNodeContents(tabs[0]!);
    const left = range.getBoundingClientRect().left < s.left - 0.5;
    range.selectNodeContents(tabs.at(-1)!);
    const right = range.getBoundingClientRect().right > s.right + 0.5;
    const more = left && right ? 'both' : left ? 'left' : right ? 'right' : '';
    if (nav.dataset.more !== more) nav.dataset.more = more;
  };
  const centre = () => {
    if (!strip || !here) return;
    const s = strip.getBoundingClientRect(),
      h = here.getBoundingClientRect();
    strip.scrollLeft += h.left + h.width / 2 - (s.left + s.width / 2);
    edges();
  };
  centre();
  void document.fonts.ready.then(centre);
  if (strip) {
    strip.addEventListener('scroll', edges, { passive: true });
    new ResizeObserver(edges).observe(strip);
    // A vertical wheel scrolls the strip while it can move that way; then the page again.
    strip.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
        const max = strip.scrollWidth - strip.clientWidth;
        const dy =
          e.deltaMode === 1
            ? e.deltaY * 16
            : e.deltaMode === 2
              ? e.deltaY * strip.clientWidth
              : e.deltaY;
        if (
          max <= 0 ||
          (dy < 0 && strip.scrollLeft <= 0) ||
          (dy > 0 && strip.scrollLeft >= max - 1)
        )
          return;
        e.preventDefault();
        strip.scrollBy({ left: dy });
      },
      { passive: false },
    );
    // A tab that takes keyboard focus comes out from under the faded edges. Only keyboard focus: a
    // tab that a press focuses must stay under the finger or the mouse, or the click is lost.
    strip.addEventListener('focusin', (e) => {
      if (!(e.target as Element).matches(':focus-visible')) return;
      const st = strip.getBoundingClientRect(),
        r = (e.target as Element).getBoundingClientRect(),
        pad = 32;
      const d =
        r.left < st.left + pad
          ? r.left - st.left - pad
          : r.right > st.right - pad
            ? r.right - st.right + pad
            : 0;
      if (d) strip.scrollBy({ left: d, behavior: 'instant' });
    });
    // A click on a tab right after a selection takes the selected row along in the address too.
    for (const t of tabs) t.addEventListener('click', flushHash, true);
    for (const m of nav?.querySelectorAll<HTMLElement>('.more') ?? [])
      m.addEventListener('click', () =>
        strip.scrollBy({
          left: Number(m.dataset.dir) * 0.8 * strip.clientWidth,
          behavior: 'smooth',
        }),
      );
  }

  // Turning the phone: the current tab and the selected row come back into sight, and the popover
  // takes its new place; once more after the resize that follows (or 200 ms on), during which WebKit
  // may scroll the page by itself. Not on every resize: phones resize as their toolbars slide away
  // while the page scrolls, and that must not pull the page back to the row.
  const inSight = () => {
    if (!current) return;
    place();
    reveal(current, true);
    place();
  };
  matchMedia('(orientation: portrait)').addEventListener('change', () => {
    requestAnimationFrame(() => {
      centre();
      if (!docked()) setTail(0);
      inSight();
    });
    const again = () => {
      clearTimeout(late);
      removeEventListener('resize', again);
      requestAnimationFrame(inSight);
    };
    const late = setTimeout(again, 200);
    addEventListener('resize', again);
  });

  expose({ show: (key: string | null) => select(key) });
}
