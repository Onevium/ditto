# Licensing, Ethics & Making It Yours

**The final gate. Decide what you may legally do with what you recovered, strip what must not
ship, and swap in the user's own identity — so the result is a transformative, for-learning
frontend draft, not a copy passed off as the original.**

This is the "Make It Yours + Licensing" step of the [SKILL](../SKILL.md) decision tree. It runs
**after** you have a working clone (any of **M1–M5**) and **before** anything goes public. The
Iron Rule ("real source first") got you accurate code; this doc governs whether you are allowed
to redeploy it, and how to make it lawfully yours.

## Contents

1. [The mental model: what's copyrightable, what isn't](#the-mental-model-whats-copyrightable-what-isnt)
2. [License decision table](#license-decision-table)
3. [How to check the license (gh api)](#how-to-check-the-license-gh-api)
4. [Strip trackers, line by line](#strip-trackers-line-by-line)
5. [Strip logos, trademarks & brand residue](#strip-logos-trademarks--brand-residue)
6. [Make-it-yours: the three-piece swap](#make-it-yours-the-three-piece-swap)
7. [Trade dress: the risk that survives a clean rewrite](#trade-dress-the-risk-that-survives-a-clean-rewrite)
8. [Hard nos: phishing, impersonation, login-bypass](#hard-nos-phishing-impersonation-login-bypass)
9. [Finalize NOTES.md](#finalize-notesmd)
10. [Pre-deploy checklist](#pre-deploy-checklist)

## The mental model: what's copyrightable, what isn't

You are not cloning one legal object; you are cloning several, and they have different rules.

| Element | Protected? | Consequence for the clone |
|---|---|---|
| **Code** (JS/CSS/HTML source, shaders) | Yes — copyright | Reuse only if the license permits; otherwise rewrite in your own words / rebuild (M2–M5). |
| **Text / copy** | Yes — copyright | Replace with the user's own text. Never ship verbatim marketing copy. |
| **Images / video / 3D models / fonts** | Yes — copyright (fonts often licensed separately) | Replace with harvested-then-owned or original media; check font EULA before self-hosting. |
| **Logos / brand names / product names** | Yes — trademark | Strip entirely. These are *never* yours to reuse. |
| **Layout / grid / spacing** | No — ideas & functional layout aren't copyrightable | Free to reproduce (this is what makes M2/M5 lawful). |
| **Color values / palette** | No — a color isn't copyrightable | Free to reproduce — but see [trade dress](#trade-dress-the-risk-that-survives-a-clean-rewrite). |
| **The *combined* look-and-feel** | Maybe — **trade dress** | The one that bites even when you copied *no* code. Divergence is the defense. |

The takeaway: **layout and color are fair game; code, text, images, and logos are not.** A clean
M2/M5 rebuild neutralizes the code-copyright question but does **not** neutralize trademark or
trade dress — those are handled by the three-piece swap below.

## License decision table

The license on the **recovered source repo** (see [source-recovery](source-recovery.md)) decides
what you may do with that source. Grade it before you reuse a single line.

| License found | What you may do | Where it applies |
|---|---|---|
| **MIT / Apache-2.0 / BSD / Unlicense / CC0** | Reuse, modify, redeploy — **keep the copyright/attribution notice** (and NOTICE for Apache). | Fastest, most faithful path. Record the notice in `NOTES.md`. |
| **NONE / no LICENSE file / unstated** | **Default = All Rights Reserved.** Local learning only. Do **not** redeploy publicly without written permission. | Most viral demos. This is the common case — treat silence as "no." |
| **GPL / AGPL / copyleft** | Reuse only if *your* project also adopts the copyleft terms (source disclosure). AGPL reaches network use. | Usually incompatible with a proprietary redeploy — rebuild instead. |
| **Proprietary / "all rights reserved" / explicit no-repro** | Read-only learning. No copying, no redeploy. | Rebuild from scratch (M2–M5) if you proceed at all, and mind trade dress. |

> **"Public on GitHub ≠ MIT."** Visibility is not a license. Absent an explicit permissive
> license, code defaults to **All Rights Reserved** even though anyone can read it. When in
> doubt, treat it as All Rights Reserved and keep the clone local.

When you **rebuilt** rather than copied (M2/M3/M5, or a `GUESS`-free rewrite under M4), the source
license no longer gates the *code* — but trademark, trade dress, and the media/text swap still
apply. Licensing gates **reuse of source**; the swap gates **everything else**.

## How to check the license (gh api)

Once source recovery has given you a `<user>/<repo>`:

```bash
# Authoritative: GitHub's detected license for the repo
gh api repos/<user>/<repo> --jq '.license.spdx_id // "NONE"'

# Cross-check the actual file (detection can miss non-standard headers)
gh api repos/<user>/<repo>/license --jq '.license.spdx_id' 2>/dev/null || echo "NO LICENSE FILE"
```

- `spdx_id` of `MIT`, `Apache-2.0`, `BSD-3-Clause`, `Unlicense`, `CC0-1.0` → permissive row.
- `spdx_id` of `NOASSERTION` or a 404 on `/license` → **treat as NONE / All Rights Reserved.**
- For a single-file site `curl`'d directly (no repo), there is no license signal at all → default
  to All Rights Reserved, local only.

Record the exact `spdx_id` (or "NONE") plus the required attribution string in `NOTES.md`. This is
also surfaced by `scripts/audit-clone.mjs` in the pre-deploy audit.

## Strip trackers, line by line

Analytics and pixels carry the original owner's IDs — shipping them pipes *your* clone's traffic
into *their* account (and leaks your users to third parties). Remove them **line by line**;
grepping first prevents a stray snippet from surviving.

```bash
# Find every tracker before deleting — run at the clone root
grep -rniE \
  "googletagmanager|gtag\(|G-[A-Z0-9]{6,}|UA-[0-9]{4,}-[0-9]|google-analytics|analytics\.js|\
fbq\(|facebook\.net/.*fbevents|connect\.facebook|hotjar|clarity\.ms|segment\.com|mixpanel|\
plausible|posthog|_hsq|hs-scripts|doubleclick|/collect\?" \
  --include=*.html --include=*.js --include=*.jsx --include=*.tsx --include=*.ts .
```

Then delete each hit and note the file:line in `NOTES.md`'s "what changed" section. Common
offenders: GA4 (`gtag('config','G-…')`), Universal Analytics (`UA-…`), GTM
(`googletagmanager.com/gtm.js`), Meta Pixel (`fbq('init',…)`), Hotjar/Clarity/Segment/Mixpanel/
PostHog, and bare `<img>`/`fetch` beacons hitting `/collect` or `doubleclick`. Re-run
`scripts/audit-clone.mjs` → `CLONE_AUDIT.md` afterward; a green tracker section is a deploy gate.

## Strip logos, trademarks & brand residue

Trademarks are never covered by any source license — strip them regardless of what the LICENSE
says. `scripts/audit-clone.mjs` scans for residue; also grep by hand:

- **Logos & brand marks** — SVG/PNG logos, favicons, OG images, app icons, wordmarks in
  `src/components/icons.tsx` and `public/`. Replace, don't ship.
- **Brand name in strings** — product name, company name, domain in copy, `alt`, `title`,
  `aria-label`, `<meta>`, manifest, page `<title>`, and structured data.
- **Outbound links & endpoints** — hrefs, API bases, CDN hosts still pointing at the original.
  A clone that phones home to the target's origin is both a leak and a tell.
- **Leftover locale text** — original-language copy the rebuild never translated (a frequent
  `CLONE_AUDIT.md` finding).

## Make-it-yours: the three-piece swap

This is what turns an accurate reconstruction into a **transformative** work that is lawfully the
user's. Swap three things; leave the craft (layout, spacing, motion, technique) intact.

| # | Piece | Where it lives | How to swap |
|---|---|---|---|
| 1 | **Text** | `index.html` · `data/*` · `content/*` · component copy · `types` content interfaces | Replace every headline, paragraph, label, and CTA with the user's own words. No verbatim original copy survives. |
| 2 | **Media** | `public/images` · `public/videos` · `public/seo` · 3D models · fonts | **Prefer harvested originals** the user has rights to, or new assets. Use `scripts/asset-harvest.mjs` to pull real files — never AI-redrawn approximations for structural assets, but do **not** reship the original's *branded* media. Check font EULAs before self-hosting. |
| 3 | **Brand colors** | CSS custom properties (`oklch` tokens in `globals.css`) · Tailwind theme · `design-dna.json` `design_system` | Re-point the palette to the user's brand. Colors aren't copyrightable, but changing them is your strongest, cheapest defense against a trade-dress claim. |

If a `design-dna.json` exists (from **M5 · Design-DNA Reskin** — see [design-dna](design-dna.md)),
land its `design_system` block as CSS custom properties; that file is the intended seam for
re-skinning identity while keeping the structural DNA.

> Keep the **technique**, change the **identity.** Same craft, different content = transformative.
> Same craft **and** same identity = a copy.

## Trade dress: the risk that survives a clean rewrite

Copyright covers the code; **trade dress** can cover the *overall commercial impression* — the
distinctive combination of layout, color, typography, imagery, and motion that makes users
recognize a brand. Two things make it dangerous here:

1. **It applies even if you copied zero code.** A pristine M2/M5 rebuild that still *looks like*
   the original brand can infringe. Neutralizing code-copyright does not neutralize this.
2. **The defense is divergence, not attribution.** You reduce risk by *diverging* — the
   three-piece swap (own text, own media, own palette) is precisely what pulls the "overall
   impression" away from the original. A credit line does not.

Practical rule: the more famous and distinctive the original's look, the more you must diverge
before anything goes public. For learning/local use, fidelity is fine (that's the point). For a
public deploy, **the swap is mandatory, not optional.**

## Hard nos: phishing, impersonation, login-bypass

These are out of scope for the skill under **all** circumstances — no license, no rebuild, and no
"just testing" makes them acceptable:

- **Phishing / credential harvesting** — a look-alike page that collects logins or payment info.
- **Impersonation / passing off** — presenting the clone as the original brand, or your work as
  theirs (or theirs as yours).
- **Login-bypass / paywall-bypass** — defeating auth, gating, or DRM.
- **Ignoring `robots.txt` / Terms of Service** — check both before scraping; some sites
  explicitly forbid reproduction. Honor the prohibition.

> **Cautionary tale — same.dev / Netcraft.** Automated "clone any site in one click" tools have
> been abused at scale to stand up pixel-accurate phishing pages; anti-phishing firms like
> Netcraft actively hunt and take these down. An AI cloner is a phishing engine pointed the wrong
> way. The line between "rebuild for learning" and "spin up a fake login" is exactly the
> three-piece swap and the hard-nos above — which is why they are a gate, not a suggestion.

Remember the scope from [SKILL](../SKILL.md): you produce a **frontend visual draft** — no
backend, no database, no real auth, no payment flow. A clone that grows a login form pointed at
real credentials has left the skill's scope entirely.

## Finalize NOTES.md

Close out the clone by making `NOTES.md` tell the honest, legally-legible story. Fill in:

- **Source** — original URL, recovered repo (if any), original author, and the verified
  **license** (`spdx_id` or "NONE") with any required attribution string.
- **Stack** — framework, key libraries, Node version, chosen mode (M1–M5) and complexity (L1–L6).
- **Replacement map** — for each of the three pieces, *what* was swapped and *where* (text →
  file:line, media → dir, colors → CSS variables / theme).
- **What changed vs original** — stripped trackers (with file:line), removed logos, replaced copy.
- **Known gaps & unverifiable parts** — carry over the honest list from
  [verification](verification.md); never claim fidelity you didn't measure.
- **Framing** — one line stating the work is **transformative and for learning**: a frontend
  visual draft, not a redeploy of the original, with identity swapped to the user's own.

## Pre-deploy checklist

Do not go public until every box is true (mirrors the SKILL pre-deploy gate):

- [ ] Source **license checked** via `gh api` and recorded in `NOTES.md` (permissive → attribution kept; NONE → **local only**).
- [ ] **Trackers stripped** — GA/gtag/GTM/pixels gone; `CLONE_AUDIT.md` tracker section clean.
- [ ] **Logos & trademarks removed**; brand name absent from copy, meta, alt/aria, title, manifest.
- [ ] **Text replaced** with the user's own — no verbatim original copy.
- [ ] **Media replaced** — no branded original assets; font EULAs respected.
- [ ] **Brand colors re-pointed** to the user's palette (trade-dress divergence).
- [ ] **Outbound links/endpoints** no longer target the original origin.
- [ ] Not phishing/impersonation/login-bypass; `robots.txt` and ToS honored.
- [ ] `NOTES.md` finalized with the transformative/for-learning framing and replacement map.
