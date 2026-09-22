/**
 * Copies the Decap CMS bundle out of node_modules into public/admin/decap/.
 *
 * Why self-host instead of using the CDN: /admin is the one page on this site
 * that holds write access to the repository. Loading its code from a third
 * party would put a supply-chain dependency exactly where it hurts most, and
 * would force us to allow-list an external script origin in the CSP. Serving
 * it from our own origin keeps script-src at 'self' everywhere.
 *
 * Decap is code-split, so the entry file alone is not enough — the numbered
 * chunks have to come along or the admin panel 404s while loading. Source maps
 * (24 MB) and the duplicate `cms.js` build are skipped.
 *
 * Runs on postinstall and prebuild. A missing source is a warning, not an
 * error, so a fresh clone still builds the public site.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(root, 'node_modules/decap-cms/dist');
const targetDir = resolve(root, 'public/admin/decap');

if (!existsSync(sourceDir)) {
  console.warn('[copy-decap] decap-cms not installed yet — skipping bundle copy.');
  process.exit(0);
}

/** Keep the decap-cms entry, its lazy chunks and the stylesheet. Nothing else. */
const wanted = (name) =>
  !name.endsWith('.map') &&
  !name.endsWith('LICENSE.txt') &&
  (name === 'decap-cms.js' || name.endsWith('.decap-cms.js') || name === 'cms.css');

// Rebuild from scratch so stale chunks from an older version cannot linger.
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

let copied = 0;
for (const name of readdirSync(sourceDir)) {
  if (!wanted(name)) continue;
  copyFileSync(join(sourceDir, name), join(targetDir, name));
  copied += 1;
}

console.log(`[copy-decap] copied ${copied} files into public/admin/decap/`);
