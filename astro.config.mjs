// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_TRANSITIONS } from './src/scripts/inline/quiet-transitions.mjs';

// Canonical origin, used for canonical URLs, the sitemap, robots.txt and JSON-LD.
//
// Resolved at build time rather than hardcoded:
//   SITE_URL                         — explicit custom domain
//   VERCEL_PROJECT_PRODUCTION_URL    — Vercel production deployment domain
//   VERCEL_URL                       — Vercel branch/preview deployment domain
//   URL / DEPLOY_PRIME_URL           — Netlify production / branch URLs
const SITE =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  process.env.URL ||
  process.env.DEPLOY_PRIME_URL ||
  'https://ahtconstruction.in';

/**
 * Ensures the self-hosted Decap CMS bundle is copied from node_modules into
 * public/admin/decap/ during Astro's config setup phase. This eliminates any
 * dependency on npm postinstall or prebuild hooks that can fail in CI/CD environments.
 */
/**
 * Generates public/_headers from netlify.toml during config setup.
 *
 * The file is gitignored (it is generated), so a fresh clone — a Vercel build,
 * a Netlify build from git, anyone who clones the repo — had no _headers at
 * all, and a site published from that build carried none of the security
 * headers. Emitting it here means it can never be missing again, for the same
 * reason the CMS bundle is copied here: no npm pre/post hooks to forget.
 * On Vercel the headers also come from vercel.json; this costs nothing there.
 */
function headersIntegration() {
  return {
    name: 'emit-headers',
    hooks: {
      'astro:config:setup': async () => {
        try {
          await import('./scripts/emit-headers.mjs');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[headers] could not generate public/_headers:', message);
        }
      },
    },
  };
}

function decapCmsIntegration() {
  return {
    name: 'decap-cms-bundle',
    hooks: {
      'astro:config:setup': () => {
        try {
          const root = fileURLToPath(new URL('.', import.meta.url));
          const sourceDir = resolve(root, 'node_modules/decap-cms/dist');
          const targetDir = resolve(root, 'public/admin/decap');

          if (!existsSync(sourceDir)) {
            console.warn('[decap-cms] node_modules/decap-cms/dist not found — skipping bundle copy.');
            return;
          }

          /** @param {string} name */
          const wanted = (name) =>
            !name.endsWith('.map') &&
            !name.endsWith('LICENSE.txt') &&
            (name === 'decap-cms.js' || name.endsWith('.decap-cms.js') || name === 'cms.css');

          rmSync(targetDir, { recursive: true, force: true });
          mkdirSync(targetDir, { recursive: true });

          let copied = 0;
          for (const name of readdirSync(sourceDir)) {
            if (!wanted(name)) continue;
            copyFileSync(join(sourceDir, name), join(targetDir, name));
            copied += 1;
          }
          console.log(`[decap-cms] copied ${copied} files into public/admin/decap/`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[decap-cms] Warning during copy:', message);
        }
      },
    },
  };
}

export default defineConfig({
  site: SITE,
  output: 'static',
  trailingSlash: 'ignore',

  security: {
    // Astro emits a per-page <meta http-equiv="content-security-policy"> and
    // hashes every script and style it bundles, so we never need
    // 'unsafe-inline'. Header-only directives (frame-ancestors, HSTS) live in
    // netlify.toml — the two policies are enforced independently.
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        // No third-party frames: the map is a link, not an embed.
        "frame-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ],
      // The head's one inline script (see src/scripts/inline): Astro does not
      // hash is:inline scripts itself, so its hash is computed from the text.
      scriptDirective: {
        hashes: [`sha256-${createHash('sha256').update(QUIET_TRANSITIONS).digest('base64')}`],
      },
    },
  },

  markdown: {
    // Shiki emits inline styles, which cannot be hashed for CSP. No content
    // here is code, so highlighting is simply switched off.
    syntaxHighlight: false,
  },

  image: {
    // Responsive srcset + intrinsic sizing on every <Image>, which keeps CLS
    // near zero without hand-writing dimensions per call site.
    responsiveStyles: true,
    layout: 'constrained',

    // The source photographs were recovered from a PDF and are already soft, so
    // they cannot afford a second generation of lossy compression on top.
    // Quality runs well above Astro's default and effort is maxed — the cost is
    // build time, which is free here, and the gain is visibly less mush.
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        webp: { quality: 88, effort: 6, smartSubsample: true },
        avif: { quality: 72, effort: 6 },
        jpeg: { quality: 88, mozjpeg: true, progressive: true },
        png: { compressionLevel: 9, effort: 8 },
      },
    },
  },

  fonts: [
    // Two families, both VARIABLE, down from four. The npm provider reads the
    // installed @fontsource packages from node_modules, so builds need no
    // network and no third-party origin ever appears in the CSP.
    //
    // Both MUST be the `-variable` packages, for a reason this project has
    // already been burned by: the provider reads exactly ONE css file per
    // family (`options.file`, default index.css) and filters the declared
    // `weights` against whatever @font-face rules that single file contains.
    // A static @fontsource package's index.css declares weight 400 and nothing
    // else, so a `weights: [500, 700]` silently resolved to 400-only and the
    // whole site shipped in browser-synthesised FAUX BOLD. A variable package's
    // index.css declares a real weight RANGE across every subset, so one file
    // covers everything the design asks for.
    //
    // Note also: no `file:` pin here. index.css declares all subsets, including
    // the latin-ext range U+20AD-20C0 that carries ₹ (U+20B9). The old config
    // pinned Barlow and IBM Plex Mono to `latin.css`, which ships the latin
    // subset only — that, not a missing glyph, is why the rupee sign used to
    // fall back to a system face and needed the `.rupee` workaround.
    {
      // Display: headings and the wordmark. Geometric, slightly warmer than
      // Inter, which keeps some character in the big type.
      provider: fontProviders.npm(),
      name: 'Plus Jakarta Sans Variable',
      options: { package: '@fontsource-variable/plus-jakarta-sans' },
      // Deliberately not '--font-display': Tailwind's @theme owns that name and
      // aliases it to this one, so the two systems don't collide.
      cssVariable: '--fontfamily-display',
      weights: ['200 800'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
    },
    {
      // Body, UI and labels. Inter is the Swiss neutral the brief asked for and
      // what Stripe and Linear both run on. --font-mono is aliased onto this in
      // @theme, so the site's tracked micro-labels render as uppercase Inter
      // rather than a monospace — which is the same convention those sites use.
      provider: fontProviders.npm(),
      name: 'Inter Variable',
      options: { package: '@fontsource-variable/inter' },
      cssVariable: '--fontfamily-body',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
    },
  ],

  integrations: [headersIntegration(), 
    decapCmsIntegration(),
    sitemap({
      // /thank-you is a form destination, /admin is the CMS and
      // /motion-preview is a temporary internal comparison page — none of
      // them belong in search results.
      filter: (page) =>
        !page.includes('/thank-you') &&
        !page.includes('/admin') &&
        !page.includes('/motion-preview'),
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
