// What every page's script shares: capture mode for the media script, today's date, the views that
// move by themselves (for Pause), and the hooks for captures and tests.

/** ?capture[=og|poster]&t=<ms>: a still, reproducible frame for the media script. */
export const params = new URLSearchParams(location.search);
export const capture = params.has('capture');
export const captureClock = () => Number(params.get('t') ?? 2500);

/** Positions are drawn for today (UTC midnight). */
const now = new Date();
export const epoch = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Phones (either way up, big ones in landscape too) and narrow windows show one drawing at a time. */
export const phone = matchMedia('(max-width: 860px), (max-height: 500px)');

export interface Spinning {
  setPaused(p: boolean): void;
}
/** Views that move by themselves; Pause stops them all. */
export const spinners: Spinning[] = [];

type Hooks = { views?: Record<string, unknown> } & Record<string, unknown>;
const hooks = () => window as unknown as { __pb?: Hooks };

/** Hooks for scripted captures (npm run media) and tests, as window.__pb. */
export function expose(entries: Record<string, unknown>) {
  hooks().__pb = { ...(hooks().__pb ?? {}), ...entries };
}
export function exposeViews(views: Record<string, unknown>) {
  expose({ views: { ...(hooks().__pb?.views ?? {}), ...views } });
}
