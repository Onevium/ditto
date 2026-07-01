# M2 / M3 · Framework Rebuild

You picked a **rebuild** mode in [assessment](assessment.md) Step 3, so the goal is *the user's own*
clean Next.js/React codebase that reproduces the target — not a byte-for-byte mirror. This doc
covers the two rebuild modes and the one job that must happen before any parallel work: laying a
**shared foundation** so builder subagents can't diverge.

Read this alongside [spec-and-dispatch](spec-and-dispatch.md) (the per-section foreman loop that
runs *after* the foundation is green) and [verification](verification.md) (the objective gate at
the end).

## Contents

- [When each mode applies](#when-each-mode-applies)
- [The Iron Rule still holds](#the-iron-rule-still-holds)
- [Foundation first (lead only, sequential)](#foundation-first-lead-only-sequential)
- [The Next.js scaffold](#the-nextjs-scaffold)
- [M3 extra: capture the data layer](#m3-extra-capture-the-data-layer)
- [Gate: build must pass before fan-out](#gate-build-must-pass-before-fan-out)
- [Hand-off to the foreman loop](#hand-off-to-the-foreman-loop)

## When each mode applies

| Mode | Complexity | Signature | Data strategy |
|------|-----------|-----------|---------------|
| **M2 · Framework Rebuild** | L2–L3 | Content site — React/Vue/Next marketing, docs, blog. Content is largely baked into markup or a small JSON blob. | Pour real content straight into `src/types` + components. No live API needed. |
| **M3 · API-Fixture Rebuild** | L4–L5 | SPA / SaaS dashboard / data-driven app. Renders from XHR / `fetch` / GraphQL after load; `__NEXT_DATA__` is thin and the DOM fills in later. | Capture responses as **fixtures**, serve them from a local mock/JSON server, render off that. |

Both modes share the same foundation and the same [spec-and-dispatch](spec-and-dispatch.md) foreman
loop. **M3 is M2 plus a captured data layer** — do everything in M2, then add the network-capture
step below. If you're unsure which you have, the tell is simple: view-source and disable JS. If the
content is still there, it's M2; if the page goes blank, it's M3.

## The Iron Rule still holds

Real source first. A rebuild is *not* a license to reimagine implementation from an AI guess. Before
writing components:

- Prefer recovered source and sourcemaps from [source-recovery](source-recovery.md) — pouring real
  extracted content into your own scaffold is the fastest faithful path.
- Grade every non-trivial implementation claim `SOURCE` / `PARTIAL` / `GUESS`. Untagged means
  `GUESS`, and **you may not ship a `GUESS`**.
- **No-compensation rule:** never fudge a spacing/color/timing value to paper over an extraction you
  didn't actually make. If you didn't measure it with `getComputedStyle`, go measure it.

## Foundation first (lead only, sequential)

This is done by the **lead, by hand, in order, before dispatching a single builder.** It touches
many files and locks the shared vocabulary (tokens, types, icons, assets) so every parallel builder
resolves the same imports to the same values. Skipping it is how ten builders each invent their own
"almost-blue."

Work the six steps top to bottom. Each depends on the ones above it.

### 1. Fonts — `next/font`

Inspect `<link>` tags and computed `font-family` on headings, body, code, and labels (from
[recon](recon.md)). Wire every family/weight/style actually used into `src/app/layout.tsx` via
`next/font/google` or `next/font/local`. Self-host locked webfonts — hotlink-protected fonts 404
off-origin.

### 2. `globals.css` design tokens

Write the target's design system into `src/app/globals.css` as the single source of truth:

- **Colors as `oklch` CSS variables** in `:root` (and `.dark` if the site themes). Map to the
  scaffold's shadcn token names — `--background`, `--foreground`, `--primary`, `--muted`, `--border`
  — where they fit; add custom properties for the ones that don't.
- **Spacing scale** — recover the real step ladder (e.g. 4/8/12/16/24/32) rather than eyeballing
  per-element margins.
- **Keyframes** — any global `@keyframes` (fades, marquees, pulses) the page reuses.
- **Smooth-scroll config** — if recon flagged Lenis / Locomotive (`.lenis` class, custom scroll
  container), record it here and note the library to install. Native scroll *feels* different and
  the user will spot it instantly.

### 3. `src/types` content interfaces

Create TypeScript interfaces for every content structure you observed (nav item, card, testimonial,
pricing tier, etc.). This is the typed contract builders fill; it prevents drift between the section
that produces data and the one that consumes it. Strict mode, no `any`.

### 4. De-duplicate inline SVGs → `src/components/icons.tsx`

Enumerate every inline `<svg>` on the page, **de-duplicate** them (the same arrow often appears 20×),
and export each as one named React component (`ArrowRightIcon`, `SearchIcon`, `LogoIcon`) named by
visual function. One icon file, imported everywhere — never let a builder re-inline its own copy.

### 5. `scripts/asset-harvest.mjs` — download **real** assets

Run `scripts/asset-harvest.mjs` to pull the actual images, videos, and binaries into `public/`
(preserving meaningful directory structure). Never AI-redraw or approximate an asset — a clone with
fake art looks fake no matter how perfect the CSS is.

- It enumerates `<img>`/`<video>`/`background-image` and downloads **batched, 4 at a time**, with
  per-file error handling.
- **Layered compositions matter:** one visual is often a background + a foreground UI PNG + an
  overlay icon. Capture each `<img>` and background in a container, including absolutely-positioned
  overlays — a missing overlay makes the clone look empty even with the right background.
- Read the run's manifest to confirm every referenced asset resolved locally; chase down any 404s
  before builders reference paths that don't exist.

### 6. `npm run build` must pass — **then** fan out

See the [gate](#gate-build-must-pass-before-fan-out) below. Non-negotiable.

## The Next.js scaffold

Foundation work lands on top of `templates/nextjs-scaffold`, the pre-built base (see the scaffold's
`AGENTS.md` for the full house rules). Don't re-scaffold — extend it.

- **Stack:** Next.js (App Router, React 19, TypeScript **strict**), shadcn/ui (Radix + Tailwind
  CSS **v4**, `cn()` util), Tailwind v4 with **oklch** tokens, Lucide as the default icon set
  (supplemented/replaced by your extracted `icons.tsx`).
- **Layout the foundation touches:** `src/app/layout.tsx` (fonts, metadata), `src/app/globals.css`
  (tokens), `src/types/` (interfaces), `src/components/icons.tsx` (SVGs), `public/images` ·
  `public/videos` · `public/seo` (harvested assets, favicons, OG, webmanifest).
- **Commands:** `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`,
  `npm run check` (lint + typecheck + build).
- **Convention reminders from `AGENTS.md`:** named exports, PascalCase components, camelCase utils,
  Tailwind classes (no inline styles), 2-space indent, mobile-first responsive, no `any`. The
  scaffold notes this is **not** the Next.js in your training data — check
  `node_modules/next/dist/docs/` before using an API you're unsure of.

## M3 extra: capture the data layer

Do everything in the M2 foundation, then add this before any data-driven section is spec'd. An M3
app renders from network responses, so you need those responses on disk and a server to hand them
back.

### 1. Capture fixtures — `scripts/network-capture.mjs`

Run it against the live page to record every XHR / `fetch` / GraphQL exchange:

```
node scripts/network-capture.mjs --url <url> --out RECON/network --label original --wait 5000
```

It attaches request/response listeners in a real browser, loads the page, waits for network-idle,
and saves qualifying bodies as fixtures. What it produces:

| Artifact | What's in it |
|----------|--------------|
| `RECON/network/<label>-network.json` | Manifest: every request (`url`, `method`, `resourceType`, headers, `postData`) and every response (`status`, `contentType`, `fixture` path, `bytes`, `error`), plus `requestCount` / `responseCount` / `fixtureCount`. |
| `RECON/network/fixtures/*.json` · `*.txt` | The saved bodies. Filename = sanitized URL path + a 10-char URL hash, so identical endpoints are stable and collisions are avoided. |

Capture rules to know when reading the output:

- **Only `xhr` / `fetch` resource types are saved**, and only when `content-type` matches
  `json | text | graphql | javascript`. Images/CSS/fonts are logged in the manifest but not dumped
  as fixtures (those come from `asset-harvest.mjs`).
- Bodies over `--max-bytes` (default 1 MB) are **skipped** with `error: "body too large"` — bump
  `--max-bytes` if a real payload got dropped.
- Endpoints that only fire on interaction (pagination, tab switches, search) won't appear from a
  bare page load. Re-run with a longer `--wait`, or drive the interaction and capture again — check
  `fixtureCount` against the endpoints you actually saw in the network sweep.

### 2. Stand up a local mock / JSON server

Serve the captured fixtures so the rebuild renders from real data offline:

1. Read `<label>-network.json` to map each endpoint URL/method → its fixture file.
2. Copy the needed fixtures into the app (e.g. `src/mocks/` or `public/api/`) and back them with a
   small mock/JSON server (or Next Route Handlers / MSW) that replays the recorded body per route.
   GraphQL: key replies by operation name from the request `postData`.
3. Point the app's data layer at the local base URL, not the origin. **No real backend, auth, or
   payment flow** — this is a frontend replaying fixtures (see the skill's scope defaults).
4. Add TS interfaces for these payloads to `src/types` (step 3 of the foundation) so components are
   typed against the shape you actually captured.

## Gate: build must pass before fan-out

The **baseline-first gate** for rebuild modes. Before dispatching any builder subagent:

```
npm run build   # or: npm run check  (lint + typecheck + build)
```

It must pass **clean**. A green foundation means every builder starts from working fonts, tokens,
types, icons, assets — and, for M3, a live mock server. Fan out on a red build and you multiply one
broken import across every worktree at once. Don't proceed until it's green.

## Hand-off to the foreman loop

Foundation green → switch to the section-by-section **foreman loop** in
[spec-and-dispatch](spec-and-dispatch.md): run `scripts/computed-style.mjs` per section, write each
`specs/<name>.spec.md` under the ~150-line complexity budget, dispatch one builder subagent per
component in an isolated git worktree (full spec inlined, `npx tsc --noEmit` required), and merge
back keeping `npm run build` green the whole way.

When every section is merged, prove it objectively with [verification](verification.md) — zero
console errors, re-run recon against `127.0.0.1`, pixel + SSIM diff at 1440 / 768 / 390. M3 clones
verify against the **mock server**, and you record honestly which live-data behaviors can't be
reproduced from static fixtures.
