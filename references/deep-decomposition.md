# Deep Decomposition, Space Planning & Loop Engineering

The one-stop pipeline that turns a live page into a faithful clone without skipping the details
that give a site its life — video backgrounds, grain/texture overlays, cursor-reactive canvas
effects, scroll-driven motion. This is what separates a lifeless box-and-text skeleton from a
1:1 clone. Applies mainly to **Faithful** and **Hybrid** fidelity intents (see
[assessment](assessment.md) and the SKILL Pre-Flight gate).

## Contents

- [Why this exists](#why-this-exists)
- [Stage 1 — Deep decomposition](#stage-1--deep-decomposition)
- [Stage 2 — Space planning](#stage-2--space-planning)
- [Stage 3 — Loop engineering](#stage-3--loop-engineering)
- [The dynamic-detail checklist](#the-dynamic-detail-checklist)

## Why this exists

The default failure mode is to catalogue the **static** layout (sections, headings, colors, text)
and treat everything moving as a placeholder. You then ship a page where the hero is a flat
gradient instead of a looping video with a cursor-reactive ASCII field, and it reads as dead.
Root cause: no explicit step forced a full inventory of the **dynamic** layer, and no loop forced
you to compare against the original and keep fixing. This doc supplies both.

## Stage 1 — Deep decomposition

Go region by region, top to bottom. **Scroll the whole page first** — media and canvases mount
lazily, so a load-time snapshot misses them. For every region capture three layers:

1. **Static** — computed styles (via `scripts/computed-style.mjs`), tokens, spacing, verbatim text.
2. **Assets** — every real `<img>` (resolved `currentSrc`), **`<video>`** (`src` + `poster`),
   `background-image`, `<canvas>`, fonts. Harvest them with `scripts/asset-harvest.mjs`. In
   Faithful mode these are downloaded, not invented.
3. **Dynamic** — every interaction and animation, each graded `SOURCE` / `PARTIAL` / `GUESS`:
   - hover states, **mouse-move / cursor-reactive** effects, focus states;
   - scroll-driven reveals / parallax / pinned sections (Lenis / GSAP ScrollTrigger);
   - autoplay video loops, time-driven loops, marquees;
   - `<canvas>` / WebGL / shader effects (grain, flow fields, particles, 3D) → see
     [effect-extraction](effect-extraction.md) and `scripts/gl-capture.mjs`.

Use `scripts/interaction-probe.mjs` for the sweep. When a mechanism will not extract cleanly
(compiled canvas logic, obfuscated shader), **say so and re-create the *effect*** as a `PARTIAL` —
honest re-creation beats a fake `SOURCE` claim (the [marbles](marbles-case.md) lesson) and beats a
dead placeholder. Never tune it later just to pass a diff (the no-compensation rule).

The output is a **decomposition table** per region: `element | static | assets | dynamic + grade`.

## Stage 2 — Space planning

Turn the decomposition into a build plan before writing components:

- **Region map** — an ordered list of sections (hero, logo bar, feature ×N, testimonials, CTA,
  footer) with their vertical rhythm and background treatment.
- **Component tree** — shared primitives (button, card, nav) vs per-region components.
- **Per-region spec** — one `specs/<region>.spec.md` carrying its exact tokens, the harvested
  asset paths, and its **interaction model** (static / hover / scroll / mouse-move / time). Keep
  each under the ~150-line budget; split if larger. This is the contract a builder receives
  in full (see [spec-and-dispatch](spec-and-dispatch.md)); a builder must never guess.

Lock the **foundation first** (fonts, design tokens, shared assets) so parallel builders can't
diverge (see [framework-rebuild](framework-rebuild.md)).

## Stage 3 — Loop engineering

One build is a draft, not a deliverable. Iterate:

```
build region → capture (headful: video + motion; move mouse; scroll)
             → diff vs original (visual-diff SSIM + compare-recon + your eyes)
             → find the single biggest gap
             → fix it → re-capture → re-diff
             → repeat until threshold met OR remaining gaps are documented PARTIAL
```

Rules that keep the loop honest and terminating:

- **Capture like-for-like.** Headful real Chrome (headless can't decode H.264 or run some effects);
  same viewports; trigger the same states (hover, cursor position, scroll depth) you saw live.
- **Trust your eyes over the metric.** Full-page SSIM under-reports when proportions differ (a
  taller original vs a compact clone compares real content against padding). Read the diff image
  and the two screenshots side by side; fix *missing media / motion / spacing*, not the number.
- **One gap per iteration.** Fix the largest visible discrepancy, then re-measure — don't batch
  blind changes.
- **Stop when honest.** Threshold met, or every remaining gap is written down (a `PARTIAL`
  re-creation, an un-harvestable asset, a proprietary font substitution). Do not loop forever and
  do not fake the finish. Log what you capped.

For large pages, the loop is per-region and parallel: dispatch builders (worktrees), then diff and
re-dispatch fixers only for regions above the discrepancy threshold — the foreman model in
[spec-and-dispatch](spec-and-dispatch.md), with this doc's capture→diff→fix loop as its inner cycle.

## The dynamic-detail checklist

Tick every row for each region before declaring decomposition complete:

- [ ] Real images harvested (not placeholders, in Faithful/Hybrid)
- [ ] `<video>` backgrounds / demos harvested and wired (autoplay muted loop playsinline)
- [ ] `background-image` and CSS gradients captured
- [ ] `<canvas>` / WebGL effects identified; mechanism graded; SOURCE or honest PARTIAL re-creation
- [ ] Grain / texture / noise overlays
- [ ] Hover states
- [ ] **Mouse-move / cursor-reactive** effects
- [ ] Scroll-driven reveals / parallax / pinned sections
- [ ] Time-driven loops / marquees / autoplay
- [ ] Fonts (real or documented substitute)
- [ ] Interaction model labelled per region
