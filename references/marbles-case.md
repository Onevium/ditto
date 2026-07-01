# The Marbles Case

The canonical failure that grounds the **Iron Rule: real source first**. An AI "clone
analysis" of a glass-marbles site described a mechanism that was completely wrong — and
slower. If you had trusted its code blocks, you would have shipped a broken, mislabeled
effect. This doc dissects what really happened, teaches *why* AI implementation code is
untrustworthy, and gives you a concrete `grep`-based way to tell the mechanisms apart so you
never repeat the mistake.

Read this before any [M4 · Effect Reverse-Engineer](effect-extraction.md) work. It is the
"why" behind the SOURCE / PARTIAL / GUESS discipline used across the skill.

## Contents

- [The target](#the-target)
- [The real architecture (SOURCE)](#the-real-architecture-source)
- [What the AI analysis got wrong](#what-the-ai-analysis-got-wrong)
- [Why AI implementation code is untrustworthy](#why-ai-implementation-code-is-untrustworthy)
- [How to tell the mechanisms apart with grep](#how-to-tell-the-mechanisms-apart-with-grep)
- [The SOURCE / PARTIAL / GUESS discipline](#the-source--partial--guess-discipline)
- [Takeaways](#takeaways)

## The target

- Site: `https://chiuhans111.github.io/marbles/` · author Hans Chiu.
- **Single self-contained HTML file, ~1067 lines.** No build, no library — hand-written
  WebGL, physics, and audio.
- License: **NONE** → All Rights Reserved. Local learning only; do not ship a copy.
- Because it is one file, real source is one `curl` away. There was never any need to guess —
  which is exactly what makes the AI analysis such a clean cautionary tale.

## The real architecture (SOURCE)

One sentence: a full-screen WebGL fragment shader solves the optics **analytically**, encodes
the result into a **displacement-map PNG**, and an SVG `<filter>` uses that PNG via
**`feDisplacementMap`** to warp the *real, live, interactive DOM* behind it.

> The marble you drag is a lens. Behind the lens is this page's actual HTML (background
> blocks + heading text). WebGL never touches DOM pixels — the *refraction* is done by the SVG
> filter. Physics and audio are pure hand-written JS, zero libraries.

The three pillars, with the load-bearing details:

| Pillar | Real implementation |
|---|---|
| **WebGL optics** | **Analytic** ray–sphere intersection (quadratic `b*b - c`), not ray-marching. Normal is `normalize(rp - center)`. IOR `N = 1.3`, up to 4 refraction/reflection iterations. Fresnel `0.05 + 0.95*pow(1-cosθ, 2.0)` (exponent **2**, not Schlick's 5). Beer–Lambert volume absorption. **One shader reused** via `u_mode` (0 refract / 1 reflect / 2 foreground highlight / 3 shadow). Displacement encoded with `DISPLACEMENT_SCALE = 200`, aligned to the SVG side. |
| **SVG filter compositing** | 4 canvases (1 main + 3 offscreen); offscreen images `toDataURL` each frame into `<feImage>`. Real chain: shadow `feGaussianBlur(8)` → `feBlend multiply` onto DOM → refraction `feDisplacementMap` → reflection `feDisplacementMap` → `feGaussianBlur(2)` → Fresnel (reflection B channel) → `feColorMatrix` alpha mask → two-step `feComposite`. The refracted `SourceGraphic` is `#container`, which carries `filter:url(#marble-filter)`. |
| **Physics + audio** | Hand-written. `mass = r³`, gravity 0.8, 3D elastic collisions (restitution 0.8), quaternion rolling, drag lift `targetZ = 200`; `settleFrames` fully stops rendering when at rest. Audio is procedural Web Audio (no files): base `800 + (60-r)*20` Hz + 5 harmonics, volume scaled by collision speed. |

The transferable idea worth stealing: **displacement-map refraction of live DOM.** An
offscreen WebGL pass computes RG = pixel displacement, B = an auxiliary value (Fresnel); an SVG
`feDisplacementMap scale=N` warps the real HTML with it. The GPU-side and SVG-side `scale` must
match. This warps a *live, interactive* DOM — something `MeshPhysicalMaterial(transmission)` in
Three.js cannot do (it only makes a glass-ball *look*, not "refract the whole webpage").

## What the AI analysis got wrong

The AI's prose *skeleton* was roughly right — it identified 8 steps and pointed at the three
pillars. But **its attached "reconstruction code blocks" were almost entirely fabricated:**

| AI claim (GUESS) | Reality (SOURCE) | Failure pattern to remember |
|---|---|---|
| Ray-marching + SDF + `MAX_STEPS=100` + 6-tap finite-difference normals | Analytic intersection; normal = `normalize(rp - center)` | **Don't assume a refraction demo ray-marches.** A sphere has a closed-form solution; many demos use it — faster and exact. |
| `sampler2D uBackground`, sampling the DOM as a texture | Shader never reads the background; refraction is handed to SVG via a displacement map | **GPU↔DOM layering inverted.** The single most creative architectural idea was thrown away. |
| `feBlend screen` + one displacement + `feComposite over` for shadow | Double displacement + Fresnel mask + `multiply` shadow | **A second-hand filter chain is not trustworthy** — verify node by node against real source. |
| `MARBLE_COUNT = 5`, arrays sized 10 | Hard-coded **2** | Even the constants were guessed. |
| Screen-centered NDC coordinates | Top-left pixels with Y flip | The coordinate-system convention was pure invention. |

Net result: the AI proposed **ray-marching + SDF + sampling the DOM as a texture** where the
real site is **analytic ray–sphere intersection + `feDisplacementMap` refracting live DOM.**
Wrong mechanism, wrong data flow, wrong constants — and the proposed version is *slower*.

## Why AI implementation code is untrustworthy

An AI clone analysis is a *plausible* reconstruction, not an *observed* one. It pattern-matches
"glass sphere refraction demo" to the most common tutorial shape it has seen (ray-marching + SDF
+ texture sampling) and confidently emits code for that shape — even when the real site took a
different, smarter route. The prose can be directionally correct while every code block is
hallucinated, because the model is filling in *how such a thing is usually done*, not reading
*how this thing was actually done*.

So the rule is blunt: **treat every AI-written implementation code block as hallucinated until
verified against real source.** Use the analysis for a conceptual skeleton; never copy a line
of its code. This is the origin of the skill's Iron Rule.

## How to tell the mechanisms apart with grep

Once you have real source (single-file sites: `curl` the raw HTML; otherwise recover via
[source-recovery](source-recovery.md)), `grep` decides the mechanism in seconds. Don't reason
from intuition — read the tokens.

```sh
# 1. Texture / framebuffer sampling — is the shader reading an image?
grep -nE 'texture2D|texture\(|sampler2D' index.html

# 2. Ray-marching (stepped) — a march loop accumulating distance
grep -nE '\+= *dS|MAX_STEPS|for .*\bmap\(' index.html

# 3. Analytic intersection (closed-form, common for spheres/planes)
grep -nE 'b\*b|discriminant|sqrt\(|4\.?0?\*a\*c' index.html

# 4. The GPU→DOM bridge — WebGL feeding SVG instead of drawing pixels
grep -nE 'toDataURL|feImage|feDisplacementMap|feColorMatrix' index.html
```

Interpretation:

| Hit | Conclusion |
|---|---|
| `texture2D` / `sampler2D` | Shader samples a texture/framebuffer. If it samples the *background*, only then is "DOM as texture" plausible — verify what the sampler is bound to. |
| `+= dS` / `MAX_STEPS` / `map(` loop | Genuine ray-marching + SDF. |
| `b*b - 4ac` / `sqrt` / discriminant | Analytic ray–sphere/plane intersection — closed-form, no marching. |
| `feDisplacementMap` / `toDataURL` → `feImage` | WebGL is generating a **data image** (displacement / normal / depth) for another layer to consume. This is the high-end trick most often inverted by second-hand analysis — find this bridge before you believe any "GPU renders the final pixels" claim. |

In the marbles case: grep finds **no** `MAX_STEPS`, **no** background sampler, but a clear
discriminant and a `feDisplacementMap`. That single scan refutes the entire AI code block.

Note the two out of three "AI defaults" are the *loud* ones — ray-marching and texture
sampling. Their absence in the grep output is itself the tell.

## The SOURCE / PARTIAL / GUESS discipline

Grade every implementation claim before you act on it. Untagged means `GUESS`.

| Grade | Meaning | Rule |
|---|---|---|
| **SOURCE** | Read from real source: recovered file, sourcemap, or runtime capture (`gl-capture.mjs` counts as SOURCE). | You may copy it. Reach this before writing effect code. |
| **PARTIAL** | Partially confirmed — some tokens verified, gaps remain. | Confirm the gaps to SOURCE before relying on it. |
| **GUESS** | Inferred, assumed, or lifted from an AI analysis. | **You may not copy a GUESS.** Downgrade any AI code block here on sight. |

This ties into the wider [M4](effect-extraction.md) guardrails you must apply alongside grading:

- **No-compensation rule:** never tweak brightness / speed / coordinates to *mask* a
  mismatch. If the output is wrong, the mechanism is wrong — fix the mechanism.
- **Baseline-first gate:** build a minimal RAW REPLAY from the real draw calls / shaders /
  uniforms and pass a frame-by-frame check *before* projectizing.

## Takeaways

1. **Iron Rule: real source first.** For a single-file site, that is one `curl`. There is no
   excuse to guess.
2. **AI analysis = skeleton only.** Reference its structure; copy none of its code.
3. **Grep decides the mechanism.** `texture2D`/`sampler2D` vs `+= dS`/`MAX_STEPS` vs
   `b*b-4ac`/`sqrt` vs `feDisplacementMap` — read the tokens, not your intuition.
4. **Find the GPU↔DOM bridge before believing any pixel claim.** The most creative mechanism
   is the one most often inverted.
5. **Grade everything SOURCE / PARTIAL / GUESS.** Untagged is GUESS, and you may not copy a
   GUESS.

See also: [assessment](assessment.md) · [reverse-engineering](reverse-engineering.md) ·
[effect-extraction](effect-extraction.md) · [source-recovery](source-recovery.md).
