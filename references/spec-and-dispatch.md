# The Foreman Loop (Spec & Dispatch)

The per-section engine for the **rebuild** modes — **M2 · Framework Rebuild** and
**M3 · API-Fixture Rebuild**. You are a foreman walking the job site top to bottom: inspect a
section, write an exhaustive spec, hand it to a specialist builder, and move on to the next
section while that builder works. Extraction is meticulous and leaves auditable artifacts;
construction is parallel and isolated.

This loop runs **only after the baseline-first gate passes** (foundation locked, `npm run build`
green — see [framework-rebuild](framework-rebuild.md)). It is not used for M1 (mirror), M4
(effect reverse-engineer), or M5 (reskin), which have their own branches in the
[skill](../SKILL.md).

## Contents

1. [Why this loop wins](#why-this-loop-wins)
2. [The cycle at a glance](#the-cycle-at-a-glance)
3. [Step 1 — Extract with computed-style.mjs](#step-1--extract-with-computed-stylemjs)
4. [Step 2 — Write the spec (fixed template)](#step-2--write-the-spec-fixed-template)
5. [The ~150-line complexity budget](#the-150-line-complexity-budget)
6. [Step 3 — Dispatch builders in worktrees](#step-3--dispatch-builders-in-worktrees)
7. [Step 4 — Merge + always-green gates](#step-4--merge--always-green-gates)
8. [Parallelism caveat (hard-won)](#parallelism-caveat-hard-won)
9. [Pre-dispatch checklist](#pre-dispatch-checklist)

## Why this loop wins

| Principle | Consequence |
|-----------|-------------|
| **Completeness beats speed** | A builder that must guess a color, size, or padding has already failed. Extract one more property rather than ship a thin brief. |
| **Small tasks, perfect results** | "Build the whole features section" produces "close enough." One focused component with exact values gets nailed every time. |
| **Spec files are the source of truth** | The spec is the contract between your extraction and the builder. No spec, no dispatch. |
| **Iron Rule still applies** | Values come from the live DOM, not from an AI's memory of what the site "probably" uses. Untagged implementation guesses are `GUESS` and may not be copied. |

## The cycle at a glance

Work section by section, top to bottom. For each section:

```
extract → write spec → dispatch builder(s) → (don't block) → merge → npm run build
```

**Non-blocking is the point.** The instant you dispatch a section's builder(s), start extracting
the next section. Builders run in parallel inside their own worktrees while you keep moving.
Merge each worktree as it lands and keep the tree green.

## Step 1 — Extract with computed-style.mjs

Run `scripts/computed-style.mjs` against the section container (via the browser backend). It
returns exact `getComputedStyle` values for the container and its descendant tree — do **not**
hand-measure or eyeball properties. The JSON artifact (write it under
`clones/<slug>/RECON/` alongside the section screenshot) carries, per node:

- `tag`, `classes` — **record the original class names**; they are hints about the design system
  and let you diff against re-extraction later.
- `styles` — the computed values. **Keep meaningful zero/default values** (e.g. `letterSpacing:
  0px` on a heading, `borderRadius: 0`, `opacity: 1`) when they are load-bearing for the look;
  do not silently drop them just because they equal a default. A dropped `0` becomes a builder's
  guess.
- `text` — verbatim text nodes (trimmed).
- `images` — `src`, `alt`, `naturalWidth/Height` for every `<img>`, including
  absolutely-positioned overlays (layered compositions are common — a background plus a
  foreground UI mockup plus an overlay icon).

**Multi-state diffs.** For anything stateful — scroll-triggered header, hover, active tab —
capture **State A**, trigger the change (scroll / click / hover through the browser backend),
then re-run `computed-style.mjs` on the same node for **State B**. The diff between A and B *is*
the behavior spec. Record it as: `property: A → B, trigger: <exact mechanism>, transition:
<value>`. Identify the interaction model (scroll- vs click- vs hover- vs time-driven) **before**
writing the spec — mislabeling it forces a rewrite, not a CSS tweak (see [recon](recon.md)).

Grade any implementation claim you make about *how* an effect is produced `SOURCE` / `PARTIAL` /
`GUESS`. Layout and computed styles read straight off the DOM are `SOURCE`; a hypothesized
mechanism you have not confirmed is `GUESS`.

## Step 2 — Write the spec (fixed template)

Write one spec per component to `clones/<slug>/specs/<component-name>.spec.md`. This template is
**fixed** — fill every section; if a section truly does not apply, write `N/A` (but think twice
before marking **States & Behaviors** N/A — even a footer link usually has a hover state).

```markdown
# <ComponentName> Specification

## Overview
- **Target file:** `src/components/<ComponentName>.tsx`
- **Screenshot:** `clones/<slug>/screenshots/<screenshot-name>.png`
- **Interaction model:** <static | click-driven | scroll-driven | time-driven>

## DOM Structure
<Element hierarchy — what contains what.>

## Computed Styles (exact values from getComputedStyle)
### Container
- display: ...
- padding: ...
- maxWidth: ...
### <Child element 1>
- fontSize: ...
- color: ...
### <Child element N>
...

## States & Behaviors
### <Behavior name, e.g. "Scroll-triggered floating mode">
- **Trigger:** <scroll position 50px | IntersectionObserver rootMargin "-30% 0px" | click .tab | hover>
- **State A (before):** maxWidth: 100vw, boxShadow: none, borderRadius: 0
- **State B (after):** maxWidth: 1200px, boxShadow: 0 4px 20px rgba(0,0,0,0.1), borderRadius: 16px
- **Transition:** all 0.3s ease
- **Implementation approach:** <CSS transition + scroll listener | IntersectionObserver | animation-timeline>
### Hover states
- **<Element>:** <property>: <before> → <after>, transition: <value>

## Per-State Content (if applicable)
### State: "Featured"
- Title / Subtitle / Cards: [{ title, description, image, link }, ...]
### State: "Productivity"
- ...

## Assets
- Background image: `public/images/<file>.webp`
- Overlay image: `public/images/<file>.png`
- Icons used: <ArrowIcon>, <SearchIcon> from icons.tsx

## Text Content (verbatim)
<All text, copy-pasted from the live site — not paraphrased.>

## Responsive Behavior
- **Desktop (1440px):** <layout>
- **Tablet (768px):** <what changes>
- **Mobile (390px):** <what changes>
- **Breakpoint:** layout switches at ~<N>px
```

## The ~150-line complexity budget

**If a builder prompt exceeds ~150 lines of spec content, the section is too complex for one
agent — split it.** This is a *mechanical* check. Do not override it with "but it's all
related."

| Section shape | Dispatch |
|---------------|----------|
| Simple (1–2 sub-components: banner + button) | One builder for the whole section. |
| Complex (3+ distinct sub-components: card variants with unique hover/layout) | One builder per sub-component **plus** one for the wrapper that imports them. Build sub-components first; the wrapper depends on them. |

A "distinct sub-component" has its own styling, structure, and behavior. When in doubt, make it
smaller — smaller tasks come back correct.

## Step 3 — Dispatch builders in worktrees

Dispatch **one builder subagent per component, each in its own isolated git worktree** so
parallel builders cannot touch each other's files or diverge on shared state. Every builder
prompt must contain, inline:

1. **The FULL spec text** — paste the whole `.spec.md`. **Never** say "go read the spec file" or
   "see DESIGN_TOKENS.md for colors." A builder that has to open external docs will guess to fill
   gaps. Self-contained prompt or nothing.
2. **Screenshot path** — `clones/<slug>/screenshots/<name>.png`.
3. **Shared imports to use** — `icons.tsx`, `cn()` from `src/lib/utils.ts`, shadcn primitives,
   the locked design tokens. (These already exist because the foundation gate passed.)
4. **Target file path** — e.g. `src/components/HeroSection.tsx`.
5. **Breakpoints** — the exact values (1440 / 768 / 390) and what changes at each.
6. **The green gate** — "run `npx tsc --noEmit` and fix all errors before finishing."

Then **do not wait**. Move to Step 1 for the next section.

## Step 4 — Merge + always-green gates

As each builder completes:

1. Merge its worktree branch into the working branch. You are the orchestrator with full context
   on what each agent built, so resolve conflicts intelligently rather than blindly.
2. Run `npx tsc --noEmit` then **`npm run build`**. Both must pass.
3. If the merge introduces type or build errors, fix them **immediately** — a broken build is
   never acceptable, even temporarily. Do not stack another merge on a red tree.

The extract → spec → dispatch → merge cycle repeats until every section in the topology is built
and merged. Page assembly and objective verification follow (see [verification](verification.md)).

## Parallelism caveat (hard-won)

Fan-out is a force multiplier **only** under strict conditions. Respect them or it becomes a
cost-and-chaos multiplier:

- **Fully specified.** Parallelism helps when each task is self-contained and unambiguous — which
  is exactly why the spec must be complete and inlined. A vague brief run in parallel just
  produces many wrong components at once.
- **State-isolated.** Each builder gets its own worktree and its own component file. Shared
  mutable state across concurrent agents causes clobbers and non-deterministic merges.
- **No cross-agent handoffs.** Do not chain builders (agent A's output feeds agent B mid-flight).
  Handoffs serialize the work anyway and multiply the ways it can break. Sequence dependencies
  yourself at merge time instead.
- **Don't fan out 40+ agents.** Large fan-outs blow up token/compute cost and orchestration
  overhead far faster than they save wall-clock time. Match agent count to genuinely independent
  sections; a page is usually a handful of sections, not dozens.

## Pre-dispatch checklist

Before dispatching **any** builder, confirm every box. If you can't, go extract more.

- [ ] Spec written to `clones/<slug>/specs/<name>.spec.md`, every section filled.
- [ ] Every CSS value is from `getComputedStyle()` — not estimated; meaningful zero/defaults kept.
- [ ] Original class names recorded.
- [ ] Interaction model identified and documented (static / click / scroll / time).
- [ ] For stateful components: every state's content and styles captured (A→B diffs).
- [ ] For scroll-driven components: trigger threshold, before/after styles, transition recorded.
- [ ] For hover states: before/after values and transition timing recorded.
- [ ] All images identified, including overlays and layered compositions.
- [ ] Responsive behavior documented for desktop and mobile at minimum.
- [ ] Text content is verbatim.
- [ ] Screenshot path, shared imports, and target file path ready to inline.
- [ ] Spec is under ~150 lines — if over, the section is split.
