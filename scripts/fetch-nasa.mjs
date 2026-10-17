#!/usr/bin/env node
// Downloads the NASA NSSDCA Planetary Fact Sheet pages this project draws from into data/raw/,
// and records where and when each page came from in data/raw/manifest.json.
//
//   npm run data:fetch      # refresh the snapshot, then `npm run data:parse`
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/';

export const PAGES = [
  'index.html',
  'planet_table_ratio.html',
  'planetfact_notes.html',
  'planetfact_ratio_notes.html',
  'fact_notes.html',
  'mercuryfact.html',
  'venusfact.html',
  'earthfact.html',
  'moonfact.html',
  'marsfact.html',
  'jupiterfact.html',
  'saturnfact.html',
  'uranusfact.html',
  'neptunefact.html',
  'plutofact.html',
  'jupringfact.html',
  'satringfact.html',
  'uranringfact.html',
  'nepringfact.html',
];

const out = resolve(import.meta.dirname, '../data/raw');
await mkdir(out, { recursive: true });

const files = [];
for (const page of PAGES) {
  const url = BASE + page;
  const res = await fetch(url, { headers: { 'user-agent': 'planetary data fetch' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  await writeFile(resolve(out, page), body);
  const sha256 = createHash('sha256').update(body).digest('hex');
  files.push({ file: page, url, bytes: body.length, sha256 });
  console.log(`${page.padEnd(24)} ${String(body.length).padStart(6)} B`);
}

const manifest = { source: BASE, fetchedAt: new Date().toISOString(), files };
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${files.length} pages → data/raw/ (manifest.json)`);
