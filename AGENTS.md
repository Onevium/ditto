# AGENTS.md — conventions for the rebuilt project

This file is the single source of truth for how a **rebuilt clone** (modes M2/M3) should be
structured. `scripts/sync-skills.mjs` fans it out to every supported agent platform, so edit it
here and nowhere else.

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript** (strict).
- **Tailwind CSS v4** · **shadcn/ui** for primitives.
- `next/font` for self-hosted fonts. No runtime webfont hotlinking.

## Structure

```
src/
  app/            # routes, layout.tsx, globals.css (design tokens live here)
  components/
    ui/           # shadcn primitives
    icons.tsx     # de-duplicated inline SVGs
    <section>/    # one folder per rebuilt page section
  lib/utils.ts    # cn() and helpers
  types/          # content interfaces (one per data shape)
public/
  images/ videos/ seo/
```

## Rules

- **Exact values, never guesses.** Every color, size, spacing, and font-weight comes from
  `computed-style.mjs` output — if a builder has to guess, extraction failed.
- **Design tokens first.** Colors as `oklch` CSS variables in `globals.css`; components reference
  the tokens, never hardcoded hex.
- **Content as data.** Text lives in typed `data`/`content` files, rendered with `.map()` — never
  hand-duplicated markup.
- **Real assets only.** Download originals via `asset-harvest.mjs`; never AI-redraw images.
- **Always green.** Every merged section must pass `npx tsc --noEmit` and `npm run build`.
- **Spec budget.** ~150 lines per section spec; split larger sections.
