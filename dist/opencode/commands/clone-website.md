---
description: "Reverse-engineers and clones any website — from a single static HTML file to a WebGL-heavy interactive app — by recovering real source where possible, then either mirroring it byte-for-byte or rebuilding it as clean Next.js/React, with objective pixel-diff verification. Use when the user wants to \"clone this site\", \"replicate\", \"rebuild this page\", \"reverse-engineer\", \"copy\", \"mirror\", \"make a copy of\", or get a \"pixel-perfect clone\" of a website or a specific interaction / WebGL / Canvas effect. Provide one or more target URLs as arguments."
---
<!-- AUTO-GENERATED from SKILL.md — do not edit directly.
     Run `node scripts/sync-skills.mjs` to regenerate. -->


# Clone Website

You are recovering how a real site is **built**, then producing **the user's own version** of
it — not shipping an identical copy. The whole point is a lawful, transformative result: same
craft, different content. Move through the decision tree in order; each step links one level
deep into `references/` for the full detail.

## Iron Rule: Real Source First

**Assume every AI-written implementation code block is hallucinated until verified against real
source.** An AI "clone analysis" is fine for a conceptual skeleton, but its code is a guess.

The canonical failure — the *marbles case* — is an AI analysis that described analytic
ray–sphere intersection plus an SVG `feDisplacementMap` refracting the live DOM as "ray-marching
+ SDF + sampling the DOM as a texture." Completely wrong, and slower. If you had copied that
code, you'd have shipped a broken, mislabeled effect.

So: **recover the real source before you write code.** When you cannot, capture runtime ground
truth (see M4). Grade every implementation claim `SOURCE` / `PARTIAL` / `GUESS` — untagged means
`GUESS`, and you may not copy a `GUESS`. → `references/marbles-case.md`

**Before building, read `references/guiding-principles.md`** — the operating doctrine and the
"What NOT to Do" list (real/layered assets, never mock a `<video>`/`<canvas>`, extract behavior
not just looks, identify the interaction model first). Most lifeless-clone failures are a
principle ignored there, not a CSS bug.

## Scope Defaults & Ethics

- Default to a **faithful visual + behavioral clone** of the pages given; ask before expanding
  scope to a whole site.
- **In scope:** layout, styling, components, content structure, animations, interactions.
- **Out of scope:** backend, database, real auth, payment flows — you produce a frontend.
- **Never** clone for phishing, impersonation, or credential harvesting. Never bypass login or
  paywalls. Strip the original's logos, trademarks, and copyrighted text/images and replace them
  with the user's own. Respect `robots.txt` and Terms of Service. → `references/licensing.md`

## Pre-Flight

1. Parse `$ARGUMENTS` as one or more URLs. Normalize, validate, and confirm each is reachable.
2. **Ask the Fidelity Intent** (do not assume — this decision changes everything downstream):
   - **Faithful / 1:1** — harvest **every** real asset (images, **videos**, fonts) and reproduce
     **every** animation and interaction as closely as possible. For study/reference.
   - **Substitute / make-it-yours** — keep structure + design grammar, swap media for
     placeholders/CSS and content for the user's own. For shipping a derived site.
   - **Hybrid** — faithful on the defining visuals (hero, product demo, signature motion),
     substitute the rest.
   Record the answer in `NOTES.md`. **In Faithful/Hybrid mode a defining visual (hero media,
   product demo, signature animation) may NEVER be replaced by a flat placeholder** — that is the
   mistake that produces a lifeless clone. Placeholders belong only to Substitute mode.
3. Confirm a browser backend: **Chrome MCP / headful real Chrome preferred, headless Playwright
   fallback.** Headless Chromium is blocked by Cloudflare/anti-bot and **cannot decode H.264
   video** — use `recon.mjs --headful` for anti-bot sites and to verify video/animation. If a
   capture returns "Just a moment…" or an empty shell, **fail loudly**; never ingest it as content.
4. Run `scripts/init-clone.mjs <slug> --url <url>` to scaffold `./clones/<slug>/` with
   `RECON/`, `screenshots/`, `specs/`, and a pre-filled `NOTES.md`. Paths are **relative to the
   current directory** — never a home directory.

Do **not** commit to a build strategy yet. You choose the mode in Step 3, after recon and source
recovery.

## The Decision Tree

Walk these steps in order. Do not skip ahead to building.

### Step 1 — Recon

Record how the site **looks**, **behaves**, and is **built** into auditable artifacts before
writing any code.

