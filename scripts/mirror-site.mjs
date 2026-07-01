#!/usr/bin/env node
/**
 * mirror-site.mjs — Full-scroll byte-for-byte static mirror (Mode M1).
 *
 * Mirrors the whole DEPLOYED asset set of a statically-built site (Astro / Vite SSG /
 * Hugo / Eleventy — even WebGL / Canvas / Gaussian-splat front-ends). For these sites the
 * real source is often not on GitHub, but the deployed assets ARE the ground truth: HTML +
 * bundled JS + CSS + the binaries the runtime fetches (.sog / .buf / .wasm / .riv / fonts /
 * images / video). A real browser is scrolled top-to-bottom to record EVERY request that
 * actually fires, then the same-origin subset is mirrored verbatim, path-for-path.
 *
 * Usage:
 *   node scripts/mirror-site.mjs <url> [--out ./clones/<slug>/RECON/mirror]
 *   node scripts/mirror-site.mjs --url <url> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000]
 *
 * Produces (all paths relative to cwd):
 *   <out>/site/...              Mirrored same-origin assets, original paths preserved
 *                               (directory URLs saved as index.html). Serve from here.
 *   <out>/own-asset-urls.txt    Sorted same-origin asset paths (grep for .buf/.sog/.wasm/.riv/fonts).
 *   <out>/third-party.json      Third-party hosts + webfont CSS (Typekit / Google) to self-host.
 *   <out>/mirror-manifest.json  Every request (same-origin + third-party) with status/type/content-type.
 *
 * Mode: M1. Discipline: only copies assets that were actually requested — never invents paths,
 * never rewrites third-party references (that is manual, per third-party.json). Full recipe:
 * references/static-mirror.md.
 */

import { loadPlaywright, launchChromium } from "./lib/browser.mjs";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const o = { url: "", out: "", scrollStep: 700, settle: 2500, maxMs: 90000, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--url") o.url = argv[++i] || "";
    else if (a === "--out") o.out = argv[++i] || "";
    else if (a === "--scroll-step") o.scrollStep = parseInt(argv[++i] || "700", 10);
    else if (a === "--settle") o.settle = parseInt(argv[++i] || "2500", 10);
    else if (a === "--max-ms") o.maxMs = parseInt(argv[++i] || "90000", 10);
    else if (a.startsWith("-")) { /* ignore unknown flag */ }
    else positional.push(a);
  }
  // First bare argument is the URL if --url was not given.
  if (!o.url && positional.length) o.url = positional[0];
  return o;
}

function usage() {
  console.log(`mirror-site.mjs — full-scroll byte-for-byte static mirror (Mode M1)

  node scripts/mirror-site.mjs <url> [--out ./clones/<slug>/RECON/mirror]
  node scripts/mirror-site.mjs --url <url> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000]

Applies to: Astro / Vite SSG / Hugo / any site whose client runtime is emitted as downloadable
static assets (incl. WebGL / Canvas / Gaussian-splat heavy front-ends).
Not for: true server-rendered / data-driven SPAs (use network-capture.mjs + a mock server, M3).

Keep --out relative to the current directory — never a home directory.
Recipe & manual finishing (self-host fonts / strip trackers / serve) -> references/static-mirror.md`);
}

// Derive a filesystem-safe slug from a URL host (+ first path segment if any).
function slugFromUrl(u) {
  try {
    const url = new URL(u);
    const host = url.host.replace(/^www\./, "");
    const seg = url.pathname.split("/").filter(Boolean)[0] || "";
    return [host, seg].filter(Boolean).join("-").replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  } catch {
    return "site";
  }
}

