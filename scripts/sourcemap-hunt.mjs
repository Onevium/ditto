#!/usr/bin/env node
/**
 * sourcemap-hunt.mjs — Recover sourceMappingURL/.map bundles into SOURCE-grade files
 *
 * Usage:    node scripts/sourcemap-hunt.mjs <url> [--out DIR] [--all-external]
 *           node scripts/sourcemap-hunt.mjs --recon RECON/original-recon.json [--out DIR] [--all-external]
 * Produces: recovered source tree (<out>/sources/...) + <out>/sourcemap-manifest.json
 * Mode:     Step 2 (source recovery)
 *
 * For each discovered script this:
 *   1. Fetches the bundle and greps for `//# sourceMappingURL=<hint>`.
 *   2. Resolves the map URL — the hint relative to the script, or (no hint) appends `.map`
 *      to the script URL and tries anyway. data:/inline maps are noted and skipped.
 *   3. Downloads each reachable map.
 *   4. Un-webpacks the map's sources + sourcesContent into a browsable, SOURCE-grade tree.
 *
 * Same-origin scripts only unless --all-external. Uses fetch only (no browser).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function usage() {
  console.log(`Usage:
  node scripts/sourcemap-hunt.mjs <url> [--out DIR] [--all-external]
  node scripts/sourcemap-hunt.mjs --recon RECON/original-recon.json [--out DIR] [--all-external]

Finds sourceMappingURL hints in discovered JavaScript bundles, downloads any
reachable source maps, and un-webpacks them into original source files.

Options:
  --recon FILE     Read script URLs from a recon JSON (captures[].signals.scripts).
  --out DIR        Output directory (default: ./RECON/sourcemaps).
  --all-external   Also chase third-party/CDN bundles (default: same-origin only).
  -h, --help       Show this help.
`);
}

function parseArgs(argv) {
  const out = { url: "", recon: "", outDir: "", allExternal: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--recon") out.recon = argv[++i] || "";
    else if (arg === "--out") out.outDir = argv[++i] || "";
    else if (arg === "--all-external") out.allExternal = true;
    else if (arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    else if (!out.url) out.url = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

// Collect https?:// script URLs from a recon JSON (captures[].signals.scripts).
function collectScriptsFromRecon(recon) {
  const scripts = new Set();
  for (const capture of recon.captures || []) {
    for (const script of capture.signals?.scripts || []) {
      if (/^https?:\/\//i.test(script)) scripts.add(script);
    }
  }
  // Some recon shapes list scripts at the top level too.
  for (const script of recon.scripts || []) {
    if (/^https?:\/\//i.test(script)) scripts.add(script);
  }
  return Array.from(scripts);
}

// Collect script src URLs by fetching a live page and scraping <script src=...>.
async function collectScriptsFromPage(pageUrl) {
  const html = await fetchText(pageUrl);
  const scripts = new Set();
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      const abs = new URL(match[1], pageUrl).toString();
      if (/^https?:\/\//i.test(abs)) scripts.add(abs);
    } catch {
      /* skip unparseable src */
    }
  }
  return Array.from(scripts);
}

function fileNameFor(url, suffix = "") {
  const parsed = new URL(url);
  const base = path.basename(parsed.pathname).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 90) || "bundle.js";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  return `${base}-${hash}${suffix}`;
}

function resolveMapUrl(scriptUrl, mapHint) {
  if (!mapHint) return `${scriptUrl}.map`;
  if (mapHint.startsWith("data:")) return "";
  return new URL(mapHint, scriptUrl).toString();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "web-clone-skill/1.0 sourcemap-hunt",
      "accept": "*/*",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

// Turn a webpack/sourcemap "source" path into a safe, browsable relative path.
function sanitizeSourcePath(source, index) {
  let p = String(source || `module-${index}`);
  // Strip protocol-ish prefixes: webpack://name/, webpack:///, http(s)://host/, file:///
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, "");
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "");
  // Collapse leading ./ and ../ and any absolute leading slash.
  p = p.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
  // Neutralize remaining traversal segments and query/hash noise.
  p = p.split(/[?#]/)[0];
  p = p
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  if (!p) p = `module-${index}`;
  return p;
}

// Write each sourcesContent[i] to sources[i] under destDir; return count written.
function unwebpack(map, destDir) {
  const sources = map.sources || [];
  const contents = map.sourcesContent || [];
  let written = 0;
  for (let i = 0; i < sources.length; i += 1) {
    const content = contents[i];
    if (typeof content !== "string") continue; // no embedded content -> can't reconstruct
    const rel = sanitizeSourcePath(sources[i], i);
    const target = path.join(destDir, rel);
    // Guard against escaping destDir.
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(destDir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    written += 1;
  }
  return written;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.url && !args.recon)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  let scripts = [];
  let originUrl = "";
  if (args.recon) {
    const recon = JSON.parse(fs.readFileSync(args.recon, "utf8"));
    originUrl = recon.url || "";
    scripts = collectScriptsFromRecon(recon);
  } else {
    originUrl = args.url;
    scripts = await collectScriptsFromPage(args.url);
  }

  const originHost = originUrl ? safeHost(originUrl) : "";
  if (!args.allExternal && originHost) {
    scripts = scripts.filter((s) => safeHost(s) === originHost);
  }

  const outDir = path.resolve(args.outDir || "RECON/sourcemaps");
  const sourcesRoot = path.join(outDir, "sources");
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const scriptUrl of scripts) {
    const entry = {
      scriptUrl,
      status: "unknown",
      mapUrl: "",
      mapFile: "",
      sourcesDir: "",
      fileCount: 0,
      error: "",
    };
    try {
      const js = await fetchText(scriptUrl);
      const hint = js.match(/[#@]\s*sourceMappingURL=([^\s*'"]+)/)?.[1] || "";
      entry.mapUrl = resolveMapUrl(scriptUrl, hint);
      if (!entry.mapUrl) {
        entry.status = "inline-or-data-map";
        results.push(entry);
        continue;
      }
      const mapText = await fetchText(entry.mapUrl);
      const mapFile = path.join(outDir, fileNameFor(entry.mapUrl, ".map"));
      fs.writeFileSync(mapFile, mapText);
      entry.mapFile = mapFile;

      // Un-webpack into a per-bundle source tree.
      let map;
      try {
        map = JSON.parse(mapText);
      } catch {
        map = null;
      }
      if (map && Array.isArray(map.sources)) {
        const destDir = path.join(sourcesRoot, fileNameFor(entry.mapUrl));
        const count = unwebpack(map, destDir);
        entry.fileCount = count;
        if (count > 0) entry.sourcesDir = destDir;
      }
      entry.status = "ok";
    } catch (error) {
      entry.status = "error";
      entry.error = error.message;
    }
    results.push(entry);
  }

  const okResults = results.filter((item) => item.status === "ok");
  const manifest = {
    source: args.recon || args.url,
    url: originUrl,
    allExternal: args.allExternal,
    scriptCount: scripts.length,
    mapCount: okResults.length,
    fileCount: okResults.reduce((sum, item) => sum + item.fileCount, 0),
    outDir,
    results,
  };
  const manifestFile = path.join(outDir, "sourcemap-manifest.json");
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifestFile);
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

main().catch((error) => {
  console.error(`sourcemap-hunt failed: ${error.message}`);
  process.exit(1);
});
