# M1 · Static Mirror

**1:1 byte-for-byte cloning of statically-built sites by mirroring the deployed asset set.**

Applies when the deployed bundle **is** the source: Astro / Vite SSG / Hugo / Eleventy — any
site whose client runtime is emitted as downloadable static assets, even a WebGL / Canvas /
Gaussian-splat heavy front-end — **or** when you recovered true source and it builds to static
output. This is the fastest, most faithful path, and it satisfies the Iron Rule directly.

**Not this mode:** true server-rendered or data-driven SPAs whose business data lives behind an
API → use **M3 · API-Fixture Rebuild** (`network-capture.mjs` + mock server), not a mirror.
See [assessment](assessment.md) to grade complexity and confirm the mode.

## Contents

1. [Why a mirror is a true 1:1 clone](#why-a-mirror-is-a-true-11-clone)
2. [Why full-scroll browser capture, not grep/wget](#why-full-scroll-browser-capture-not-grepwget)
3. [Step 1 — Capture with mirror-site.mjs](#step-1--capture-with-mirror-sitemjs)
4. [Step 2 — Manual finishing (make it run offline)](#step-2--manual-finishing-make-it-run-offline)
5. [wget fallback (purely static-linked HTML)](#wget-fallback-purely-static-linked-html)
6. [Step 3 — Serve & verify](#step-3--serve--verify)
7. [Do not dilute M1 with M5](#do-not-dilute-m1-with-m5)
8. [Worked example](#worked-example)

## Why a mirror is a true 1:1 clone

For these sites the **real source is often not on GitHub**, but the **deployed static assets are
the ground truth**: HTML + bundled JS + CSS + the binaries the runtime fetches
(`.sog` / `.buf` / `.wasm` / `.riv` / fonts / images / video). Mirror those **verbatim** and
serve them from a web root and you are running the **real code + real assets** — not a rebuild.
That reproduces the original down to the byte, including its quirks and bugs.

This is the **Iron Rule ("real source first")** applied to static sites:
**for a static site, "get the real source" = "mirror the whole deployed asset set."** Because it
is truth rather than reconstruction, there is no `SOURCE`/`PARTIAL`/`GUESS` grading to do and no
compensation to make — you copy, you do not approximate.

> **Decision-tree pitfall:** seeing `astro: true` in recon does **not** mean "go buy the theme."
> That only holds for sites built on an off-the-shelf open theme. A **custom** Astro build (e.g.
> a Lusion-style site) has no purchasable theme — the correct answer is the full mirror below.

## Why full-scroll browser capture, not grep/wget

| Problem | Why grep / `wget --mirror` misses it |
|---|---|
| `.buf` / `.sog` / `.riv` / model binaries | Fetched by JS **at runtime, keyed to scroll progress**; URLs are often **assembled dynamically** in code, so they are not literal strings in the bundle. |
| Runtime-fetched fonts | Injected by JS or CSS `@import`, not always a static HTML `<link>`. |
| `wget --mirror` | Only follows **static HTML links** — it never sees dynamically-fetched assets. |

The only reliable method: **load in a real browser and scroll top to bottom**, record **every
network request that actually fires**, then mirror the same-origin subset from that observed
request list. `wget` is a fallback only for purely static-linked HTML (see below).

## Step 1 — Capture with mirror-site.mjs

Run `scripts/mirror-site.mjs` (real browser; full-scroll; downloads over the browser network
stack so cookies / proxy / TUN match the page):

```bash
node scripts/mirror-site.mjs \
  --url https://<site>/ \
  --out ./clones/<slug>/RECON/mirror
# optional: --scroll-step 700 --settle 2500 --max-ms 90000
```

Keep the `--out` path **relative to the current directory** — never a home directory.

**Artifacts it writes:**

| File | Contents | How to read it |
|---|---|---|
| `<out>/site/…` | Mirrored **same-origin** assets, original paths preserved (directory URLs saved as `index.html`) | This is your web root — serve from here. |
| `<out>/own-asset-urls.txt` | Sorted list of same-origin asset paths | Sanity-check coverage; grep for `.buf`/`.sog`/`.wasm`/`.riv`/fonts to confirm runtime binaries were caught. |
| `<out>/third-party.json` | `hosts` (third-party origins) + `webfont_css_to_selfhost` (Typekit / Google Fonts CSS URLs) | Your manual-finishing worklist. |
| `<out>/mirror-manifest.json` | Every request (same-origin + third-party) with `status` / `type` / `content-type` | Audit failures and non-200s. |

The script **only** copies assets that were actually requested — it never invents paths — and it
**does not** rewrite third-party references. Rewriting is manual, per `third-party.json`.

**Coverage check before finishing:** the console prints `N ok / M failed`. Investigate any
failures in `mirror-manifest.json`, and confirm the runtime binaries you expect (from recon) all
appear in `own-asset-urls.txt`.

## Step 2 — Manual finishing (make it run offline)

Work through `third-party.json`.

### 2a. Self-host locked webfonts (the #1 pitfall)

Adobe **Typekit** (and, similarly, Google Fonts) kits are **locked to authorized domains**. If
you serve the remote `@import` from a different origin, hotlink protection **404s the fonts and
they silently fail to render** — a well-known community gotcha. Self-host them:

```bash
# 1. Download the kit CSS directly. Typekit is often behind a proxy block → do NOT use a proxy.
curl -sL -A "Mozilla/5.0 …Chrome…" -e "https://<site>/" \
  "https://use.typekit.net/<kit>.css" -o site/typekit/kit.css
# 2. Pull each use.typekit.net/af/... font URL out of kit.css's @font-face src blocks.
#    Each face has 3 suffixes: /l=woff2  /d=woff  /a=otf
#    Trust the file MAGIC, not the name: wOF2 = woff2, wOFF = woff, 0x00010000 = otf.
#    Save them into site/typekit/fonts/.
```

Write a local `@font-face` block with **relative** URLs and preserved `format()` hints:

```css
@font-face{
  font-family:"<same name>";
  src:url("./fonts/x.woff2") format("woff2"),
      url("./fonts/x.woff")  format("woff"),
      url("./fonts/x.otf")   format("opentype");
  font-display:swap; font-weight:<original range>;
}
```

Then repoint the reference. Note that Typekit is frequently the **first line of the main CSS as
`@import"https://use.typekit.net/<kit>.css"`**, not an HTML `<link>`:

```bash
perl -0pi -e 's{\@import"https://use\.typekit\.net/<kit>\.css"}{\@import"/typekit/kit-local.css"}g' \
  site/_astro/<main>.css
```

### 2b. Strip trackers

Cut Cloudflare beacon / GA / gtag / GTM / pixels — remove the exact `<script>` (or injected)
tags, line by line. This is also the `audit-clone.mjs` requirement in
[verification](verification.md).

### 2c. Third-party CDNs (Rive wasm on unpkg, external players)

Cross-origin public CDNs load fine online. You may **leave them online** (they break offline —
note that in `NOTES.md`), or mirror them and rewrite the injection point for a fully offline
clone.

### 2d. Video embeds (Vimeo / YouTube)

`iframe` embeds play online, fail offline. Usually not core first-paint — record in `NOTES.md`
and move on.

## wget fallback (purely static-linked HTML)

For a simple site whose assets are **all reachable via static HTML links** (no runtime-fetched
binaries), a mirror is a one-liner:

```bash
wget --mirror --convert-links --adjust-extension --page-requisites \
     --no-parent -e robots=off https://<site>/ -P ./clones/<slug>/RECON/mirror/site
```

Then still do Step 2 (self-host fonts, strip trackers) and Step 3. **Do not** use `wget` for any
site with runtime-fetched `.wasm`/`.buf`/`.sog`/`.riv`/dynamically-assembled font URLs — it will
silently miss them; use `mirror-site.mjs`.

## Step 3 — Serve & verify

Serve **from `site/`** so root-relative paths (`/_astro`, `/models`, …) resolve:

```bash
cd ./clones/<slug>/RECON/mirror/site
python3 -m http.server 8124
```

Then run the mandatory objective verification (see [verification](verification.md)):

1. **Zero** console / JS / WebGL errors in the browser.
2. `scripts/visual-diff.mjs` — pixel + SSIM at 1440 / 768 / 390 against the original.
3. For WebGL / scroll-driven sites, **scroll to each section and screenshot** — a single
   full-page shot misses scroll-triggered GL frames.
4. Confirm `scrollHeight` matches the original.

## Do not dilute M1 with M5

**Never mix M1 and M5.** A byte-for-byte mirror is truth; a **Design-DNA Reskin** (M5) is a
deliberate approximation. Blending them only degrades a perfect clone into "roughly similar."
Pick one intent. When M1 applies, do not "improve," re-theme, or reskin — the value is exactness.
(Trademark/logo/text replacement per [licensing](licensing.md) still applies — that is content
substitution, not design dilution.)

## Worked example

A custom Lusion-style Astro site (graded **L6**):

- **135 same-origin assets**: HTML + bundle + CSS + 25× `.buf` geometry/camera animations +
  2× `.sog` Gaussian splats + a sort `.wasm` + a `.riv` + MSDF atlases + fonts + 80+ images.
- **Only rewrites:** Typekit `@import` → self-hosted locally, and delete the Cloudflare beacon.
- **Result:** `scrollHeight` exact, **0 console errors**, hero pixel diff **36 / 1.3M (5/5)**.
- **Left online:** Vimeo gallery video + unpkg Rive wasm (non-core; noted in `NOTES.md`).

The takeaway: even the heaviest interactive front-end mirrors 1:1 when it is statically built —
the whole runtime came down the wire, so capture all of it and serve it unchanged.