- Run `scripts/recon.mjs` → full-page screenshots at **1440 / 768 / 390**, framework
  fingerprints (`__NEXT_DATA__`, `__NUXT__`, `ng-version`, `window.THREE`, canvas count, Lenis /
  GSAP), CSS custom properties, fonts, canvas dims, `scrollHeight`, console errors → `recon.json`
  + `summary.md`.
- Run `scripts/interaction-probe.mjs` (fresh page per action: scroll / hover / safe-click /
  canvas-drag with multi-signal change detection).
- For multi-page targets, run `scripts/route-crawl.mjs` to produce a route map.

**Deep decomposition — inventory EVERY dynamic detail, never just the static layout.** Scroll the
whole page first (media and canvases mount lazily). For each region, list and grade
`SOURCE`/`PARTIAL`/`GUESS`: real media (`<img>` **and** `<video>` src, `background-image`),
`<canvas>`/WebGL effects, and **every** motion — hover states, **mouse-move / cursor-reactive**
effects, scroll-driven reveals, autoplay loops, time-driven animation. The lifeless-clone failure
comes from cataloguing boxes and text while skipping the video background, the grain overlay, and
the cursor-reactive ASCII field. If a mechanism will not extract cleanly, say so and re-create the
*effect* honestly (grade `PARTIAL`) — never pretend, never fake a diff pass. → `references/recon.md`
· `references/deep-decomposition.md`

**Identify the interaction model — scroll-driven vs click vs hover vs mouse-move vs time-driven —
BEFORE building.** Mislabeling it is the single most expensive mistake.

### Step 2 — Recover Source

Get ground truth so you never guess implementation code (the marbles lesson).

- **GitHub search** — `gh api 'search/repositories?q=<keyword>'`. Deploy slugs on
  `vercel.app` / `netlify.app` / `github.io` often *are* the repo or user name. Single-file
  sites: `curl` the raw `index.html`.
- `scripts/sourcemap-hunt.mjs` — recover `sourceMappingURL` / `.map` bundles and un-webpack
  minified code into `SOURCE`-grade files.
- For static-built sites, `scripts/mirror-site.mjs` — full-scroll browser capture of every
  same-origin asset, including runtime-fetched `.wasm` / `.buf` / `.sog` / `.riv` / fonts.

If source is found **and** its license permits reuse, you have the fastest, most faithful path.
Note it (and the license) in `NOTES.md`. → `references/source-recovery.md`

### Step 3 — Grade & Pick Mode (the hinge)

This is the headline decision. Grade complexity **L1–L6**, then pick **exactly one** of five
modes. → `references/assessment.md`

| Mode | When | Path |
|------|------|------|
| **M1 · Static Mirror** | L1 static, static-built (Astro/Vite SSG/Hugo), or true source recovered | `mirror-site.mjs` / `wget` + strip trackers → `references/static-mirror.md` |
| **M2 · Framework Rebuild** | L2–L3 content site (React/Vue/Next) | pour real content into the Next.js scaffold → `references/framework-rebuild.md` |
| **M3 · API-Fixture Rebuild** | L4–L5 SPA / SaaS / data-driven | `network-capture.mjs` fixtures + mock server → `references/framework-rebuild.md` |
| **M4 · Effect Reverse-Engineer** | L5–L6 WebGL / Canvas / Three.js heavy | line-by-line from source, or `gl-capture.mjs` runtime capture → `references/effect-extraction.md` |
| **M5 · Design-DNA Reskin** | "keep the look, swap the content" | `dna-scaffold.mjs` → `references/design-dna.md` |

**Never mix M1 and M5.** A byte-for-byte mirror is truth; an approximate design-DNA reskin would
only dilute it to "roughly similar." Pick one intent.

Write the chosen mode **and a pre-clone fidelity prediction** (expected match range, explicitly
non-cloned parts) into `NOTES.md` before building.

## Building — Rebuild Modes (M2 / M3)

### Foundation first (lead only, sequential)

Lock shared tokens and assets before any parallel work, so builders can't diverge:

1. Set fonts (`next/font`).
2. Write `globals.css` design tokens — colors as `oklch` CSS variables, spacing scale,
   keyframes, smooth-scroll config.
3. Create `src/types` content interfaces.
4. Extract and **de-duplicate** inline SVGs into `src/components/icons.tsx`.
5. Run `scripts/asset-harvest.mjs` (batched, 4 at a time) to download **real** assets — never
   AI-redrawn approximations — into `public/`.
6. **`npm run build` must pass** before you fan out. → `references/framework-rebuild.md`

### Foreman loop (spec → dispatch → merge)

Work section by section, top to bottom:

1. Run `scripts/computed-style.mjs` against the section container → exact `getComputedStyle`
   values (keep meaningful zero/default values; record original class names), multi-state diffs
   (scroll / click / hover, diff A vs B), verbatim text/aria, asset refs.