// Same-origin asset URL -> local relative path (drop query; directory URLs -> index.html).
function urlToLocalPath(u, origin) {
  let p = u.slice(origin.length);
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  if (p === "" || p.endsWith("/")) p += "index.html";
  return p.replace(/^\/+/, "");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { usage(); process.exit(0); }
if (!args.url) {
  console.error("error: no URL given.\n");
  usage();
  process.exit(1);
}

let origin;
try {
  origin = new URL(args.url).origin;
} catch {
  console.error(`error: invalid URL: ${args.url}`);
  process.exit(1);
}

// Default --out is inferred from the URL if not provided.
const outRoot = path.resolve(args.out || path.join("clones", slugFromUrl(args.url), "RECON", "mirror"));
const siteDir = path.join(outRoot, "site");
fs.mkdirSync(siteDir, { recursive: true });

const responses = new Map(); // url -> { status, type, ct }
const pw = loadPlaywright();
const browser = await launchChromium(pw.chromium);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("response", (resp) => {
  try {
    const h = resp.headers();
    responses.set(resp.url(), {
      status: resp.status(),
      type: resp.request().resourceType(),
      ct: h["content-type"] || "",
    });
  } catch {}
});

console.log(`> load + full-scroll capture: ${args.url}`);
await page
  .goto(args.url, { waitUntil: "networkidle", timeout: args.maxMs })
  .catch((e) => console.warn("  goto:", e.message));

// Scroll top-to-bottom so scroll-triggered runtime fetches (.buf/.sog/.wasm/.riv/fonts) fire.
const total = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
for (let y = 0; y <= total; y += args.scrollStep) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y).catch(() => {});
  await page.waitForTimeout(180);
}
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)).catch(() => {});
await page.waitForTimeout(args.settle);
await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
await page.waitForTimeout(1200);

const all = [...responses.entries()].map(([url, m]) => ({ url, ...m }));
const ownUrls = all.filter(
  (r) => r.url.startsWith(origin + "/") || r.url === origin || r.url === origin + "/"
);

console.log(`> captured ${all.length} requests; ${ownUrls.length} same-origin, downloading...`);
let ok = 0;
let fail = 0;
const failed = [];
for (const r of ownUrls) {
  const rel = urlToLocalPath(r.url, origin);
  const dest = path.join(siteDir, rel);
  try {
    // Re-fetch over the browser network stack so cookies / proxy / TUN match the page.
    const resp = await ctx.request.get(r.url);
    if (!resp.ok()) {
      fail++;
      failed.push(`HTTP${resp.status()} ${rel}`);
      continue;
    }
    const buf = await resp.body();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    ok++;
  } catch (e) {
    fail++;
    failed.push(`${e.message} ${rel}`);
  }
}

// Third-party hosts + webfont-CSS-to-self-host hints (Typekit / Google Fonts are domain-locked).
const thirdHosts = [
  ...new Set(
    all
      .filter((r) => !r.url.startsWith(origin))
      .map((r) => {
        try {
          return new URL(r.url).host;
        } catch {
          return r.url;
        }
      })
  ),
];
const webfontCss = all
  .map((r) => r.url)
  .filter((u) => /use\.typekit\.net\/[a-z0-9]+\.css|fonts\.googleapis\.com\/css/i.test(u));

fs.writeFileSync(path.join(outRoot, "mirror-manifest.json"), JSON.stringify(all, null, 2));
fs.writeFileSync(
  path.join(outRoot, "own-asset-urls.txt"),
  ownUrls.map((r) => urlToLocalPath(r.url, origin)).sort().join("\n") + "\n"
);
fs.writeFileSync(
  path.join(outRoot, "third-party.json"),
  JSON.stringify({ hosts: thirdHosts, webfont_css_to_selfhost: webfontCss }, null, 2)
);

console.log(`OK mirror done: ${ok} ok / ${fail} failed -> ${siteDir}`);
if (failed.length) console.log("  ! failed:\n   " + failed.slice(0, 20).join("\n   "));
console.log(`> third-party hosts: ${thirdHosts.join(", ") || "(none)"}`);
if (webfontCss.length)
  console.log(`> webfont CSS to self-host (domain-locked, see static-mirror.md):\n   ${webfontCss.join("\n   ")}`);
console.log(`> next: self-host fonts + rewrite CSS @import + strip trackers -> cd ${siteDir} && python3 -m http.server 8124`);

await browser.close();
