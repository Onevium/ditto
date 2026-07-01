# Guiding Principles & What NOT to Do

Hard-won operating doctrine for faithful clones, synthesized from established open-source
website-cloning practice and fused with the [marbles](marbles-case.md) real-source discipline.
**Read this before building — most lifeless-clone failures are a principle ignored here, not a
CSS bug.**

## Guiding principles

1. **Completeness beats speed.** Every builder must receive *everything*: screenshot, exact CSS
   values, downloaded assets with local paths, verbatim text, component structure. **If a builder
   has to guess a color / size / padding, extraction failed.** Extract one more property rather
   than shipping an incomplete brief.

2. **Small tasks, perfect results.** "Build the whole features section" → approximated spacing and
   guessed sizes. One focused component with exact values → nailed. Keep each spec under ~150
   lines; if it's over, split the section. Mechanical check — don't override with "but it's all
   related."

3. **Real content, real assets — and assets are LAYERED.** This is a clone, not a mockup. Download
   every `<img>`, **`<video>`**, and inline `<svg>`; use real `textContent`. A block that *looks*
   like one image is often several layers: a background watercolor/gradient + a foreground UI PNG +
   an overlay icon. **Missing an overlay makes the clone look empty even when the background is
   right.** Enumerate every `<img>`, `background-image`, `<video>`, and `<canvas>` in each
   container (recon.mjs now does this; verify its output).

4. **Foundation first.** Global tokens (colors/fonts/spacing), content types, and global assets are
   sequential and non-negotiable. Everything after can be parallel.

5. **Extract how it LOOKS *and* how it BEHAVES.** A site is a living thing, not a screenshot. For
   each element capture appearance (`getComputedStyle` exact values) **and** behavior — what
   changes, the exact trigger, before/after states, and the transition. Watch for: navbar
   shrink/shadow on scroll; fade-up / slide-in on viewport entry; `scroll-snap`; parallax;
   animated hover states; enter/exit animations; scroll progress/opacity; autoplay carousels;
   theme transitions between sections; tab/pill cycling; scroll-driven tab switching
   (IntersectionObserver, not clicks); smooth-scroll libs (Lenis/Locomotive). Illustrative, not
   exhaustive — catch whatever else the page does.

6. **Identify the interaction model BEFORE building.** The single most expensive mistake is
   building click-based when the original is scroll-driven (or vice versa). **Scroll first, don't
   click first:** scroll slowly and see what changes on its own → scroll-driven; only if nothing
   changes, test click/hover. Document it explicitly per section.

7. **Extract every state, not just the default.** Tabs show different cards per tab; a header
   differs at scroll 0 vs 100; cards have hover states. Trigger each state and capture both.

8. **The spec file is the source of truth.** Every component gets a spec before any builder is
   dispatched; the builder receives it **inline** (never "go read the doc"). No spec = the builder
   guesses from memory.

9. **The build must always compile.** Every builder verifies `npx tsc --noEmit`; after each merge,
   `npm run build` stays green.

## What NOT to do (each cost hours of rework — ours included)

- **Don't build HTML mockups for content that's actually a `<video>`, Lottie, or `<canvas>`.**
  Check the DOM for those *before* building an elaborate fake of what the media shows. *(This is
  the classic failure that produces a dead hero — a flat gradient where a looping video +
  cursor-reactive canvas belonged.)*
- **Don't miss overlay / layered images.** Background + foreground UI + icon = 3 assets, not 1.
- **Don't skip asset extraction.** Without real images/videos/fonts the clone always looks fake,
  no matter how perfect the CSS. Placeholders are for Substitute mode only.
- **Don't build click-tabs when the original is scroll-driven** (or vice versa). Determine the
  interaction model first.
- **Don't extract only the default state.** Capture every tab/scroll/hover state.
- **Don't approximate CSS classes.** "Looks like `text-lg`" is wrong if the computed value differs.
  Use exact `getComputedStyle` values.
- **Don't reference external docs from a builder prompt.** Inline the spec.
- **Don't skip responsive extraction.** Inspect at 1440 / 768 / 390.
- **Don't forget smooth-scroll libraries** (Lenis etc.) — native scrolling feels different and
  users notice immediately.
- **Don't fake a `SOURCE` claim.** An un-extractable effect is a `PARTIAL` re-creation, documented
  honestly — never tuned to fake a diff pass ([marbles](marbles-case.md), no-compensation).
- **Don't declare done at the first build.** Loop: capture → diff → fix the biggest gap → repeat
  (see [deep-decomposition](deep-decomposition.md), [verification](verification.md)).

## A caution the field teaches: targets can be non-deterministic

Some sites A/B-test or gate the heavy hero (video/canvas) on session, capability, or
`prefers-reduced-motion` — so the "original" itself renders differently across visits. When your
capture disagrees with a past screenshot, re-capture and note the variance rather than assuming a
bug; harvest the rich version's assets when it *is* served.