2. Write `clones/<slug>/specs/<name>.spec.md` from the fixed template. **Enforce the ~150-line
   complexity budget** — if a section is bigger, split it.
3. **Dispatch one builder subagent per component in an isolated git worktree**, with the FULL
   spec inlined into the prompt (never "go read the doc"), plus the screenshot path, shared
   imports, target path, breakpoints, and the instruction to verify `npx tsc --noEmit`.
4. Don't block — extract the next section while builders run.
5. Merge each worktree, run `npm run build`, keep the tree green.

→ `references/spec-and-dispatch.md`

## Building — Faithful Modes (M1 / M4)

### M1 · Static Mirror

`scripts/mirror-site.mjs` for a full-scroll byte-for-byte capture (or `wget --mirror` for purely
static-linked HTML). Self-host locked webfonts (hotlink protection will 404 them otherwise).
Strip trackers. → `references/static-mirror.md`

### M4 · Effect Reverse-Engineer

The hard branch. Reproduce WebGL / Canvas / shader work without self-deception:

- Decompose into pillars: render / compositing / physics / interaction / audio.
- Grade every claim `SOURCE` / `PARTIAL` / `GUESS`. Reach `SOURCE` before copying. Use `grep` to
  tell mechanisms apart — `texture2D` / `sampler2D` (texture sampling) vs a ray-march loop
  (`+= dS`, `MAX_STEPS`) vs an analytic discriminant (`b*b - 4ac`, `sqrt`) — so you never repeat
  the marbles mistake.
- **No-compensation rule:** never tweak brightness / speed / coordinates to mask a bug.
- **Baseline-first gate:** build a minimal RAW REPLAY from the real draw calls / shaders /
  uniforms and pass a frame-by-frame check BEFORE projectizing.
- When there is no source, run `scripts/gl-capture.mjs` (patches `WebGLRenderingContext` +
  `getShaderSource`, spector.js-style) — captured runtime truth counts as `SOURCE`.

→ `references/effect-extraction.md`

## Verify — Loop Engineering (iterate, don't ship the first build)

Building once is not done. **Close the loop until fidelity crosses the threshold**, then stop:

1. **Capture** the clone the same way you captured the original — same viewports, **headful** so
   video/animation actually render (headless can't decode H.264), and move the mouse / scroll to
   trigger cursor-reactive and scroll-driven states.
2. **Diff** — `scripts/visual-diff.mjs` (pixel + **SSIM** at 1440/768/390),
   `scripts/compare-recon.mjs` → `CLONE_REPORT.md`, and require **zero** console/JS/WebGL errors.
3. **Find the biggest gap** — read the diff image *and* the screenshots side by side; the metric
   under-reports when proportions differ, so trust your eyes on missing media/motion/spacing.
4. **Fix that gap, re-capture, re-diff. Repeat** until above threshold (e.g. SSIM ≥ target) or the
   remaining gaps are documented `PARTIAL` re-creations.
5. `scripts/audit-clone.mjs` → `CLONE_AUDIT.md` (tracker / brand-residue / placeholder scan) before
   calling it done.

**Record honestly what cannot be verified or was only re-created** — a synthetic `PointerEvent`
has `isTrusted=false` and can't fire a native drag; a re-created shader is `PARTIAL`, not `SOURCE`.
Never fake success, never tune values just to move the metric. → `references/verification.md`

## Make It Yours + Licensing

1. Check the LICENSE via `gh api repos/<u>/<r>`: MIT / Apache / BSD = reuse + attribute;
   **none = All Rights Reserved, local learning only**; proprietary = read-only. "Public on
   GitHub ≠ MIT."
2. Strip GA / gtag / GTM / pixels line by line.
3. Replace the three-piece set: **text** (`index.html` / `data/*` / `content/*`), **media**
   (prefer harvested originals), **brand colors** (CSS variables / Tailwind theme).
4. If a `design-dna.json` exists, land `design_system` as CSS custom properties.
5. Finalize `NOTES.md` — source, stack, license, replacement map, known gaps — framing the work
   as transformative and for learning. → `references/licensing.md`

## Completion Report

Report back: sections built, specs written, assets downloaded, build status, visual-diff score
per viewport, and the honest list of known gaps / unverifiable parts.

## Appendix: Checklists

**Pre-dispatch (per section):** spec written from template · under 150 lines · computed-style
values captured · screenshot path included · shared imports listed · breakpoints noted.

**Pre-deploy:** zero console errors · trackers stripped · logos/trademarks removed · text &
media replaced · visual-diff scored · `NOTES.md` finalized · license checked.
