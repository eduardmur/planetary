// Static HTML for every page, rendered at build time. NASA's values, definitions and notes are real
// HTML (readable without JavaScript, by search engines and by screen readers); the drawings are empty
// <svg> elements that src/main.ts fills from the page's embedded data.

import { SHEETS, type Sheet } from '../content/sheets.ts';
import { bodySheet } from './body.ts';
import { esc, type PageCtx, type Rendered } from './common.ts';
import { homeSheet } from './home.ts';

export type { PageCtx, PageData, Rendered } from './common.ts';

/**
 * .js lays the page out for its script. src/main.ts adds .live once the script has set the page up;
 * if the bundle fails to load or throws, .js comes off again at DOMContentLoaded (which waits for a
 * module script) and the page falls back to its layout without JavaScript.
 */
const JS_CLASS = `{const h=document.documentElement;h.classList.add('js');addEventListener('DOMContentLoaded',()=>{if(!h.classList.contains('live'))h.classList.remove('js')})}`;
/**
 * The crossfade between pages, opted into before the first render: from the bundled stylesheet,
 * which can arrive just before it, Chromium can read a stale opt-in and throw.
 */
const VIEW_TRANSITIONS =
  '@view-transition{navigation:auto}@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}';
/**
 * Back and Forward skip it: while it runs, a tap lands on the picture of the old page and is lost.
 * Without the Navigation API a traversal cannot be told, and the crossfade stays.
 */
const NO_FADE_BACK = `addEventListener('pagereveal',e=>{if(self.navigation?.activation?.navigationType==='traverse')e.viewTransition?.skipTransition()})`;

function head(sheet: Sheet, ctx: PageCtx, r: Rendered): string {
  const url = ctx.site + sheet.slug + (sheet.slug ? '/' : '');
  const og = `${ctx.site}og/${sheet.id}.png`;
  return `<meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(r.title)}</title>
    <script>${JS_CLASS}${NO_FADE_BACK}</script>
    <style>${VIEW_TRANSITIONS}</style>
    <meta name="description" content="${esc(r.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" content="#1d4580" />
    <link rel="icon" href="${ctx.base}favicon.svg" type="image/svg+xml" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Planetary" />
    <meta property="og:title" content="${esc(r.title)}" />
    <meta property="og:description" content="${esc(r.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${og}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(r.ogAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />`;
}

export function renderPage(sheet: Sheet, ctx: PageCtx): string {
  const r = sheet.id === 'home' ? homeSheet(sheet, ctx) : bodySheet(sheet.id, sheet, ctx);
  return `<!doctype html>
<html lang="en">
  <head>
    ${head(sheet, ctx, r)}
  </head>
  <body data-sheet="${sheet.id}">
    ${r.html}
    <script type="application/json" id="page-data">${JSON.stringify(r.data).replace(/</g, '\\u003c')}</script>
    <script type="module" src="${ctx.base}src/main.ts"></script>
  </body>
</html>
`;
}

/** GitHub Pages' 404 page, as a blank sheet that links back to the home page. */
export function render404(base: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sheet not found — Planetary</title>
    <meta name="robots" content="noindex" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        background: #1d4580;
        color: #f1f4f6;
        font: 15px/1.4 'Arial Narrow', system-ui, sans-serif;
      }
      main {
        box-sizing: border-box;
        margin: 12px;
        height: calc(100% - 24px);
        border: 2.5px solid #f1f4f6;
        display: grid;
        place-content: center;
        text-align: center;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        font-weight: 400;
        font-size: 28px;
        margin: 0 0 12px;
      }
      a {
        color: inherit;
      }
      a:hover {
        color: #ffd54a;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Sheet not found</h1>
      <p><a href="${base}">Planetary</a></p>
    </main>
  </body>
</html>
`;
}

export { SHEETS };
