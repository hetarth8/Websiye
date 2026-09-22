/**
 * Generate `public/_headers` from the [[headers]] blocks in netlify.toml.
 *
 * Why this exists
 * ---------------
 * netlify.toml is read from the root of the REPOSITORY. It is only honoured on
 * a git-connected build. If the site is ever published by dragging the `dist`
 * folder onto Netlify — which is far and away the easiest route, and the one a
 * non-technical owner will reach for first — netlify.toml is not in that folder
 * and every security header is silently dropped. The site would go live with no
 * CSP frame-ancestors, no HSTS, no nosniff, and nothing would warn anybody.
 *
 * Netlify's `_headers` file, by contrast, is read from the root of whatever is
 * PUBLISHED. Emitting it into `public/` means Astro copies it into `dist/`, so
 * the headers travel with the folder however the site is deployed.
 *
 * netlify.toml stays the single source of truth — this file is generated from
 * it at every build and is gitignored, so the two can never drift.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tomlPath = join(root, 'netlify.toml');

if (!existsSync(tomlPath)) {
  console.log('[emit-headers] netlify.toml not found — skipping _headers generation.');
  process.exit(0);
}

const toml = readFileSync(tomlPath, 'utf8');

/**
 * A deliberately small parser: it understands exactly the shape this project's
 * netlify.toml uses — `[[headers]]` / `for = "..."` / `[headers.values]` /
 * `Key = "value"` — and nothing else. A general TOML dependency would be a lot
 * of supply chain for one file we control.
 */
const blocks = [];
let current = null;
let inValues = false;

for (const raw of toml.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;

  if (line === '[[headers]]') {
    if (current) blocks.push(current);
    current = { for: null, values: [] };
    inValues = false;
    continue;
  }
  if (!current) continue;

  if (line === '[headers.values]') {
    inValues = true;
    continue;
  }
  // Any other section header ends the headers block we were reading.
  if (line.startsWith('[') && line !== '[headers.values]') {
    blocks.push(current);
    current = null;
    inValues = false;
    continue;
  }

  const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"(.*)"$/);
  if (!match) continue;
  const [, key, value] = match;

  if (key === 'for' && !inValues) current.for = value;
  else if (inValues) current.values.push([key, value]);
}
if (current) blocks.push(current);

const usable = blocks.filter((b) => b.for && b.values.length);

if (!usable.length) {
  // Loud, not silent: shipping without headers is exactly the failure this
  // script exists to prevent, so a parse that finds nothing must stop the build.
  console.error('[emit-headers] No [[headers]] blocks parsed from netlify.toml.');
  process.exit(1);
}

const out = [
  '# GENERATED — do not edit.',
  '# Source of truth is netlify.toml; regenerate with `node scripts/emit-headers.mjs`.',
  '# This file exists so the security headers survive a manual "drag the dist',
  '# folder onto Netlify" deploy, where netlify.toml is not read at all.',
  '',
  ...usable.flatMap((b) => [b.for, ...b.values.map(([k, v]) => `  ${k}: ${v}`), '']),
].join('\n');

writeFileSync(join(root, 'public', '_headers'), out, 'utf8');

console.log(
  `[emit-headers] public/_headers written — ${usable.length} rule(s), ` +
    `${usable.reduce((n, b) => n + b.values.length, 0)} header(s).`,
);
