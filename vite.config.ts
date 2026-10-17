/// <reference types="vitest/config" />
// Every sheet is a static page: before Vite starts, src/render/page.ts writes one HTML file per sheet
// into .pages/ (the Vite root), from NASA's data. Each page loads the same client bundle.
import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { render404, renderPage, SHEETS } from './src/render/page.ts';

const dir = import.meta.dirname;
// GitHub Pages serves the site from /<repo>/; override with BASE_PATH for other hosts.
const base = process.env.BASE_PATH ?? '/planetary/';
const site = process.env.SITE_URL ?? 'https://eduardmur.github.io/planetary/';
const repo = 'https://github.com/eduardmur/planetary';
const issued = process.env.ISSUED ?? new Date().toISOString().slice(0, 10);

const root = resolve(dir, '.pages');
/** Write a file only when its content changes, so loading the config does not reload open tabs. */
function put(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
  writeFileSync(file, content);
}
const input: Record<string, string> = {};
if (!process.env.VITEST) {
  // The client entry lives inside the Vite root and pulls in the sources from src/.
  put(resolve(root, 'entry.ts'), "import '../src/main.ts';\n");
  for (const sheet of SHEETS) {
    const file = resolve(root, sheet.slug, 'index.html');
    const html = renderPage(sheet, { base, site, issued, repo });
    put(file, html.replace(`${base}src/main.ts`, '/entry.ts'));
    input[sheet.id] = file;
  }
  put(resolve(dir, 'public/404.html'), render404(base));
}

/** Publish the parsed data next to the site: /data/factsheet.json, .csv and the ledger. */
function data(): Plugin {
  return {
    name: 'pb:data',
    apply: 'build',
    closeBundle() {
      const out = resolve(dir, 'dist/data');
      mkdirSync(out, { recursive: true });
      copyFileSync(resolve(dir, 'src/data/factsheet.json'), resolve(out, 'factsheet.json'));
      copyFileSync(resolve(dir, 'data/factsheet-main.csv'), resolve(out, 'factsheet-main.csv'));
      copyFileSync(resolve(dir, 'data/discrepancies.md'), resolve(out, 'discrepancies.md'));
      // Search engines: every sheet (submit sitemap.xml in Search Console).
      const urls = SHEETS.map(
        (s) => `  <url><loc>${site}${s.slug}${s.slug ? '/' : ''}</loc></url>`,
      );
      writeFileSync(
        resolve(dir, 'dist/sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
      );
    },
  };
}

export default defineConfig({
  root,
  plugins: [data()],
  base,
  publicDir: resolve(dir, 'public'),
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input },
  },
  server: { fs: { allow: [dir] } },
  test: {
    root: dir,
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
