# AHT Construction — website

Marketing site for **Ajay H. Thakur Construction**, Vapi — specialist in asphalt road work and civil work.

Built with [Astro](https://astro.build) (static output), Tailwind CSS v4, and [Decap CMS](https://decapcms.org) for self-service editing at `/admin`.

---

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:4321.

| Command | What it does |
| --- | --- |
| `npm run dev` | Local development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` exactly as it will deploy |
| `npm run check` | Type-check `.astro` and `.ts` files |

---

## Things that still need your input

These are deliberately left blank or as placeholders — nothing invented has been published.

### 1. The logo (highest priority)

`public/logo/aht-mark.svg` is a **placeholder** drawn in your brand amber. Replace it with the real export from `AHT.cdr`:

- **`public/logo/aht-mark.svg`** — the triangular "A" mark only, square, transparent background. Used in the header, footer, favicon and CMS.
- Keep the filename and the square `viewBox` and everything picks it up automatically.

If you can also export the full horizontal lockup (mark + the "Ajay H. Thakur" script wordmark) as SVG, send it over and it can replace the typeset wordmark in `src/components/Logo.astro`.

### 2. Project details

All 13 projects are seeded from the photographs in your company profile, but **client, location, year and scope are blank** because those were not recoverable from the PDF. Blank fields are simply hidden on the site — no "TBC" text appears anywhere. Fill them in from `/admin` and the detail rows appear automatically.

### 3. Registrations & compliance

The four cards under *Credentials* are prompts, not claims. Edit them in `/admin` → **Registrations & Compliance** and add your actual contractor class, GSTIN, approving authorities and safety certification.

### 4. Higher-resolution photographs — the one thing code cannot fix

Every image was recovered from the embedded JPEGs inside `AHT_Construction_Company_Profile.pdf`, and that is the hard ceiling on sharpness. **No setting can add detail that was never there** — upscaling a small photo only makes it blurry and heavier to load.

What has been done instead is to stop losing any *further* quality: encoder settings in `astro.config.mjs` run well above Astro's defaults, so the site no longer adds a second layer of compression on top of already-soft sources.

The widest sources available, which is what a full-width hero actually needs:

| Photograph | Source width | At full width |
| --- | --- | --- |
| Asphalt batch mix plant | 1400px | Acceptable |
| Colleges campus / warehouse | ~1115px | Soft on a large screen |
| Civil foundation works | 1007px | Soft on a large screen |
| Quarry, aggregate yard | 800px | Noticeably soft |
| Crusher plant | 740px | Noticeably soft |
| Client logos | ~456px | Fine at the size used |

Sending the original photographs — straight off the phone or camera, before they went into the PDF — is the single biggest visual upgrade available to this site.

### 5. Sign off the crane transition

The crane lift runs on every internal link — click around the site to see it. The chooser page used to compare the three options has been removed now that the crane is settled.

The site reel that used to sit under *How We Work* has been removed, along with `public/video/`. Your original `video_preview_h264.mp4` is untouched in the project root if you ever want it back.

---

## Deploying to Netlify

1. Push this folder to a **private GitHub repository**.
2. In Netlify: **Add new site → Import an existing project → GitHub**, and pick the repo.
3. Netlify reads `netlify.toml`, so the build command (`npm run build`) and publish directory (`dist`) are already correct. Click **Deploy**.
4. Once deployed, set your real domain under **Domain management**, then update the domain in two files and redeploy:
   - `astro.config.mjs` → the `SITE` constant
   - `public/robots.txt` → the `Sitemap:` line

### Enabling the `/admin` panel

The CMS signs in through GitHub, so the site itself stores no passwords.

1. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: your site URL
   - Authorization callback URL: `https://api.netlify.com/auth/done`
2. On Netlify: **Site configuration → Access control → OAuth → Install provider → GitHub**, and paste the Client ID and Client Secret from step 1.
3. Edit `public/admin/config.yml` and replace `REPO_OWNER/REPO_NAME` with your actual repository.
4. Visit `https://yoursite.com/admin` and click **Login with GitHub**.

### Enquiry form

The contact form uses **Netlify Forms** — no API key or third-party service. After the first deploy, go to **Forms → enquiry → Settings → Form notifications** and add an email notification to `ajaythakurconstruction@yahoo.in`. The free tier covers 100 submissions per month.

---

## Adding a project

From `/admin` → **Projects** → **New Project**:

| Field | Notes |
| --- | --- |
| **Stage** | `Upcoming`, `In progress` or `Completed` — this single field is what moves a project between the filters on the site |
| Type of work | Road / Civil / Industrial / Institutional |
| Main photo | Required |
| Client, Location, Year, Scope | Optional — anything blank is hidden on the site |
| Show on home page | Puts it in the three featured cards |

Hit **Publish** and Netlify rebuilds automatically, usually within a minute.

The filter buttons on `/projects` are generated from the content itself — a stage with no projects in it does not show a filter at all, and the counts update on their own.

---

## Changing the hero slideshow

The five rotating background photographs are listed at the top of `src/components/Hero.astro`. Add, remove or reorder entries in the `slides` array — the dots underneath rebuild themselves to match.

Two things worth knowing:

- The **first** slide is the one search engines and speed tests measure, so keep the sharpest photograph first.
- It rotates every 6 seconds, pauses when someone picks a slide or presses the pause button, and never autoplays for a visitor who has "reduce motion" switched on.

## The crane transition

Clicking any internal link lowers a white sheet in on a crane, then hoists it away to reveal the next page.

| Part | Where it is defined |
| --- | --- |
| Lattice jib, rope, hook block, all timings | `src/components/PageTransition.astro` |
| When it fires, and when it must not | `src/scripts/transitions.ts` |
| Which variant is active | `src/data/site.json` → `"transition"` |

Timings are **520ms to lower, 1250ms to hoist**. Only the 520ms is time anyone waits — the hoist plays over the next page, which has already rendered underneath, so a slow lift costs nothing.

If you change a duration, change it in **both** `PageTransition.astro` (the CSS) and the `TIMING` table in `transitions.ts` (the JavaScript). They have to agree or the page will change under a stationary panel.

It deliberately stays out of the way: new-tab and modifier-clicks, `tel:` and `mailto:` links, same-page anchors, downloads and the `/admin` panel all navigate normally. Anyone with "reduce motion" enabled never sees it. If a page ever fails to load, the overlay clears itself after 4 seconds rather than stranding someone behind a white panel.

## How the content is organised

```
src/content/
  projects/        one file per project — client, value, stage, photos
  services/        the seven divisions
  facilities/      quarries, RMC plants, asphalt drum mix plants
  equipment/       the owned equipment register (name + quantity)
  government/      public-sector road contracts and their values
  team/            leadership and department heads
  clients/         one file per client (logo optional)
  certifications/  registrations & compliance cards
  faqs/            accordion questions
src/data/site.json company facts, offices, GST, stats, nav
```

All of it is transcribed from `AHT_Construction_Company_Profile.pdf`. Where the profile gives a figure it is carried through verbatim; where it does not, the field is left blank and simply does not render.

Schemas live in `src/content.config.ts`. A build fails loudly if a required field is missing, which stops a broken entry reaching the live site.

Images uploaded through the CMS land in `src/assets/uploads/` and are optimised at build time into responsive WebP.

---

## A trap worth knowing about

The site ships a hash-based Content Security Policy. Astro hashes every `<style>` block it emits, but **a `style="..."` attribute cannot be hashed** — the browser silently drops it. Nothing errors; the style just never applies.

So: put decorative fills, gradients and widths in `src/styles/global.css` as classes. Never inline them. If something looks unstyled and the markup looks right, check for an inline `style` attribute first.

Two related notes:
- Styles set from JavaScript (`el.style.setProperty(...)`) are fine — CSP only blocks attributes parsed from HTML.
- Gradient tokens live on `:root`, not inside `@theme`. Tailwind prunes theme variables it can't see used by a utility class, and it does not scan component CSS or inline `var()` references.

## Security

The site is fully static — no database, no server-side code, nothing to inject into.

- **Content Security Policy** — Astro emits a per-page CSP with a SHA-256 hash for every script and style it bundles, so `unsafe-inline` is never needed. Header-only directives (`frame-ancestors`) are set in `netlify.toml`.
- **No third-party origins.** Fonts are self-hosted (built from the `@fontsource` packages at build time, so builds need no network), the map is a link rather than an embed, and the Decap CMS bundle is served from our own origin instead of a CDN — see `scripts/copy-decap.mjs` for why.
- **Headers** — HSTS with preload, `nosniff`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, and `Cross-Origin-Opener-Policy`.
- **`/admin`** — `noindex`, `no-store`, and authentication delegated entirely to GitHub.
- **Form** — honeypot field plus Netlify's built-in spam filtering.

## Accessibility

Verified on the production build: 212 text nodes checked with **zero contrast failures**, zero overlapping text at any breakpoint, all interactive targets at least 44px, no horizontal scroll at 375 / 768 / 1024 / 1440px, and visible amber focus rings throughout.

Under `prefers-reduced-motion` the hero stops autoplaying, scroll reveals are skipped, and page transitions are disabled entirely so links navigate normally.

One deliberate colour rule runs through the light theme: **amber is never used for text on a light background** — it only reaches 2.2:1 there. Anywhere a warm accent had to carry meaning (the required-field asterisks, the numbered points under *Why AHT*, the 404 code) it is maroon `#9D231F` at 7.4:1. Amber stays on fills, rules and dark grounds, where it is 8.5:1.

The FAQ uses native `<details>` elements, so it works with a keyboard and screen reader without any JavaScript.

---

## A note on OneDrive

This project currently sits inside a OneDrive folder. `node_modules` is excluded from Git, but OneDrive will still try to sync its thousands of files, which slows installs and can occasionally lock files mid-build. Moving the project to a path outside OneDrive (for example `C:\Projects\aht-website`) avoids this. Git remains your backup.
