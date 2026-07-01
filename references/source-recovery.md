# Source Recovery

Getting **ground truth** so you never guess implementation code. This is Step 2 of the decision
tree and the operational half of the **Iron Rule: real source first** — an AI "clone analysis" is
a conceptual skeleton at best; its code blocks are `GUESS` until verified against real source (the
marbles case). Recover the actual bytes here, and every downstream claim can be graded `SOURCE`.

When source is found **and** its license permits reuse, you have the fastest, most faithful path —
usually **M1 Static Mirror** for whole sites, or line-by-line truth for **M4 Effect
Reverse-Engineer**. But **"public on GitHub ≠ reusable"**: recovery and licensing are separate
gates. Recover first to *understand*; clear the license before you *ship*. See [licensing](licensing.md).

## Contents

1. [Order of attack](#order-of-attack)
2. [GitHub repo search](#github-repo-search)
3. [Deploy-slug tricks (vercel / netlify / github.io)](#deploy-slug-tricks)
4. [Single-file raw fetch](#single-file-raw-fetch)
5. [Sourcemap hunting](#sourcemap-hunting)
6. [Grading what you recovered](#grading-what-you-recovered)
7. [The licensing caveat](#the-licensing-caveat)

## Order of attack

Try the cheapest, highest-fidelity sources first. Stop as soon as you have `SOURCE`-grade truth for
the parts you must build.

| # | Technique | Yields | Best for |
|---|-----------|--------|----------|
| 1 | GitHub repo search | full repo | named products, OSS-flavored sites |
| 2 | Deploy-slug → repo/user | full repo | `*.vercel.app` / `*.netlify.app` / `*.github.io` |
| 3 | Raw `index.html` fetch | one file | single-file demos, hand-written static sites |
| 4 | Sourcemap hunt | un-minified bundle | React/Vue/Next apps that ship `.map` files |
| 5 | Runtime capture (fallback) | draw calls / assets | no source anywhere → see M4 / [effect-extraction](effect-extraction.md) |

Recording where each artifact came from (URL, commit, license) in `NOTES.md` as you go — you will
need the provenance at the licensing gate.

## GitHub repo search

Search GitHub by product/site/author name **before** you spend time scraping. Finding the repo can
save ~30 minutes of reverse-engineering.

```bash
unset SSL_CERT_FILE   # macOS quirk: a stale SSL_CERT_FILE in the shell breaks gh's TLS — clear it first
gh api "search/repositories?q=<keyword>" \
  | jq -r '.items[] | "\(.full_name)  ⭐\(.stargazers_count)  \(.description)"' | head -10
```

- The **`unset SSL_CERT_FILE`** line matters on macOS: many shells export a `SSL_CERT_FILE` that
  points at a path `gh`/Node can't validate against, and every `gh api` call then fails with a TLS
  error. If unsetting isn't enough, pin the system bundle inline:
  `SSL_CERT_FILE=/etc/ssl/cert.pem gh api ...`.
- Pipe through `jq` to rank by stars and read descriptions fast; `--paginate` for more than one page.
- Widen with `q=<keyword>+in:name,description,readme`, or search code:
  `gh api "search/code?q=<distinctive-string>"` using a verbatim string you pulled from the site's
  DOM/CSS (a rare class name, a copyright line, a data attribute).

## Deploy-slug tricks

The hosting subdomain frequently leaks the repository or author. Read the deployed URL as a hint:

| Host | URL shape | What the slug usually is |
|------|-----------|--------------------------|
| Vercel | `my-cool-site.vercel.app` | project name ≈ repo name; try owner variants |
| Netlify | `my-cool-site.netlify.app` | site/repo name |
| GitHub Pages | `<user>.github.io/<repo>` | **user and repo are literally in the URL** |

Steps:

1. Take the slug and try `gh api "search/repositories?q=<slug>"` and direct
   `gh api repos/<guessed-user>/<slug>`.
2. For `github.io`, the owner is the subdomain and the repo is the first path segment — go straight
   to that repo; a bare `<user>.github.io` maps to the `<user>/<user>.github.io` repo.
3. Vercel/Netlify: check the page's own footer, `humans.txt`, `/_next/` chunk comments, or the
   GitHub link in the site nav — these often name the exact repo.

## Single-file raw fetch

Many demos, hand-coded static pages, and WebGL/Canvas showcases are **entirely self-contained in one
HTML file**. Do not reach for a browser mirror — just pull the raw bytes.

```bash
# From a repo you located:
curl -sL https://raw.githubusercontent.com/<user>/<repo>/main/index.html -o index-original.html
# Or straight from the live site:
curl -sL https://<host>/ -o index-original.html
```

- Always keep an untouched **`index-original.html`** as a read-only baseline before you edit.
- Inline `<script>`, `<style>`, and `<script type="x-shader/*">` blocks in that one file are
  `SOURCE`-grade — grep them directly (e.g. `texture2D` vs a ray-march loop vs an analytic
  discriminant) instead of trusting any second-hand analysis. See
  [reverse-engineering](reverse-engineering.md).
- If assets are runtime-fetched (`.wasm` / `.buf` / `.sog` / `.riv` / fonts), a single fetch won't
  catch them — that's a **M1 mirror** job via `scripts/mirror-site.mjs`, see [static-mirror](static-mirror.md).

## Sourcemap hunting

Bundled React/Vue/Next apps often ship source maps in production (or leave them one URL away). A
recovered `.map` un-minifies a bundle back into **original module files** — `SOURCE`-grade, the same
code the authors wrote.

Run **`scripts/sourcemap-hunt.mjs`** against the recon output:

```bash
node scripts/sourcemap-hunt.mjs --recon RECON/original-recon.json --out RECON/sourcemaps
# add --all-external to also chase third-party/CDN bundles (default: same-origin only)
```

What it does (mirror the logic if you do it by hand):

1. Collects every `https?://` script URL from `recon.json` (same-origin unless `--all-external`).
2. Fetches each bundle and greps for `//# sourceMappingURL=<hint>`.
3. Resolves the map URL — the hint relative to the script, **or, when there is no hint, appends
   `.map` to the script URL and tries that anyway** (a common win when the comment was stripped but
   the file was still deployed). `data:`/inline maps are noted and skipped.
4. Downloads each map into `--out` and writes **`sourcemap-manifest.json`**.

Read the manifest — the key fields per script:

| Field | Meaning |
|-------|---------|
| `status` | `ok` (map saved), `inline-or-data-map`, `error` (with `.error`), `unknown` |
| `mapUrl` / `mapFile` | resolved URL and local path of the recovered `.map` |
| `scriptCount` / `mapCount` | how many bundles scanned vs how many maps landed |

Then **un-webpack** the recovered maps into a browsable tree: a `.map`'s `sources` +
`sourcesContent` arrays hold the original file paths and their full text. Reconstruct that directory
(e.g. `npx source-map-explorer`, or a small script that writes each `sourcesContent[i]` to
`sources[i]`) so you get real component/module files to read and grade `SOURCE`, not a minified blob.

## Grading what you recovered

Recovery feeds the evidence grading the whole skill runs on:

- **`SOURCE`** — real repo files, raw single-file HTML, un-minified sourcemap output, runtime dumps
  / frame captures. Only `SOURCE` may be copied.
- **`PARTIAL`** — a name, a slice, an inferred shape still awaiting proof. Upgrade before relying on it.
- **`GUESS`** — visual fit / magic numbers / any AI-written code block. **Untagged means `GUESS`, and
  you may not copy a `GUESS`.**

If nothing above yields source, do **not** invent it. Fall through to runtime capture (M4:
`scripts/gl-capture.mjs`, `scripts/network-capture.mjs`, `scripts/mirror-site.mjs`) — captured
runtime truth also counts as `SOURCE`. Honor the **no-compensation rule** (never tweak
brightness/speed/coords to mask a bug) and the **baseline-first gate** (a minimal raw replay from
the real draw calls/shaders must pass before you projectize). See [effect-extraction](effect-extraction.md).

## The licensing caveat

**Finding the source does not grant the right to use it.** Recovery answers *how it's built*;
licensing answers *what you may ship*. Keep the two gates separate.

```bash
gh api repos/<user>/<repo> | jq '.license'   # then also open the LICENSE file + README
```

| License | What you may do |
|---------|-----------------|
| MIT / Apache / BSD / Unlicense | reuse and deploy; keep attribution |
| **NONE (no LICENSE / undeclared)** | **All Rights Reserved by default** — local learning/clone only, attribute the author, do **not** redeploy publicly without permission |
| Proprietary / explicitly forbidden | read-only study; do not copy or deploy |

- **"Public on GitHub ≠ MIT."** Absence of a license means *more* restriction, not less. Don't treat
  a `gh api` that fails to return a license as permission.
- A recovered sourcemap or a scraped bundle carries the **original site's** rights — same rule
  applies. Recovering it for local study is fine; redeploying someone's All-Rights-Reserved code is not.
- Whatever the license, still strip the original's logos, trademarks, tracker scripts, and
  copyrighted text/media and replace them with the user's own — the goal is a transformative clone,
  not a redeploy. Record source, license, and provenance in `NOTES.md`. Full matrix: [licensing](licensing.md).
