# M4 · Effect Reverse-Engineering

The hard branch. You reach here from [Step 3](assessment.md) when recon graded the target
**L5–L6** — WebGL / WebGPU / Canvas / Three.js heavy, procedural shaders, physics, custom
interaction. This doc is about **not fooling yourself** while you reverse an effect, and about
what to do when there is no source to read.

Two halves, used together:
- *How to read the render architecture* — decompose into pillars, tell mechanisms apart with
  `grep`. (Also see the mechanism-discrimination cheatsheet below.)
- *How to stay honest* — evidence grading, the no-compensation rule, and the baseline-first gate.

The **Iron Rule (real source first)** applies with full force here: assume every AI-written
shader / draw-call snippet is hallucinated until verified against real source or captured runtime
truth. The canonical failure is the [marbles case](marbles-case.md) — read it before you start.

## Contents

- [Community reality check](#community-reality-check-the-accuracy-cliff)
- [Step 0 — decompose into technical pillars](#step-0--decompose-into-technical-pillars)
- [Mechanism discrimination (grep, don't guess)](#mechanism-discrimination-grep-dont-guess)
- [Evidence grading: SOURCE / PARTIAL / GUESS](#evidence-grading-source--partial--guess)
- [The no-compensation rule](#the-no-compensation-rule)
- [The baseline-first replay gate](#the-baseline-first-replay-gate)
- [No source? Runtime capture with gl-capture.mjs](#no-source-runtime-capture-with-gl-capturemjs)
- [Portable advanced patterns worth banking](#portable-advanced-patterns-worth-banking)
- [Verify honestly](#verify-honestly)
- [Artifacts this mode produces](#artifacts-this-mode-produces)

## Community reality check: the accuracy cliff

Static layout/CSS clones plateau around 95%+. **Animation and 3D are an accuracy cliff — fidelity
drops to ~70–85%** and no amount of prompting closes it automatically. Treat GSAP / Framer Motion /
Lenis / Three.js / shader sections as **manual-refinement zones**: flag them explicitly in
`NOTES.md`, give the human an honest expected-match range, and **do not pretend to auto-clone
them**. It is better to ship a labeled RAW REPLAY of the real effect (see the gate below) than a
polished-looking approximation that got the mechanism wrong.

## Step 0 — decompose into technical pillars

Before writing anything, split the effect into independent pillars and reason about each
separately. They usually decouple cleanly, which lets you verify them one at a time.

| Pillar | What it is | How to find it |
|---|---|---|
| **Render** | draw calls, shaders, materials, the fragment math | count `<canvas>`; `grep` shader scripts; dump `THREE`/program objects |
| **Compositing** | how GPU output reaches the screen — direct, `toDataURL`→`<feImage>`, `feDisplacementMap`, blend/mask chains | read SVG `<filter>` defs; check whether the canvas is even visible |
| **Physics** | motion, collision, gravity — usually a decoupled pure-JS module | `grep` for integration/collision math; read as plain JS |
| **Interaction** | scroll-driven vs click vs hover vs drag vs time-driven | confirm from `interaction-probe.mjs`, never from intuition |
| **Audio** | files vs Web Audio procedural synthesis | look for `AudioContext`, oscillators, no asset files |

Two decompositions that repeatedly trip up second-hand analyses:

1. **The GPU↔DOM bridge.** If the WebGL canvas is *not* shown directly but is fed through
   `toDataURL` / `<feImage>` / `feDisplacementMap`, the GPU is producing a **data image**
   (displacement / normal / depth) that another layer consumes. This is the most advanced and the
   most commonly mis-reported layer. Getting it backwards discards the whole idea (see marbles).
2. **Physics/audio are separable.** They rarely touch the renderer; verify them on their own.

## Mechanism discrimination (grep, don't guess)

The single most expensive shader mistake is assuming the wrong core mechanism. Do not eyeball it —
`grep` the shader source and let the tokens decide:

| You see… | Mechanism | Note |
|---|---|---|
| `texture2D` / `sampler2D` / `texture(` | **texture / framebuffer sampling** | reading an image or FBO |
| a `for` loop with `+= dS`, `map(`, `MAX_STEPS`, raymarch step accumulation | **ray-marching (SDF)** | expensive; genuinely needed only for arbitrary/implicit shapes |
| `b*b - 4*a*c`, a discriminant, `sqrt(` in a quadratic | **analytic intersection (closed-form)** | spheres/planes have exact solutions — fast and precise |

⚠️ Do **not** assume a refractive-glass demo is ray-marching. Spheres have a closed-form solution,
and many demos use analytic intersection — the marbles analysis invented `MAX_STEPS=100` +
SDF + 6-tap normals when the real code was one quadratic and `normalize(rp - center)`.

## Evidence grading: SOURCE / PARTIAL / GUESS

Tag **every** fact about the pipeline with a grade. **Untagged = GUESS.** Compute at the lowest
grade present in a chain.

| Grade | Meaning | Examples |
|---|---|---|
| `SOURCE` | Direct, target-bound hard evidence | public source line, source-map-recovered module, runtime object dump, captured shader/WGSL text, a frame capture, a hashed network response body |
| `PARTIAL` | A handle for the next probe — not yet conclusive | class/function/field names, a minified bundle slice, framework objects, a shader you have but whose uniforms / passes / input state you don't |
| `GUESS` | A reconstructed value with no direct evidence | visual fitting, naming inference, applied defaults, a hand-tuned magic number, any "looks right" behavior |

**The rule that matters: you may not copy a `GUESS`.** Every GUESS-grade implementation fact must
be upgraded to `SOURCE` (by reading source or by runtime capture) before it goes into the clone.
This is the marbles lesson made into a standing procedure — and it is the same discipline as the
TEARDOWN "second-hand analysis check" that exists specifically to catch a GUESS wearing a
SOURCE costume.

## The no-compensation rule

> **Never** tweak brightness, speed, position, coordinates, or noise values to make the picture
> "look right" if that is masking a real error in timing, color, FBO setup, resource, coordinate
> system, or state model.

- A fitted constant that makes the output look closer **is still a GUESS.** Record it as such, and
  write down exactly what evidence would upgrade it.
- **Wiring facts** — pass order, coordinate transforms, time units, input coupling — do **not**
  become correct just because the frame looks similar. Chase each to independent evidence.
- Same spirit as the skill's verification honesty: record what you can't verify, and never fake a
  "drag succeeded."

Compensation is dangerous because it *hides* the exact information the baseline gate is trying to
surface. If two wrongs (e.g. a Y-flip plus a sign flip) cancel visually, you'll ship a fragile
effect that breaks the moment content changes.

## The baseline-first replay gate

The most common failure in effect reversing is extracting, rewriting, and beautifying all at once —
ending up with something that neither matches the original nor tells you which step is wrong.
Split it into gated phases:

```
locate render surface → capture minimal truth → RAW REPLAY (as-is, minimal) → ✅ BASELINE frame-by-frame check
                                                                                  ↓ only after it passes
                                                                            PROJECTIZE (clean, editable) → PACKAGE
```

- **RAW REPLAY** — a minimal, as-close-to-original-as-possible runnable reproduction built from the
  **real** draw calls / shaders / uniforms / vertex data. No optimizing, no reframing, no parameter
  changes. Match the original's coordinate system, time units, and blend state exactly.
- **BASELINE gate** — the RAW REPLAY must match the original **frame by frame** (or by multi-frame
  sampling) before anything else. **You do not projectize until this gate passes.** This is where a
  wrong mechanism or a compensated bug reveals itself.
- **PROJECTIZE** — only after the gate: rewrite into a maintainable form (raw WebGL / Three.js TSL /
  Babylon / your target stack), still grading every fact.
- Close out with an honest state tag: `DONE_BASELINE_VERIFIED` (reproduced and verified) /
  `DONE_PROJECTIZED` (engineered into the project) / `DONE_BASELINE_WITH_GAPS` (reproduced with
  documented gaps).

Keep the baseline reproduction in `clones/<slug>/RECON/baseline/` alongside the original
screenshots — it is your hard evidence that the effect was actually verified, not vibed.

## No source? Runtime capture with gl-capture.mjs

The skill's first move is always [source recovery](source-recovery.md) — GitHub, then
source-maps. But effect sites are frequently **source-less and fully minified**. When that happens,
do **not** fall back to "write what it looks like" (that is a GUESS). Go to the render boundary and
**capture the runtime truth** instead.

Run `scripts/gl-capture.mjs`. It injects a spector.js-style hook **before page scripts run** and
patches the graphics API to record what the site actually does:

- Patches `WebGLRenderingContext` / `WebGL2RenderingContext` (and WebGPU where present) prototypes
  to log **actual draw calls**, bound programs, blend/depth state, and FBO/texture dimensions.
- Uses `getShaderSource` (and program introspection) to pull the **compiled shader source** and the
  **uniform values** as they are set.

It writes a capture bundle — expect roughly:

| Artifact | Contents | Read it for |
|---|---|---|
| `capture.json` | ordered draw-call log, program bindings, uniform names+values, GL state, FBO/texture sizes | pass order, wiring, resolutions |
| `shaders/*.glsl` | captured vertex/fragment (or WGSL) source per program | the real fragment math — feed the mechanism table above |
| `frames/*.png` | sampled frames of the live effect | the BASELINE comparison target |

**Captured runtime truth counts as `SOURCE`.** It becomes the new "real source" you feed into the
baseline-first flow above — build the RAW REPLAY from `capture.json` + `shaders/`, gate it against
`frames/`.

## Portable advanced patterns worth banking

Recognizing these tells you when a mechanism is deliberate (bank it) vs. when a magic number will
need re-deriving if you change shapes/materials:

- **Displacement-map refraction of the DOM.** An offscreen WebGL pass encodes RG=displacement,
  B=aux into a PNG; SVG `<feDisplacementMap scale=N>` uses it to warp the **live, interactive
  HTML**. The GPU-side and SVG-side `scale` must be aligned. This refracts *the real DOM* —
  something `MeshPhysicalMaterial(transmission)` cannot do (it only makes a glass-ball look).
- **One shader + a `mode` uniform** for refraction/reflection/shadow/foreground — branch on
  `u_mode` to save code and compile time.
- **Downscale aux buffers + skip static frames** — displacement/reflection/shadow maps are
  perceptually low-res-tolerant (½, ¼); when nothing moves, stop rendering (`settleFrames`).
- **Full-screen triangle instead of a quad** — 3 verts `[-1,-1, 3,-1, -1,3]` cover the screen.
- **Site-specific math must be re-derived when you change shape/material.** An analytic sphere
  intersection doesn't transfer to another shape (that's when you'd *actually* need SDF/ray-march);
  refraction index, Fresnel exponent, and absorption are hand-tuned and must be re-tuned per
  material. Grade these `GUESS` until re-derived.

## Verify honestly

Follow the standard [verification](verification.md) gate, plus effect-specific care:

1. Serve locally; require **zero** console / JS / **WebGL shader-compile** errors.
2. Scroll/interact to trigger scroll- or time-driven GL frames, then pixel/SSIM diff against the
   original frames.
3. **Record what can't be verified.** A synthetic `PointerEvent` has `isTrusted=false` and cannot
   fire a real native drag/hit-test — write that in `NOTES.md`, never fake "drag succeeded." For
   physics sites, "two loads produce different initial states" is fair indirect proof the engine is
   actually running.

## Artifacts this mode produces

- `clones/<slug>/RECON/baseline/` — the RAW REPLAY + captured `frames/` = proof of verification.
- `clones/<slug>/RECON/capture.json` + `shaders/` — from `gl-capture.mjs` when no source exists.
- `TEARDOWN` / `NOTES.md` — each render-pipeline fact grade-tagged `SOURCE`/`PARTIAL`/`GUESS`, the
  chosen close-out state, and the flagged manual-refinement zones with an honest match range.

→ Back to the [decision tree](../SKILL.md) · sibling docs: [assessment](assessment.md) ·
[source-recovery](source-recovery.md) · [marbles-case](marbles-case.md) ·
[verification](verification.md)
