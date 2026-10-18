// Client side of the home page: the schematic of the solar system and its links. With a mouse or the
// keyboard the links are the targets: pointing at one names its body, clicking it opens its page. A
// finger is coarser, so a tap takes whatever is within reach: one body opens its page, several open a
// chooser that lists them.

import '../styles/home.css';

import type { PageData } from '../render/page.ts';
import { clamp } from '../draw/vec.ts';
import { OrreryView } from '../views/orrery.ts';
import { capture, epoch, exposeViews, params, spinners } from './env.ts';

export function initHome(data: PageData) {
  const svg = document.getElementById('orrery');
  const orrery = svg?.closest<HTMLElement>('.orrery');
  if (!(svg instanceof SVGSVGElement) || !orrery || !data.orrery) return;
  const links = new Map(
    [...orrery.querySelectorAll<HTMLAnchorElement>('nav.bodies a[data-body]')].map((a) => [
      a.dataset.body!,
      a,
    ]),
  );
  // ?capture&date=YYYY-MM-DD: a still drawing for that date.
  const date = params.get('date') ?? '';
  const start = capture && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : epoch;
  const view = new OrreryView(svg, data.orrery, links, start, {
    clock: document.getElementById('clock'),
    still: capture,
  });
  spinners.push(view);
  exposeViews({ orrery: view });

  // Mouse and keyboard: the body under the mouse, else the one with keyboard focus, is named.
  let hovered: string | null = null;
  let focused: string | null = null;
  // Back from the back-forward cache, Chrome replays pointerenter where the mouse clicked, though it
  // has moved since: until the mouse really moves, the links ignore it.
  let stale = false;
  const point = () => view.setActive(hovered ?? focused);
  for (const [id, a] of links) {
    a.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || stale) return;
      hovered = id;
      point();
    });
    a.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      hovered = null;
      point();
    });
    // A tap can focus a link too; only keyboard focus names it.
    a.addEventListener('focus', () => {
      if (!a.matches(':focus-visible')) return;
      focused = id;
      point();
    });
    a.addEventListener('blur', () => {
      focused = null;
      point();
    });
  }
  orrery.addEventListener('pointermove', (e) => {
    if (!stale || e.pointerType !== 'mouse') return;
    stale = false;
    hovered =
      (e.target as Element).closest<HTMLElement>('nav.bodies a[data-body]')?.dataset.body ?? null;
    point();
  });

  // Touch and pen: the bodies within reach of the finger, named while it is down if there is one
  // (clear of the fingertip).
  let tap: { ids: string[]; x: number; y: number } | null = null;
  orrery.addEventListener('pointerdown', (e) => {
    tap = null;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const box = svg.getBoundingClientRect();
    const at: [number, number] = [e.clientX - box.left, e.clientY - box.top];
    tap = { ids: view.within(...at), x: e.clientX, y: e.clientY };
    if (tap.ids.length === 1) view.setActive(tap.ids[0]!, { at });
  });
  const lift = () => {
    if (tap?.ids.length === 1) view.setActive(null);
  };
  orrery.addEventListener('pointerup', lift);
  orrery.addEventListener('pointercancel', lift);
  // The tap's click: one body opens its page, several the chooser. Mouse and keyboard clicks (and
  // long presses, which show the link's preview) are left to the links, and so is a tap that reaches
  // no body.
  orrery.addEventListener(
    'click',
    (e) => {
      const t = tap;
      tap = null;
      if (!t?.ids.length || e.detail === 0) return;
      e.preventDefault();
      if (t.ids.length === 1) location.assign(links.get(t.ids[0]!)!.href);
      else choose(t.ids, t.x, t.y);
    },
    true,
  );

  // The chooser: the bodies under the finger as links, in NASA's order. They light up and the clock
  // stands while it is open; a tap elsewhere or Esc closes it.
  const frame = orrery.closest('.sheet')!;
  const chooser = document.createElement('div');
  chooser.className = 'chooser';
  chooser.popover = 'auto';
  chooser.setAttribute('role', 'group');
  chooser.setAttribute('aria-label', 'Choose a body');
  orrery.after(chooser);
  let candidates: string[] = [];
  chooser.addEventListener('toggle', (e) => {
    if (e.newState === 'open') view.light(candidates);
    else point();
  });

  // Back from a body's page (the back-forward cache keeps this one as it was), the mouse is no
  // longer on the body it clicked (whatever pointerenter says before it moves), and the chooser is
  // done with.
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    hovered = null;
    stale = true;
    chooser.hidePopover();
    point();
  });
  // Turning the phone moves the bodies away from the tap that chose them.
  matchMedia('(orientation: portrait)').addEventListener('change', () => chooser.hidePopover());

  /** Open the chooser above the tap if 200 px are free there, else below, inside the frame. */
  function choose(ids: string[], x: number, y: number) {
    candidates = ids;
    chooser.replaceChildren(
      ...ids.map((id) => {
        const a = document.createElement('a');
        a.href = links.get(id)!.href;
        a.textContent = links.get(id)!.textContent;
        return a;
      }),
    );
    chooser.showPopover();
    const f = frame.getBoundingClientRect();
    const w = chooser.offsetWidth,
      h = chooser.offsetHeight;
    const top = y - f.top >= 200 ? y - 16 - h : y + 16;
    chooser.style.left = `${clamp(x - w / 2, f.left + 8, f.right - 8 - w)}px`;
    chooser.style.top = `${clamp(top, f.top + 8, f.bottom - 8 - h)}px`;
  }
}
