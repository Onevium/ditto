# M5 · Design-DNA Reskin

Turn "make it feel like that site" from a vague vibe into a **versionable, reusable,
checkable JSON spec**. M5 is the "keep the DNA, swap the content" mode: after recon
(Step 1), before you scaffold the build, you emit one extra artifact —
`design-dna.json` — so that replacing the original's content with the user's own has
something concrete to lean on. **Keep the DNA, swap the content.**

> Schema and method adapted from [zanwei/design-dna](https://github.com/zanwei/design-dna)
> (MIT), retrimmed to this skill's vocabulary.

## Contents

- [When to use M5 — and when NOT to](#when-to-use-m5--and-when-not-to)
- [The 3-layer schema](#the-3-layer-schema)
- [Workflow: Structure → Analyze → Generate](#workflow-structure--analyze--generate)
- [scripts/dna-scaffold.mjs — best-effort prefill](#scriptsdna-scaffoldmjs--best-effort-prefill)
- [effect_intensity → implementation tier](#effect_intensity--implementation-tier)
- [Emitting the DNA: CSS vars / Tailwind / shadcn](#emitting-the-dna-css-vars--tailwind--shadcn)
- [Hand-off to the M4 WebGL branch](#hand-off-to-the-m4-webgl-branch)

## When to use M5 — and when NOT to

Design-DNA's generative philosophy is **"approximate the style"** — it produces a
*style-consistent new site*, not a byte-for-byte copy. That is the **opposite direction**
from the [Iron Rule: real source first](../SKILL.md). So the boundary is hard:

| Situation | DNA? |
|---|---|
| **M1 Static Mirror** (true source recovered / single-file native site) | **Never.** The real source *is* the truth — don't let DNA dilute it to "roughly similar." |
| **M4 Effect Reverse-Engineer** (WebGL / shader, byte-faithful) | **Never** for the effect itself — reverse it. DNA only covers the *non-effect* design layer. |
| **M2 / M3 rebuild where the ask is "keep the look, swap the content"** | **Yes.** DNA is the main artifact of this path. |
| Content overhaul (keep IA + rhythm + visual grammar, pour in new content) | **Yes.** DNA defines *what to preserve*; the content is free to change. |

One line: **DNA is for "build my own version," never for "ship an identical copy."**
This is the same rule SKILL.md states as *"Never mix M1 and M5."*

## The 3-layer schema

`design-dna.json` splits into three layers by how objective each field is:

| Layer | Nature | Contents | Where it lands |
|---|---|---|---|
| **`design_system`** | Measurable tokens | color · typography (type scale) · spacing · layout · shape · elevation · iconography · motion · components | Straight into CSS custom properties / Tailwind theme |
| **`design_style`** | Subjective perception | aesthetic (mood/genre/era) · visual_language (complexity/density) · composition · imagery · interaction_feel · brand_voice_in_ui | Guides subjective build choices, not codegen |
| **`visual_effects`** | Beyond-plain-CSS rendering | background · particles · 3d · shader · scroll · text · cursor · image · glass/neu · canvas · svg — each with an `enabled` flag and params | `effect_intensity` decides the implementation tier; hands heavy effects to M4 |

`design_system` is the load-bearing, objective layer — every value should be traceable to
recon evidence (grade it `SOURCE` when read from `getComputedStyle` / CSS vars, `PARTIAL`
when inferred from a screenshot, `GUESS` when you're eyeballing). `design_style` is where
human judgement lives. `visual_effects` is the bridge to the effect branch.

## Workflow: Structure → Analyze → Generate

### 1. Structure

Run the scaffold (below) to get the full skeleton, confirm which dimensions are relevant,
and prune the ones that aren't. Don't hand-author the JSON from memory — start from the
scaffold so your field names match this doc exactly.

### 2. Analyze

Fill every field from recon artifacts. Map from `<label>-recon.json` (see [recon](recon.md)):

| DNA field | Read from recon |
|---|---|
| `color.primary` / `accent` | `cssVariables` (color-valued `--*`) + `sections[].style.backgroundColor` / `color`. **Primary = largest painted area; accent = the CTA color.** |
| `typography.font_families` | `fonts[]` + `sections[].style.fontFamily`, split into heading / body / mono |
| `typography.type_scale` | `getComputedStyle` font-size / weight / line-height / letter-spacing per role (`computed-style.mjs` on heading vs body nodes) |
| `spacing` / `layout` | screenshots + `sections[].rect` — measure rhythm and `max_content_width` |
| `visual_effects.*` | `frameworks.three / gsap / lenis` + `canvases` + `counts.canvas` → set `primary_technology` and each `enabled` flag |
| `design_style` (mood / genre / composition / density) | human read of the 1440 / 768 / 390 screenshots |

Rules:
- **Fill every field with something real. Do not leave empty strings.** If you can't
  determine a value, write `TODO: <what evidence is missing>` so the gap is auditable.
- Grade objective fields `SOURCE` / `PARTIAL` / `GUESS`; you may not ship a `GUESS` token
  without noting it.

### 3. Generate

Parse the DNA → emit CSS custom properties from `design_system` → make subjective calls
per `design_style` → pick the implementation tier per `effect_intensity` → build pages →
pour in the user's own content. **Prefer real harvested images from the original (run
`scripts/asset-harvest.mjs`) over AI-redrawn approximations.**

## scripts/dna-scaffold.mjs — best-effort prefill

Purpose: emit the complete DNA skeleton and **best-effort prefill** the fields recon can
prove, leaving the rest as `""` for a human to complete in the Analyze pass.

```bash
node scripts/dna-scaffold.mjs \
  --out   clones/<slug>/RECON/design-dna.json \
  --recon clones/<slug>/RECON/<label>-recon.json \
  [--name "<site name>"]
```

Paths are **relative to the current clone directory** — never a home directory. With no
`--recon` it still runs and emits an empty skeleton.

**What it prefills from real signals only:**

| It writes | From |
|---|---|
| `typography.font_families.{heading,body,mono}` | `fonts[]` + section `fontFamily`; mono detected by `/mono\|code\|consol\|courier/` |
| `color.surface.background` | first non-transparent section `backgroundColor` |
| `visual_effects.overview.primary_technology` + `performance_tier` | `frameworks.three` → `WebGL/Three.js` + `heavy`; else canvas → `Canvas 2D`; else `gsap` → `GSAP` |
| `visual_effects.3d_elements.enabled` / `canvas_drawings.enabled` / `scroll_effects.*` | framework + canvas signals; `lenis` → notes "lenis smooth-scroll detected" |
| `meta.source_references` / `meta.name` | recon `href` / `title` |

**The discipline that makes it trustworthy — it never fabricates color roles.** Every
color-like value it finds is dropped into a top-level `_recon_signals.color_candidates`
array (capped at 24) rather than assigned to `primary` / `secondary` / `accent`. Choosing
which candidate is primary vs accent is a **human judgement call** — the script refuses to
guess it. It also emits `_scaffold_note` telling the operator exactly what still needs
completing. Once you've assigned roles and filled the `""` fields, delete `_recon_signals`
and `_scaffold_note`.

The scaffold reads recon whether signals are nested under `captures[].signals` (it flattens
the widest viewport) or already flat, and degrades to an empty skeleton if the recon file
won't parse — it never crashes the pipeline.

## effect_intensity → implementation tier

`visual_effects.overview.effect_intensity` is the switch that decides *how much machinery*
you're allowed to spend on the reskin. Map it straight to a tier:

| `effect_intensity` | `performance_tier` | Implement with |
|---|---|---|
| `none` / `subtle-accent` | **lightweight** | CSS / SVG / vanilla JS (transitions, gradients, `@keyframes`, SVG SMIL) |
| `moderate` | **medium** | Canvas 2D + GSAP / Lottie (scroll-triggered, particle fields, morphs) |
| `heavy-immersive` | **heavy** | Three.js / GLSL / Pixi.js |

Pick the **lowest tier that reproduces the perceived effect.** Reaching for Three.js when a
CSS gradient animation would read identically is wasted budget and a maintenance liability.
This mirrors SKILL.md's **no-compensation rule** — don't overbuild an effect to mask that
you never identified what it actually is.

## Emitting the DNA: CSS vars / Tailwind / shadcn

`design_system` is designed to land directly as tokens. Choose the target that matches the
rebuild stack:

- **CSS custom properties** — the default. Write `design_system.color` as `oklch` variables,
  the `type_scale` as `--text-*` / `--leading-*` / `--tracking-*`, spacing as a `--space-*`
  scale, into `globals.css`. This is exactly the [framework-rebuild](framework-rebuild.md)
  "foundation first" step — do it *before* fanning out builders so components can't diverge.
- **Tailwind theme** — map the same tokens into `theme.extend` (colors, `fontSize`,
  `spacing`, `borderRadius`, `boxShadow`) so utility classes carry the DNA.
- **shadcn** — set the `--primary` / `--secondary` / `--accent` / `--muted` / `--border`
  design-token variables in the shadcn convention; components inherit the reskin for free.

Whichever you pick, the DNA is the single source of truth for tokens — SKILL.md's "Make It
Yours" step says: *if a `design-dna.json` exists, land `design_system` as CSS custom
properties.*

## Hand-off to the M4 WebGL branch

For any site whose `visual_effects` is marked `heavy-immersive` / `WebGL/Three.js` /
`shader_effects.enabled=true`:

- **Do not use DNA to "approximate" that effect.** That is [M4 effect-extraction](effect-extraction.md)
  work — reverse the real implementation, honoring the [Iron Rule](../SKILL.md),
  `SOURCE`/`PARTIAL`/`GUESS` grading, the no-compensation rule, and the baseline-first gate.
- In such a site, DNA covers only the design layer *outside* the effect — color, type,
  layout, ordinary motion. The signature effect itself goes through M4 (or a delegated
  shader-extraction agent).

M5 and M4 are complementary, not alternatives: DNA reskins the frame, M4 rebuilds the
centerpiece.
