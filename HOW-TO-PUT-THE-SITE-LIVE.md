Three ways:
- **Route 1 (Vercel)** — Deploy directly via Vercel and GitHub.
- **Route 2 (Netlify Drag-and-Drop)** — Instant upload via zip file.
- **Route 3 (Netlify Git)** — GitHub + Netlify with CMS OAuth.

---

## Route 1 — Deploy on Vercel (Recommended)

The project is pre-configured with `vercel.json` and zero-config Astro static deployment.

### Step 1 — Push your folder to GitHub

Make sure all project folders (`src`, `public`, `scripts`, `api`, `astro.config.mjs`, `package.json`, `vercel.json`) are committed to your GitHub repository.

If you are using Git from the terminal:
```bash
git init
git add .
git commit -m "Configure Vercel deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```
*(If using GitHub Desktop: Add the folder, commit all files, and click Publish).*

### Step 2 — Deploy on Vercel

1. Go to **https://vercel.com/new**
2. Select your GitHub repository.
3. Vercel will auto-detect **Astro**:
   - **Framework Preset**: `Astro`
   - **Build Command**: `astro build` (or `npm run build`)
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
4. Click **Deploy**.

Vercel will install dependencies, automatically bundle Decap CMS, build the 40 pages, and give you a live production URL!

---

## Route 1 — get it on the internet now (2 minutes)

You need: the file `AHT-Site-Upload-v18-22Sep.zip`, which is sitting in this folder.

1. Go to **https://app.netlify.com/drop**
2. Drag `AHT-Site-Upload-v18-22Sep.zip` onto the big dashed box on that page.
3. Wait about thirty seconds.

That's it. Netlify gives you a live address straight away — something like
`https://cheerful-marzipan-8a21c9.netlify.app`. Open it on your phone. Everything
works: the start window, the seven division pages, the enquiry form.

**Make it permanent.** The address above disappears after a while unless you
claim it. On the page that appears after the upload there is a **"Sign up to
claim your site"** link — click it, make a free account with your email, and the
site stays. You can rename it to something like `aht-construction.netlify.app`
under *Site configuration → Change site name*.

### What works on Route 1
- The whole website, on a real address, on any phone or computer
- The enquiry form — messages arrive under *Forms* in your Netlify dashboard
- All the security headers (they are packed inside the zip)

### What does not work yet
- `/admin` — the panel where you edit projects and photographs. That needs
  Route 2, because editing the site means saving changes somewhere permanent.

---

## Route 2 — turn on the /admin editing panel

This is the one that lets you add projects, upload photographs and fill in the
blank fields yourself, without a developer. It needs two free accounts: GitHub
(where the site's files live) and Netlify (which builds and serves it).

### Step 1 — put the files on GitHub

1. Make a free account at **https://github.com**
2. Click **New repository**. Name it `aht-website`. Choose **Private**.
   Do **not** tick "Add a README".
3. On your computer, open the folder `AHT Website` and upload it to that
   repository. The easiest way is **GitHub Desktop**
   (https://desktop.github.com) — *File → Add local repository*, point it at
   this folder, then *Publish repository*.

Some files are deliberately left out of the upload (the `node_modules` folder,
the preview `.html` files). That is correct — a `.gitignore` file in the folder
handles it automatically. Do not remove it.

### Step 2 — connect Netlify to GitHub

1. At **https://app.netlify.com**, choose **Add new site → Import an existing
   project → GitHub**, and pick your `aht-website` repository.
2. Netlify reads its settings from the `netlify.toml` file already in the
   folder, so leave the build settings exactly as they appear.
3. Click **Deploy**.

Every time you change something from `/admin` after this, the site rebuilds
itself within a minute or two.

### Step 3 — let yourself log in to /admin

1. In Netlify: **Site configuration → Access control → OAuth → Install
   provider → GitHub**.
2. It asks for a Client ID and Secret. Get those from GitHub:
   **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Application name: `AHT Website Admin`
   - Homepage URL: your Netlify address
   - Authorization callback URL: `https://api.netlify.com/auth/done`
     (type this exactly)
3. Paste the Client ID and Secret back into Netlify.

### Step 4 — one line to edit

Open `public/admin/config.yml` and change this line:

```yaml
repo: REPO_OWNER/REPO_NAME # <-- CHANGE ME
```

to your own, for example:

```yaml
repo: ajaythakur/aht-website
```

Save it, upload the change, and `/admin` will work. Go to
`your-address.netlify.app/admin` and sign in with GitHub.

---

## Your own domain name

When you are ready to use something like `ahtconstruction.in`:

1. Buy the domain (GoDaddy, BigRock, Cloudflare — any registrar).
2. In Netlify: **Domain management → Add a domain**, and follow what it tells
   you to change at the registrar.
3. Nothing in the website code needs editing. It works out its own address
   automatically, so the sitemap and links follow the new domain by themselves.

Netlify adds the padlock (HTTPS) free, automatically.

---

## Things worth knowing

**The enquiry form.** Messages go to *Forms* in the Netlify dashboard. Set up an
email alert under **Forms → Settings → Form notifications**, or you will have to
remember to check the dashboard.

**Still blank on the site.** Location and year are empty on all 28 projects, and
the four registrations have no issuing authority or document numbers. They stay
invisible until filled in — nothing looks broken — but they are the quickest way
to make the site stronger. Each division also has a **description** field in
`/admin` that is currently empty and is the best place to say more about that
part of the business in your own words.

**Project sizes (sq.ft.).** Contract values are no longer shown anywhere on the
site — they stay in `/admin` as a private field, for your records only. The
**Size / built-up area** field is shown in their place. Eleven projects have a
value but no size yet, so they show nothing there: Bhilosa Naroli, Daman
School, Filatex Dahej, Frontage Park, Infiiloom Silvassa, JRF Vapi, Polycab Nani
Daman, R.K. Desai College, Sumilon Gandhidham, Toray Sarigam and Welspun Morai.
Fill them in `/admin` and they appear on the cards and project pages.

**Project photos and filters.** The projects archive filters by type of work,
stage and client (private or public sector). It will also filter by **location**
and **year** as soon as those fields are filled in on the projects in `/admin` —
none has them yet, so there is no such filter today. Two projects used to share
a photo with another project (Atul Residential & Commercial, and the Creative
Garment road); they now show a drawing of their building type until you upload
their own photograph. Any project without a photo shows such a drawing, labelled
as a drawing, not a photo.

**Photographs.** Every image on the site was recovered from the old company
profile PDF and is low resolution. Better photographs would lift the site more
than any further design work.
