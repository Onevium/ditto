# Objective Verification

The final gate. A common clone loop ends in **subjective QA** — the agent eyeballs a screenshot,
declares "looks great," and ships. This doc replaces that with a **mandatory objective loop**:
serve the clone, re-run the exact same recon probes you ran on the original, diff them with
numbers, and audit for residue. You do not get to say "done" — the artifacts say it for you.

This is the **baseline-first gate applied to the whole clone**: the clone must reproduce measured
ground truth, not an agent's impression of it. It pairs with the [Iron Rule](../SKILL.md) (real
source first) and the **no-compensation rule** — you may not tune a number to make a score look
better.

## Contents

1. [The loop in one pass](#the-loop-in-one-pass)
2. [Step 0 — Serve + zero-error gate](#step-0--serve--zero-error-gate)
3. [Step 1 — Re-run recon with `--label clone`](#step-1--re-run-recon-with---label-clone)
4. [Step 2 — visual-diff (pixel + SSIM)](#step-2--visual-diff-pixel--ssim)
5. [Step 3 — compare-recon → CLONE_REPORT.md](#step-3--compare-recon--clone_reportmd)
6. [Step 4 — audit-clone → CLONE_AUDIT.md](#step-4--audit-clone--clone_auditmd)
7. [The honesty rule](#the-honesty-rule)
8. [Pass/fail bar](#passfail-bar)

## The loop in one pass

| Step | Script | Artifact | Reads |
|------|--------|----------|-------|
| 0 | serve locally + console read | live errors | zero-error gate |
| 1 | `recon.mjs` / `route-crawl.mjs` / `interaction-probe.mjs` `--label clone` | `clone-recon.json`, `clone-route-map.json`, `clone-interactions.json` | same probes as the original |
| 2 | `visual-diff.mjs` | `visual-diff-{1440,768,390}.json` + `.png` | pixel ratio + SSIM per viewport |
| 3 | `compare-recon.mjs` | `CLONE_REPORT.md` | structure / route / interaction / console deltas |
| 4 | `audit-clone.mjs` | `CLONE_AUDIT.md` | tracker / brand-residue / placeholder scan |

Everything lands in `clones/<slug>/RECON/`. Run it after every meaningful build increment, not
just at the end — a regression is cheapest to catch the moment it appears.

## Step 0 — Serve + zero-error gate

1. Serve the built clone locally (static: `python3 -m http.server`; framework: `npm run dev`/
   `npm run start`). All later probes hit `127.0.0.1`, never the live origin.
2. Open it in the browser backend and read the console. **The bar is ZERO** console errors, zero
   uncaught JS exceptions, zero WebGL errors/context-loss warnings.

A console error is not cosmetic — a 404 on a webfont, a missing `.wasm`, a null-ref in a scroll
handler all mean the clone is objectively broken even if the first paint looks right. Fix the
cause; **do not** silence it with a `try/catch` or by removing the feature (that is compensation).
Only advance past this gate when the count is 0.

## Step 1 — Re-run recon with `--label clone`

Point the **same probes you ran on the original** at the local clone, tagging output with
`--label clone` so nothing overwrites the baseline:

```
node scripts/recon.mjs --url http://127.0.0.1:PORT --label clone --out RECON/clone-recon.json
node scripts/route-crawl.mjs   --url http://127.0.0.1:PORT --label clone   # multi-page only
node scripts/interaction-probe.mjs --url http://127.0.0.1:PORT --label clone  # interactive only
```

Re-running the *identical* instrument on both sides is what makes the comparison objective: same
viewports (1440 / 768 / 390), same fingerprint checks, same scroll depth, same action script.
`recon.json` carries framework flags, element counts, `scrollHeight`, fonts, canvas dims and the
console log; the route map carries per-route URLs + screenshots; interactions carry per-action
`changed` signals and discovered canvas/interactive targets. See [recon](recon.md) for what each
probe emits.

## Step 2 — visual-diff (pixel + SSIM)

Run `scripts/visual-diff.mjs` once per viewport, feeding it the matching original/clone screenshots:

```
node scripts/visual-diff.mjs \
  --original RECON/screenshots/original-1440.png \
  --clone    RECON/screenshots/clone-1440.png \
  --out RECON/visual-diff-1440.json --diff RECON/screenshots/visual-diff-1440.png
```

It loads both PNGs onto a real browser canvas (padded to the larger dimensions, white
background) and emits JSON:

| Field | Meaning |
|-------|---------|
| `diffPixelRatio` | fraction of pixels whose per-channel delta exceeds `--threshold` (default 0.08) |
| `meanAbsDiff` | average normalized abs-difference across all channels |
| `rmse` | root-mean-square error — penalizes big misses more than many tiny ones |
| `ssim` | structural similarity, **0–1**, computed per viewport (the perceptual score) |
| `visualScore` | 1–5 bucket derived from the above |
| `diffPngDataUrl` → `--diff` PNG | changed pixels in **red**, unchanged pixels faded — a visual map of *where* you diverged |

**Why SSIM beats naive abs-diff.** Mean abs-diff / RMSE compare pixels **independently and
absolutely**, so they punish the wrong things:

- A whole page shifted 3px, or a hero re-rendered one shade darker, lights up abs-diff as a
  massive difference even though a human sees "identical."
- Conversely, abs-diff is blind to **structure**: swap a heading's letters for lorem ipsum of the
  same average color and the ratio barely moves.

SSIM instead compares **local luminance, contrast, and structure** over sliding windows — it
tracks whether the *patterns* match, tolerating global exposure/offset shifts while catching
structural corruption. Report both: `diffPixelRatio`/`rmse` catch hard pixel breakage and asset
misses; `ssim` catches perceptual/structural drift. Always keep the **diff PNG** — the red map
tells you which section to fix; a bare number does not.

Capture scroll-triggered and GL frames too: scroll the clone to the same offsets the original
uses before screenshotting, so animated/`M4` states are compared, not just the first paint.

## Step 3 — compare-recon → CLONE_REPORT.md

`scripts/compare-recon.mjs` fuses the two recon JSONs (plus optional visual-diff, route, and
interaction JSONs) into `CLONE_REPORT.md`:

```
node scripts/compare-recon.mjs \
  --original RECON/original-recon.json --clone RECON/clone-recon.json \
  --visual-diff RECON/visual-diff-1440.json \
  --original-routes RECON/routes/original-route-map.json --clone-routes RECON/routes-clone/clone-route-map.json \
  --original-interactions RECON/interactions/original-interactions.json \
  --clone-interactions RECON/interactions-clone/clone-interactions.json \
  --out clones/<slug>/CLONE_REPORT.md
```

The report is the auditable delta between original and clone:

- **Technical signals** — title, lang, frameworks, `scrollHeight`, `h1` side by side.
- **Count comparison** — sections / links / images / video / canvas / forms / buttons / inputs /
  interactive / scripts, each with a `ratioScore` (min/max ratio → 1–5). Big gaps expose a whole
  missing section or an over-built one.
- **Structure fidelity** — heading-sequence similarity between the two DOMs.
- **Route coverage** — matched / **missing** / **extra** routes and a coverage %. Missing routes =
  unbuilt pages; extra routes = scope creep.
- **Interaction coverage** — `changed` action counts and canvas/interactive target counts on each
  side. A mismatch means a state was dropped or over-implemented.
- **Console** — error and page-error counts, original vs clone (must be 0 on the clone side).

Some cells are intentionally left for a human (visual fidelity without `--visual-diff`, content
replacement, legal risk). **Do not auto-declare those green** — feed `--visual-diff` where you can
and record the rest honestly. Pour the numbers back into `NOTES.md` and the 8-axis score in
[assessment](assessment.md).

## Step 4 — audit-clone → CLONE_AUDIT.md

`scripts/audit-clone.mjs` walks the clone source (skipping `node_modules`, `.next`, `dist`,
`RECON`, screenshots, and the report files themselves) and greps every `.html/.css/.js(x)/.ts(x)/
.json/.md/.svg` for residue, writing `file:line` findings grouped by type into `CLONE_AUDIT.md`:

```
node scripts/audit-clone.mjs --project clones/<slug> --brand "OriginalBrand,ACME" --out clones/<slug>/CLONE_AUDIT.md
```

| Category | Catches |
|----------|---------|
| **tracking** | GTM (`GTM-…`), GA/`gtag(`/`ga(`, Meta Pixel/`fbq(`, Hotjar/Clarity |
| **brand** | every `--brand` term (original name/trademark) still in source |
| **residue** | leftover source-language script (e.g. non-English original copy) |
| **todo** | `TODO` / `FIXME` / `lorem ipsum` / placeholder copy |
| **external** | outbound `http(s)://` URLs still pointing at the origin or uncontrolled third parties (w3.org namespaces excluded) |

Every tracking or brand hit must be **0** before you claim deployable — trackers stripped line by
line, logos/trademarks/copy replaced with the user's own (see [licensing](licensing.md)). Placeholder
and external hits get triaged. A non-empty audit means "not done," full stop.

## The honesty rule

Some things **cannot** be objectively verified, and the loop's whole value collapses if you fake
them. The canonical case: a synthetic `PointerEvent`/`MouseEvent` fired from a probe has
**`isTrusted = false`**, so a native drag / drag-and-drop / pointer-lock effect will not truly
fire — the browser ignores untrusted gestures for those paths. `interaction-probe.mjs` can *dispatch*
the event and note DOM reactions, but it cannot prove the real native interaction works.

So:

- **Record what cannot be verified** in `NOTES.md` under "验证不了的点 / unverifiable" — verbatim,
  e.g. *"canvas drag physics: probe fires synthetic pointer (isTrusted=false), cannot confirm native
  drag inertia — needs manual check."*
- **Never** write "drag succeeded" / "verified" for something a synthetic event can't confirm.
- **Never** loosen a threshold, brighten a frame, or delete a failing check to turn a red number
  green — that is the no-compensation rule. A truthful "unverified" beats a fake "pass."

## Pass/fail bar

Ship-ready means **all** of:

- [ ] Local serve, **0** console / JS / WebGL errors (Step 0).
- [ ] Clone recon / routes / interactions re-run with `--label clone` against `127.0.0.1`.
- [ ] `visual-diff` run at 1440 / 768 / 390; `diffPixelRatio`, `ssim`, and diff PNG recorded per
      viewport.
- [ ] `CLONE_REPORT.md` generated; route coverage and interaction counts explained, console = 0.
- [ ] `CLONE_AUDIT.md` generated; tracking and brand hits = 0, remainder triaged.
- [ ] Unverifiable items listed honestly in `NOTES.md`.

Anything short of this is reported as a **known gap**, not hidden. The completion report quotes the
per-viewport visual-diff scores and the honest gap list — that is the objective replacement for
"looks great."
