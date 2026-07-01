**English** · [中文](README.md)

# Ditto — the mode-routing website cloner

> *ditto (n.): the same again — an exact copy.*

**Ditto** is an open-source [Claude Code](https://claude.com/claude-code) agent skill (portable
to 9+ other agents) that reverse-engineers and clones websites. It fuses two proven approaches
into one:

- the **"real source first"** rigor of a methodology skill — recover true source, grade every
  implementation claim `SOURCE`/`PARTIAL`/`GUESS`, and verify with objective pixel + SSIM diffs;
- the **foreman orchestration** of a project template — a clean Next.js / React / Tailwind /
  shadcn rebuild target, parallel builder subagents in git worktrees, and always-green builds.

Neither half alone chooses correctly between *"mirror it exactly"* and *"rebuild it clean."*
Ditto makes **mode selection the first-class decision.**

## The five modes

Ditto's headline feature is a decision tree that routes each site to the right strategy instead
of forcing every site through one:

| Mode | For | What it does |
|------|-----|--------------|
| **M1 · Static Mirror** | static / static-built sites, or when true source is recovered | byte-for-byte mirror + strip trackers |
| **M2 · Framework Rebuild** | content sites (React/Vue/Next) | rebuild into the Next.js scaffold |
| **M3 · API-Fixture Rebuild** | SPA / SaaS / data-driven | capture API fixtures + mock server |
| **M4 · Effect Reverse-Engineer** | WebGL / Canvas / Three.js heavy | line-by-line from source, or runtime GL capture |
| **M5 · Design-DNA Reskin** | "keep the look, swap the content" | extract design tokens, reskin |

## How it works (the pipeline)

1. **Triage & scaffold** — normalize URLs, confirm a browser backend, create a per-clone workspace.
2. **Recon** — screenshots at 1440/768/390, framework fingerprints, fonts, full dynamic-layer
   inventory (video / canvas / background images / layered overlays), interaction sweep.
3. **Recover source** — GitHub search, sourcemap recovery, deploy-slug tricks, static mirror.
4. **Grade & route** — complexity L1–L6 → pick exactly one of the five modes.
5. **Build** — foundation-first tokens/assets, then parallel spec-and-dispatch builders (rebuild
   modes) or full-scroll mirror / evidence-graded effect reverse-engineering (faithful modes).
6. **Verify (loop)** — pixel + SSIM diff, structural compare, residue audit — iterate until it
   crosses threshold, with honest reporting.
7. **Make it yours** — strip trackers, swap text/media/brand, check the license.

## Install

```bash
# Clone into your Claude Code skills directory (or use a skills installer):
git clone https://github.com/Onevium/ditto ~/.claude/skills/clone-website

# Install script dependencies (for the automation kit):
cd ~/.claude/skills/clone-website
npm install && npx playwright install chromium
```

Then just ask Claude Code: **"clone https://example.com"**.

## Ethics & licensing

Ditto is for **learning and transformative work**. It is not for phishing, impersonation, or
passing off someone else's site as your own. It strips logos, trademarks, and copyrighted
content, replaces them with your own, respects `robots.txt`/ToS, and never bypasses logins or
paywalls. Layout and color aren't copyrightable, but a recognizable brand's combined "look and
feel" can be protected as **trade dress** — so always make it *yours*. See
[`references/licensing.md`](references/licensing.md).

## Project layout

- [`SKILL.md`](SKILL.md) — the skill itself: the decision tree.
- [`references/`](references/) — one methodology doc per step, loaded on demand.
- `scripts/` — deterministic Node/Playwright automation (recon, mirror, diff, audit, sync, …).
- `dist/` — per-platform command files generated from `SKILL.md` by `scripts/sync-skills.mjs`.

## Status

Working. `SKILL.md` + 13 reference docs describe the full methodology; the 16 `scripts/` are
implemented (recon with dynamic-layer inventory, computed-style extraction, asset harvest,
pixel + SSIM visual diff, residue audit, multi-platform sync). Contributions welcome.

## License

MIT — see [`LICENSE`](LICENSE).
