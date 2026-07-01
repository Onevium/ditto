# Complexity Assessment & Mode Selection

This is Step 3 of the [SKILL](../SKILL.md) decision tree — the hinge. You have finished recon
([recon](recon.md)) and source recovery ([source-recovery](source-recovery.md)). Now grade the
site **L1–L6**, pick **exactly one** of five modes **M1–M5**, and write a pre-clone prediction
into `NOTES.md` *before* you build. Do not start building until this is written down.

Ground every grade in evidence you actually captured: `recon.json`, screenshots, the network
list, recovered source. Untagged claims are `GUESS`, and you may not build a faithful mode on a
`GUESS`.

## Contents

- [Complexity rubric L1–L6](#complexity-rubric-l1l6)
- [The five modes](#the-five-modes)
- [Mode selection table](#mode-selection-table)
- [The M1 ⟷ M5 mutual-exclusion rule](#the-m1--m5-mutual-exclusion-rule)
- [Pre-clone prediction (write to NOTES.md)](#pre-clone-prediction-write-to-notesmd)
- [Worked routing examples](#worked-routing-examples)

## Complexity rubric L1–L6

Grade the *hardest* thing on the page, not the average. A mostly-static marketing page with one
WebGL hero is L5 for that hero. The "typical fidelity" column is the honest ceiling you can hit
*with source*; without source, subtract and lean on M4's baseline-first gate.

| Grade | Type | Signals in `recon.json` | Typical fidelity | Default boundary |
|---|---|---|---|---|
| **L1** | Static HTML/CSS | Few/no JS, no framework fingerprint, low page count, static-built (Astro/Vite SSG/Hugo) | 90–98% | Near pixel-level; media copyright handled separately |
| **L2** | CMS / enterprise content site | Many pages, CMS-generated, forms / news / regional variants | 70–90% | Front-end reproducible; CMS admin is not cloned |
| **L3** | React/Vue/Next content front-end | Hydration, chunked bundles, client routing, content fetched from an API | 65–90% | Data/API replaced with local JSON fixtures |
| **L4** | Animation-heavy brand site | GSAP / Lenis / ScrollTrigger / Locomotive, complex scroll, video masks | 50–80% | Hero + rhythm reproducible; micro-interactions often approximate |
| **L5** | WebGL / Canvas / Three.js | `window.THREE`, canvas count ≥ 1, shaders, physics, post-processing, GPU assets (`.wasm`/`.buf`/`.sog`) | 30–95% | High **with source**; without source, teardown first (M4) then commit |
| **L6** | SaaS / e-commerce / login-gated business | Accounts, payments, orders, permissions, search/recommendation | Presentation layer only | Server-side business logic is not cloned by default |

The wide L5 range is deliberate: source recovered → 95%; no source, runtime-only → often 30–60%
until the [effect-extraction](effect-extraction.md) baseline gate lifts it.

## The five modes

Two families. **Faithful** modes (M1, M4) preserve truth — real bytes or the real effect.
**Rebuild** modes (M2, M3, M5) reconstruct behavior in clean Next.js/React.

| Mode | Family | Intent | Detail doc |
|---|---|---|---|
| **M1 · Static Mirror** | Faithful | Byte-for-byte capture of a static/static-built site or recovered true source | [static-mirror](static-mirror.md) |
| **M2 · Framework Rebuild** | Rebuild | Pour real content into a clean Next.js scaffold | [framework-rebuild](framework-rebuild.md) |
| **M3 · API-Fixture Rebuild** | Rebuild | Rebuild an SPA/SaaS from captured network fixtures + a mock server | [framework-rebuild](framework-rebuild.md) |
| **M4 · Effect Reverse-Engineer** | Faithful | Reproduce WebGL/Canvas/shader work line-by-line from source or runtime capture | [effect-extraction](effect-extraction.md) |
| **M5 · Design-DNA Reskin** | Rebuild | Keep the visual grammar/rhythm, swap in the user's own content | [design-dna](design-dna.md) |

The **Iron Rule: real source first** applies across all of them — an AI "clone analysis" is a
conceptual skeleton, never copyable code (the marbles case, [marbles-case](marbles-case.md)).

## Mode selection table

Read top to bottom and stop at the **first** row that matches. This makes routing deterministic.

| # | If the site is… | Grade | Pick | Because |
|---|---|---|---|---|
| 1 | True source recovered with a permissive license | any | **M1** (or M4 for the effect parts) | Fastest, most faithful path — use the real bytes |
| 2 | L1 static, or static-built (Astro/Vite SSG/Hugo), no dynamic data | L1 | **M1** | Mirror + strip trackers; nothing to rebuild |
| 3 | WebGL / Canvas / Three.js is the point of the page | L5–L6 | **M4** | Effect must be recovered, not guessed; baseline-first gate |
| 4 | SPA / SaaS / data-driven, content comes from XHR/fetch | L4–L5 | **M3** | Capture fixtures, mock the API, rebuild the shell |
| 5 | React/Vue/Next content site, static-ish content | L2–L3 | **M2** | Extract real content, rebuild clean in Next.js |
| 6 | User said "keep the look, use *my* content" | any | **M5** | Design-DNA reskin — grammar preserved, content swapped |

Notes on ties:
- A page can need **two** modes — e.g. M2 for the layout **plus** M4 for one hero effect. That is
  fine; treat the effect as its own sub-target with its own spec. What you may not do is blur M1
  and M5 (next section).
- Row 6 is intent-driven: it is the user's stated goal, not a property of the site. If they want a
  faithful copy, rows 1–5 govern.

## The M1 ⟷ M5 mutual-exclusion rule

**Never apply an approximate Design-DNA reskin to a byte-for-byte mirror.** M1 and M5 are opposite
intents:

- **M1** produces **truth** — the exact original bytes. Its value is that it is *provably* the
  original.
- **M5** produces something **roughly similar** — the same rhythm and visual grammar with different
  content. Its value is that it is *lawfully transformed*.

Reskinning a mirror throws away M1's only advantage (fidelity) without gaining M5's (a clean,
content-swappable rebuild) — you end up with "roughly similar to a copy," the worst of both. So:

1. Decide the **intent** first — faithful copy for study, or a transformed site the user ships.
2. If faithful → M1 (or M4). Do not then reskin it.
3. If transformed → M5 (or M2/M3). Do not start from a raw mirror; start from the design tokens.

The same either/or discipline is why [SKILL](../SKILL.md) says "Pick one intent."

## Pre-clone prediction (write to NOTES.md)

Before building, commit a prediction to `NOTES.md`. This is the contract you verify against later
in [verification](verification.md); an honest low number now beats a surprised low number after.

```markdown
## Pre-Clone Prediction
- Complexity grade: L_
- Chosen mode: M_  (exactly one primary; note any secondary, e.g. "M2 + M4 for hero")
- Evidence grade of the plan: SOURCE / PARTIAL / GUESS
- Expected fidelity range: __–__%   (per viewport if it differs: 1440 / 768 / 390)
- High-fidelity parts: __
- Approximate / substituted parts: __
- Explicitly NOT cloned: __   (backend, auth, payments, proprietary API, licensed media)
- Main risks: license / media / login-state / API / performance / WebGL / responsive
```

Rules for filling it in:
- **Expected fidelity range** must come from the L-grade row above, adjusted down when you lack
  source. Do not promise 95% on an L5 you only captured at runtime until the M4 baseline passes.
- The **"Explicitly NOT cloned"** line is mandatory and load-bearing. Per SKILL scope defaults,
  backend, database, real auth, and payment flows are always out of scope — name them here so the
  boundary is a decision, not an omission. L6 sites: everything server-side (accounts, orders,
  permissions, search/recommendation) goes here by default.
- Respect the **no-compensation rule** and **baseline-first gate**: if you cannot predict a
  faithful result honestly, route to M4 and gate on a raw replay before projectizing — do not
  inflate the number and plan to "tune it later."

## Worked routing examples

| Observed | Grade | Route |
|---|---|---|
| Single `index.html`, inline CSS, `curl`-able | L1 | **M1** — mirror, strip trackers |
| Astro SSG marketing site, no live data | L1 | **M1** — static-built, mirror it |
| Next.js docs site, content from Markdown/MDX | L2–L3 | **M2** — rebuild, pour in real content |
| Dashboard SPA, every panel from `fetch` | L4–L5 | **M3** — `network-capture.mjs` fixtures + mock server |
| Agency site: GSAP + Lenis scroll story, one shader hero | L4/L5 | **M2** for layout **+ M4** for the shader hero |
| Three.js particle landing page, no repo found | L5 | **M4** — `gl-capture.mjs` runtime capture = `SOURCE`, baseline-first |
| Storefront with login, cart, checkout | L6 | Presentation layer via **M3**; auth/payments/orders → NOT cloned |
| "Rebuild this look but with my product copy" | any | **M5** — Design-DNA reskin (never on top of an M1 mirror) |

Once the mode and prediction are in `NOTES.md`, proceed to the matching build doc:
[static-mirror](static-mirror.md) · [framework-rebuild](framework-rebuild.md) ·
[effect-extraction](effect-extraction.md) · [design-dna](design-dna.md), then
[verification](verification.md).
