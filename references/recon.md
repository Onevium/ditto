# Recon

Recon is Step 1 of the decision tree. Before you write any code, record how the target
**looks**, **behaves**, and is **built** into auditable artifacts. Recon has one job above all
others: **identify the interaction model — scroll-driven vs click vs hover vs time-driven —
before building.** Mislabeling it is the single most expensive mistake in a clone, because it
poisons every downstream mode decision and spec.

Recon does not pick a mode or write code. It produces evidence. [assessment](assessment.md)
grades that evidence and picks one of M1–M5. Obey the **Iron Rule: real source first** — recon
tells you *what* to recover, not *how it is implemented*; that guess-free implementation truth
comes later from [source-recovery](source-recovery.md).

## Contents

1. [The three recon artifacts](#the-three-recon-artifacts)
2. [Three-viewport capture (1440 / 768 / 390)](#three-viewport-capture-1440--768--390)
3. [How to read recon.json](#how-to-read-reconjson)
4. [Framework & library fingerprints](#framework--library-fingerprints)
5. [The mandatory interaction sweep](#the-mandatory-interaction-sweep)
6. [Identify the interaction model BEFORE building](#identify-the-interaction-model-before-building)
7. [Route map (multi-page targets)](#route-map-multi-page-targets)
8. [Recon checklist](#recon-checklist)

## The three recon artifacts

Run all three (route-crawl only for multi-page targets). Each writes JSON + a Markdown summary
into the clone's `RECON/` folder. Paths are **relative to the current clone directory** — never a
home directory.

| Script | Purpose | Primary artifacts |
|--------|---------|-------------------|
| `scripts/recon.mjs` | Static snapshot per viewport: screenshots, fingerprints, DOM/CSS signals, console errors | `<label>-recon.json`, `<label>-summary.md`, `screenshots/<label>-<width>.png` |
| `scripts/interaction-probe.mjs` | Dynamic sweep: scroll / hover / safe-click / canvas-drag with multi-signal change detection | `<label>-interactions.json`, `<label>-interactions.md`, `screenshots/NN-<action>.png` |
| `scripts/route-crawl.mjs` | Same-site link crawl → route map, one screenshot per route | `<label>-route-map.json`, `<label>-route-map.md`, `screenshots/<route>.png` |

`--label original` on the target; re-run later with `--label clone` against `127.0.0.1` so
[verification](verification.md) can diff the two symmetrically.

## Three-viewport capture (1440 / 768 / 390)

`recon.mjs` opens a **fresh page per width** — desktop **1440**, tablet **768**, mobile **390** —
and takes a `fullPage` screenshot at each. This is deliberate: **multi-viewport capture is the #1
fidelity gap in real clones.** A page recon'd only at 1440 ships with a broken tablet grid and a
mobile nav that never collapses, and the miss is invisible until someone resizes.

- Capture all three every time. Widths are overridable (`--widths 1440,768,390`) but the default
  is the contract.
- The full-page screenshots are ground truth for [verification](verification.md)'s pixel + SSIM
  diff at the same three widths — capture at the widths you will score at.
- Each capture records its own `signals` block, so responsive divergence (nav collapse, column
  count, font-size shifts) shows up as differences across the three `captures[]` entries.
- Recon runs `waitUntil: domcontentloaded`, then best-effort `networkidle`, then a settle wait
  (`--wait`, default 1200ms) so lazy content and entrance animations land before the shot.

## How to read recon.json

Top level: `label`, `url`, `capturedAt`, a `console` block (`errors`, `warnings`, `pageErrors`),
and `captures[]` — one entry per viewport. Each capture has `viewport`, the `screenshot` path,
and a rich `signals` object. Read `signals` in this order:

| Field | What it tells you | Why it matters |
|-------|-------------------|----------------|
| `frameworks` | Boolean fingerprints (see next section) | Steers the mode decision |
| `counts` | canvas / video / images / links / forms / buttons / scripts / stylesheets / interactive | High `canvas` → M4 territory; high `forms`/`interactive` → M3 |
| `scrollHeight` | Full document height vs viewport | Reveals a long scroll-driven page vs a single fold |
| `sections[]` | Landmark tags with `rect`, `className`, truncated text, and computed `style` | Skeleton of the page layout and section order |
| `cssVariables` | Up to 200 `--custom-props` read live from stylesheets | Design tokens (colors, spacing) for the foundation pass |
| `fonts` | Loaded font families (`document.fonts`) | Which webfonts to self-host |
| `canvases[]` | Backing `width`/`height` **and** CSS display size | DevicePixelRatio math for WebGL/Canvas rebuilds |
| `images[]` | `currentSrc`, `alt`, natural dimensions | Real asset URLs to harvest |
| `scripts` / `stylesheets` | Source URLs | Sourcemap-hunt and bundle recovery targets |
| `headings` / `h1` / `metaDescription` | Content outline | Verbatim copy for rebuild specs |

Read `console.errors` and `pageErrors` early: a wall of errors on the *original* recalibrates
what "zero console errors" means for the clone, and often flags a runtime dependency you must
reproduce or mock.

Quick reads:

```bash
# framework signals for the desktop capture
jq '.captures[0].signals.frameworks | to_entries | map(select(.value)) | map(.key)' RECON/original-recon.json
# canvas backing store vs CSS size (dpr sanity)
jq '.captures[0].signals.canvases' RECON/original-recon.json
# design tokens
jq '.captures[0].signals.cssVariables' RECON/original-recon.json
```

## Framework & library fingerprints

`recon.mjs` sets `signals.frameworks` from `window` globals, marker DOM nodes, and script-URL
patterns. Treat a `true` as **PARTIAL** evidence — a lead, not proof. Confirm the real stack in
[source-recovery](source-recovery.md).

| Flag | Detected via |
|------|--------------|
| `react` | `__REACT_DEVTOOLS_GLOBAL_HOOK__`, or `#__next` / `[data-reactroot]` / `[data-reactid]` |
| `next` | `#__next`, or a `/_next/` script src |
| `vue` | `window.__VUE__`, or `[data-v-app]` |
| `nuxt` | `window.__NUXT__`, or a `/_nuxt/` script src |
| `svelte` | `[data-svelte-h]` |
| `astro` | `[data-astro-cid]`, or an `astro` script src |
| `three` | `window.THREE`, or a `three(.module)(.min).js` src |
| `gsap` | `window.gsap`, or a `gsap` script src |
| `lenis` | `window.Lenis`, or a `lenis` script src |

Reading the combination:

- **`astro` / `svelte` alone, low `interactive` count** → likely static-built → M1 Static Mirror.
- **`next` or `react` + content-heavy `sections`** → M2 Framework Rebuild.
- **High `forms`/`interactive` + XHR/fetch in the interaction sweep** → M3 API-Fixture Rebuild.
- **`three` and/or `canvas` count ≥ 1** → M4 Effect Reverse-Engineer; record `canvases[]` dims.
- **`lenis` / `gsap`** → smooth-scroll and scroll-timeline animation; a strong signal the
  interaction model is **scroll-driven** (see below).

Per the [INSPECTION_GUIDE], also note the CSS approach (Tailwind utility soup vs CSS Modules vs
styled-components), image strategy (`srcset`, WebP/AVIF, CDN), and API shape (`/graphql` vs REST)
while reading `scripts`, `stylesheets`, and the sweep's `network`.

## The mandatory interaction sweep

A static screenshot cannot tell you whether a section is a passive image or a live effect.
`interaction-probe.mjs` is **not optional** — it exercises the page and records, with evidence,
which actions actually change it.

**Design that makes the evidence trustworthy:**

1. **Fresh page per action.** Every scroll, hover, click, and drag runs on a newly loaded page
   (`freshPage`). No action contaminates the next — a click that opens a modal can't be
   misattributed to the following hover.
2. **Auto-discovered targets.** From the seed page it collects up to 80 visible interactive
   elements (stable `nth-of-type` selectors + `rect` + text/aria) and up to 4 visible canvases.
   Only **safe clicks** are fired — buttons, `summary`, `role=button`, in-page `#` anchors, and
   same-origin links — so the crawl never navigates off-site or submits a form.
3. **Four action types**, in order: two **scrolls** (to 50% and 100% of scrollable height),
   **hovers**, safe **clicks**, then **canvas-drag** (press at center, drag ~25%×20% of the
   canvas, release).
4. **Multi-signal change detection.** After each action it snapshots the page and compares
   before/after. `changed = true` if **any** of these moved:
   - `url`
   - a fast hash of `document.documentElement.outerHTML`
   - `scrollY`
   - visible-overlay `counts` (dialogs, popovers/menus/drawers, canvases, videos, buttons, forms)

   Relying on one signal alone lies — a scroll-driven canvas repaint won't change the DOM hash but
   moves `scrollY`; a modal changes `counts` but not the URL. The multi-signal AND/OR is what
   catches all of them.

**How to read the interactions artifact:** the Markdown table lists `# / Type / Target / Changed /
URL after / Screenshot`. Walk the screenshots in order and correlate with `changed`. The `network`
array (only `xhr`/`fetch` responses) reveals data-driven behavior — its presence pushes you toward
M3. `findings` summarizes candidate counts and the `changed/total` ratio, and explicitly warns:
**"Canvas drag evidence exists; inspect screenshots before simplifying WebGL/Canvas behavior."**
Heed it — a canvas that responds to drag is an interactive effect, not a poster image.

> `isTrusted` caveat: synthetic pointer events report `isTrusted=false`; some real drag handlers
> ignore them. A "no change" on canvas-drag is **inconclusive**, not proof of a static canvas —
> record it as such and confirm visually. Never fake "drag succeeded."

## Identify the interaction model BEFORE building

This is the payoff of recon and the **most expensive mistake to get wrong**. Before choosing a
mode or writing a spec, classify the page's primary interaction model from the sweep evidence:

| Model | Tell-tale signals | If you mislabel it |
|-------|-------------------|--------------------|
| **Scroll-driven** | Only the two `scroll` actions flip `changed`; `lenis`/`gsap` present; tall `scrollHeight`; canvas repaints on scroll | You build click handlers for a scroll-timeline — nothing fires; the whole animation is dead |
| **Click-driven** | Safe `click` actions change DOM hash or overlay `counts` (modals, tabs, accordions) | You wire scroll triggers to state that only advances on click — content never appears |
| **Hover-driven** | `hover` actions change styles/overlays; often no DOM-hash change, subtle visual deltas | You skip hover states entirely; the clone feels flat and "wrong" |
| **Time-driven** | Content changes with **no** action (carousels, autoplay, looping WebGL); `changed` on actions is coincidental | You bind an autoplay carousel to clicks; it never advances on its own |

Write the identified model into `NOTES.md` **before** building. It is a direct input to
[assessment](assessment.md)'s mode + complexity (L1–L6) decision, and it constrains the spec:
[spec-and-dispatch](spec-and-dispatch.md) captures multi-state diffs (scroll / click / hover) that
only make sense once the model is known.

Do not compensate later. If you picked the wrong model, the fix is to re-recon and re-classify —
**not** to tweak speeds, triggers, or thresholds to fake the behavior (the no-compensation rule).

## Route map (multi-page targets)

For anything beyond a single page, run `route-crawl.mjs`. It BFS-crawls **same-site** internal
links (`--allow-subdomains` to widen), normalizes URLs (drops hashes, sorts query params, trims
trailing slash), and bounds itself with `--max-pages` (25) and `--max-depth` (2).

Read `route-map.json` / `.md`:

- **`routes[]`** — per route: `depth`, HTTP `status`, `title`, `h1`, `counts`, `linkCount`, and a
  screenshot. This is your build inventory and page-priority list.
- **`skipped[]`** — with reasons (`external`, `depth>N`, or an error string) so nothing silently
  vanishes.

The route map defines scope. Confirm with the user before expanding a single-page clone into a
whole-site crawl — default scope is the pages given.

## Recon checklist

- [ ] `recon.mjs` run at **1440 / 768 / 390**; three full-page screenshots exist.
- [ ] `recon.json` read: `frameworks`, `counts`, `scrollHeight`, `cssVariables`, `fonts`,
      `canvases[]`, `console.errors` all reviewed.
- [ ] `interaction-probe.mjs` run; screenshots walked; `changed` ratio and `network` reviewed.
- [ ] Canvas-drag evidence inspected before any decision to simplify a canvas/WebGL section.
- [ ] `route-crawl.mjs` run for multi-page targets; scope confirmed with the user.
- [ ] **Interaction model classified** (scroll / click / hover / time) and written to `NOTES.md`.
- [ ] Fingerprints treated as PARTIAL leads, to be confirmed in
      [source-recovery](source-recovery.md).

Recon is done when the artifacts exist **and** you can state, in one sentence each, how the page
looks, how it behaves, and what it is built with — with a screenshot or JSON field backing every
claim. Then proceed to [assessment](assessment.md).
