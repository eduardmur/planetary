// Client side of a body's page: fills View A and the key plan from the page data and links NASA's
// rows to them. Pointing at (or tapping, or tabbing to) a row lights up the geometry it describes and
// shows NASA's definition; pointing at a drawn feature lights up its row.

import '../styles/body.css';

import type { PageData } from '../render/page.ts';
import { BodyView } from '../views/body.ts';
import { KeyPlanView } from '../views/keyplan.ts';
import { capture, captureClock, epoch, expose, exposeViews, phone, spinners } from './env.ts';

interface Focusable {
  setFocus(key: string | null): void;
}

export function initSheet(data: PageData) {
  const defs = data.defs ?? {};
  const epochEl = document.getElementById('epoch');
  if (epochEl) {
    const iso = epoch.toISOString().slice(0, 10);
    epochEl.textContent = iso;
    epochEl.setAttribute('datetime', iso);
  }

  const svg = (id: string) => document.getElementById(id) as SVGSVGElement | null;
  const focusables: Focusable[] = [];
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('tbody tr[data-key]')];
  const views = document.querySelector<HTMLElement>('.views');

  if (data.body && data.plan) {
    const a = new BodyView(svg('view-a')!, data.body);
    const p = new KeyPlanView(svg('key-plan')!, data.plan, epoch);
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
      // Phones show one drawing at a time: the key plan while an orbit row is in focus.
      setFocus(key) {
        if (!phone.matches || !views) return;
        const shape = rows.find((r) => r.dataset.key === key)?.dataset.shape ?? '';
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

  const definition = document.getElementById('definition');
  const home = definition?.parentElement ?? null;
  const homeNext = definition?.nextSibling ?? null;
  let shown: string | null | undefined;
  let pinned: string | null = null;
  let hovered: string | null = null;

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

  function show(key: string | null) {
    if (key === shown) return;
    shown = key;
    for (const f of focusables) f.setFocus(key);
    for (const r of rows) r.classList.toggle('hot', r.dataset.key === key);
    captions(key);
    const def = key ? defs[key] : null;
    if (!definition) return;
    definition.classList.toggle('defining', !!def);
    if (def) {
      // NASA's term as printed; its unit keeps its case.
      const m = def.term.match(/^(.*?)\s*(\([^()]*\))?\s*$/);
      const term = definition.querySelector('.term')!;
      term.textContent = m?.[1] ?? def.term;
      if (m?.[2]) {
        const unit = document.createElement('span');
        unit.className = 'si';
        unit.textContent = ` ${m[2]}`;
        term.append(unit);
      }
      definition.querySelector('.text')!.textContent = def.text;
      const src = definition.querySelector('.src')!;
      src.textContent = 'NASA definition — ';
      const a = document.createElement('a');
      a.href = def.src;
      a.textContent = new URL(def.src).pathname.split('/').pop() ?? def.src;
      src.append(a);
    }
    placeDefinition(key);
  }

  /** On phones the definition sits under the row in focus, where the eye already is. */
  function placeDefinition(key: string | null) {
    if (!definition || !home) return;
    document.querySelector('tr.def-row')?.remove();
    const row = key ? rows.find((r) => r.dataset.key === key) : undefined;
    if (phone.matches && row) {
      const tr = document.createElement('tr');
      tr.className = 'def-row';
      const td = document.createElement('td');
      td.colSpan = row.children.length;
      td.append(definition);
      tr.append(td);
      row.after(tr);
      if (!capture) requestAnimationFrame(() => tr.scrollIntoView({ block: 'nearest' }));
    } else if (definition.parentElement !== home) home.insertBefore(definition, homeNext);
  }
  phone.addEventListener('change', () => placeDefinition(shown ?? null));

  const current = () => hovered ?? pinned;
  const pin = (key: string | null) => {
    pinned = key;
    hovered = null;
    history.replaceState(null, '', key ? `#${key}` : location.pathname + location.search);
    show(current());
  };

  let keyboard = false;
  document.addEventListener('keydown', () => (keyboard = true), true);
  document.addEventListener('pointerdown', () => (keyboard = false), true);

  for (const r of rows) {
    const key = r.dataset.key!;
    r.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      hovered = key;
      show(current());
    });
    r.addEventListener('click', () => pin(pinned === key ? null : key));
    r.addEventListener('focus', () => {
      // Keyboard focus pins the row; a tap focuses too, but its click does the pinning.
      if (keyboard) pin(key);
    });
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pin(key);
      }
    });
  }
  // A hovered definition stays while the pointer is over the table or the definition itself, so it
  // can be read and its link followed (WCAG 1.4.13); it goes when the pointer leaves that area.
  for (const area of document.querySelectorAll<HTMLElement>('.schedule, .ga-table')) {
    area.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch' || !hovered) return;
      hovered = null;
      show(current());
    });
  }

  // Pointing at a drawn feature lights up its row (and its definition).
  const rowKeys = new Set(rows.map((r) => r.dataset.key!));
  const keyOf = (target: EventTarget | null) => {
    const refs =
      (target as Element | null)?.closest?.('[data-ref]')?.getAttribute('data-ref')?.split(' ') ??
      [];
    return refs.find((k) => rowKeys.has(k)) ?? refs.find((k) => defs[k]);
  };
  for (const s of document.querySelectorAll<SVGSVGElement>('svg.drawing')) {
    s.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch' || s.classList.contains('dragging')) return;
      const key = keyOf(e.target);
      if (key) {
        hovered = key;
        show(current());
      }
    });
    s.addEventListener('pointerleave', () => {
      if (hovered) {
        hovered = null;
        show(current());
      }
    });
    // A tap (not a drag) on a drawn feature pins its row, as tapping the row does.
    s.addEventListener('click', (e) => {
      if (s.dataset.dragged === '1') return;
      const key = keyOf(e.target);
      if (key) pin(pinned === key ? null : key);
    });
  }

  // Deep link: #obliquity opens the sheet with that row in focus, scrolled into view.
  let hash = '';
  try {
    hash = decodeURIComponent(location.hash.slice(1));
  } catch {
    /* a malformed hash is ignored */
  }
  if (hash && (rowKeys.has(hash) || defs[hash])) {
    pinned = hash;
    show(pinned);
    const row = rows.find((r) => r.dataset.key === hash);
    if (row && !capture) requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('svg.drawing, input, textarea, .ga-table')) return;
    if (e.key === 'ArrowLeft') document.querySelector<HTMLAnchorElement>('a[rel="prev"]')?.click();
    if (e.key === 'ArrowRight') document.querySelector<HTMLAnchorElement>('a[rel="next"]')?.click();
    if (e.key === 'Escape') pin(null);
  });

  expose({ show: (key: string | null) => pin(key) });
}
