#!/usr/bin/env node
/**
 * asset-harvest.mjs — Batched real-asset downloader (never AI-redrawn)
 *
 * Usage:
 *   node scripts/asset-harvest.mjs --manifest <recon.json> [--out public]
 *        [--asset-manifest <file>] [--all-external] [--batch 4]
 *        [--types image,svg,video,font,favicon]
 *
 * Produces:
 *   - Downloaded images / videos / svg / fonts / favicons under <out>/,
 *     mirroring the origin's directory structure (<out>/<host>/<path>).
 *   - An asset manifest (default <out>/asset-manifest.json) listing every
 *     asset with type, source URL, local file, byte size and status.
 *
 * Reads a recon manifest (produced by scripts/recon.mjs) and pulls the *real*
 * binary assets it referenced. Downloads run batched (4 concurrent by default)
 * with per-file error handling, so one bad URL never sinks the run. Assets are
 * copied verbatim from the origin — this script never approximates or redraws.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_BATCH = 4;

// Extension -> asset type. Only these types are harvested (scripts/CSS are
// source, not assets, and are handled elsewhere).
const EXT_TYPE = {
  // images
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
  ".webp": "image", ".avif": "image", ".bmp": "image", ".apng": "image",
  // vector
  ".svg": "svg",
  // video
  ".mp4": "video", ".webm": "video", ".mov": "video", ".m4v": "video",
  ".ogv": "video", ".ogg": "video",
  // fonts
  ".woff": "font", ".woff2": "font", ".ttf": "font", ".otf": "font", ".eot": "font",
  // favicons / app icons
  ".ico": "favicon",
};

const ALL_TYPES = ["image", "svg", "video", "font", "favicon"];

function usage() {
  console.log(`Usage:
  node scripts/asset-harvest.mjs --manifest <recon.json> [--out public]
       [--asset-manifest <file>] [--all-external] [--batch 4]
       [--types image,svg,video,font,favicon]

Downloads the real images/videos/svg/fonts/favicons referenced by a recon
manifest into <out>/, preserving directory structure, and writes an asset
manifest. Downloads run batched (default ${DEFAULT_BATCH} at a time).
`);
}

function parseArgs(argv) {
  const out = {
    recon: "",
    outDir: "public",
    manifest: "",
    allExternal: false,
    batch: DEFAULT_BATCH,
    types: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--manifest" || arg === "--recon") out.recon = argv[++i] || "";
    else if (arg === "--out") out.outDir = argv[++i] || "public";
    else if (arg === "--asset-manifest") out.manifest = argv[++i] || "";
    else if (arg === "--all-external") out.allExternal = true;
    else if (arg === "--batch") out.batch = Math.max(1, Number(argv[++i]) || DEFAULT_BATCH);
    else if (arg === "--types") {
      out.types = String(argv[++i] || "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    } else if (!out.recon) {
      // Positional recon path as a convenience.
      out.recon = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return out;
}

function classify(url) {
  let ext;
  try {
    ext = path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    return null;
  }
  return EXT_TYPE[ext] || null;
}

/**
 * Recursively walk any recon shape and collect every http(s) URL string.
 */
function walkUrls(node, sink) {
  if (!node) return;
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node)) sink.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkUrls(item, sink);
    return;
  }
  if (typeof node === "object") {
    for (const value of Object.values(node)) walkUrls(value, sink);
  }
}

/**
 * Build the asset list from a recon manifest. Explicit image entries keep their
 * alt/dimensions; everything else is discovered by extension while walking the
 * whole document so videos, fonts, favicons and background URLs are all caught.
 */
function collectAssets(recon) {
  const assets = new Map(); // url -> asset

  const captures = recon.captures || (recon.signals ? [recon] : []);

  // 1. Explicit <img> entries — richest metadata.
  for (const capture of captures) {
    const signals = capture.signals || capture;
    for (const image of signals.images || []) {
      const src = image && image.src;
      if (!src || !/^https?:\/\//i.test(src)) continue;
      const type = classify(src) || "image";
      assets.set(src, {
        type,
        url: src,
        alt: image.alt || "",
        width: image.width || 0,
        height: image.height || 0,
      });
    }
  }

  // 2. Everything else discovered by extension (favicons, fonts, videos, svg,
  //    background images embedded in signals/sections/cssVariables, etc.).
  const found = new Set();
  walkUrls(recon, found);
  for (const url of found) {
    if (assets.has(url)) continue;
    const type = classify(url);
    if (!type) continue; // not a binary asset we harvest
    assets.set(url, { type, url });
  }

  return Array.from(assets.values());
}

/**
 * Local destination that mirrors the origin structure:
 *   <out>/<host>/<pathname>
 * Falls back to a hashed filename when the path has no usable basename, and
 * appends a short hash of the full URL when a query string could collide.
 */
function destFor(url, outDir) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  let rel = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  let ext = path.extname(rel);

  // Directory-style URL (no filename) — synthesize one.
  if (!rel || rel.endsWith("/")) {
    ext = ext || ".bin";
    rel = path.join(rel, `index${ext}`);
  }

  // Disambiguate query-string variants of the same path.
  if (parsed.search) {
    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
    const base = ext ? rel.slice(0, -ext.length) : rel;
    rel = `${base}-${hash}${ext}`;
  }

  // Sanitize each path segment; never escape the output root.
  const segments = rel
    .split("/")
    .map((s) => s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 120))
    .filter((s) => s && s !== "..");
  if (segments.length === 0) segments.push("asset.bin");

  return path.join(outDir, host, ...segments);
}

async function download(asset, outDir) {
  const response = await fetch(asset.url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; ditto-asset-harvest/1.0; +clone-website)",
      accept: "*/*",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = destFor(asset.url, outDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return {
    ...asset,
    status: "ok",
    bytes: buffer.length,
    contentType: response.headers.get("content-type") || "",
    file: path.relative(process.cwd(), file),
  };
}

/**
 * Run downloads in fixed-size batches (default 4) with per-file error capture.
 */
async function harvest(assets, outDir, batchSize) {
  const results = [];
  for (let i = 0; i < assets.length; i += batchSize) {
    const batch = assets.slice(i, i + batchSize);
    const settled = await Promise.all(
      batch.map(async (asset) => {
        try {
          const r = await download(asset, outDir);
          console.error(`  ok   ${r.bytes} B  ${asset.url}`);
          return r;
        } catch (error) {
          console.error(`  FAIL ${asset.url} — ${error.message}`);
          return { ...asset, status: "error", error: error.message };
        }
      })
    );
    results.push(...settled);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.recon) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  if (!fs.existsSync(args.recon)) {
    throw new Error(`recon manifest not found: ${args.recon}`);
  }

  let recon;
  try {
    recon = JSON.parse(fs.readFileSync(args.recon, "utf8"));
  } catch (error) {
    throw new Error(`could not parse recon JSON (${args.recon}): ${error.message}`);
  }

  const outDir = path.resolve(args.outDir);
  const manifestFile = path.resolve(
    args.manifest || path.join(outDir, "asset-manifest.json")
  );
  const originHost = recon.url ? new URL(recon.url).hostname : "";
  const wantTypes = new Set(
    (args.types && args.types.length ? args.types : ALL_TYPES).filter((t) =>
      ALL_TYPES.includes(t)
    )
  );

  let assets = collectAssets(recon).filter((a) => wantTypes.has(a.type));
  if (!args.allExternal && originHost) {
    assets = assets.filter((a) => {
      try {
        return new URL(a.url).hostname === originHost;
      } catch {
        return false;
      }
    });
  }

  console.error(
    `[asset-harvest] ${assets.length} asset(s) to fetch` +
      (originHost ? ` from ${originHost}` : "") +
      ` (batch ${args.batch}${args.allExternal ? ", incl. external" : ""})`
  );

  const results = assets.length ? await harvest(assets, outDir, args.batch) : [];

  const byType = {};
  for (const r of results) {
    byType[r.type] = byType[r.type] || { ok: 0, error: 0 };
    byType[r.type][r.status === "ok" ? "ok" : "error"] += 1;
  }

  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify(
      {
        source: args.recon,
        url: recon.url || "",
        outDir: path.relative(process.cwd(), outDir) || ".",
        allExternal: args.allExternal,
        batchSize: args.batch,
        total: results.length,
        ok: results.filter((r) => r.status === "ok").length,
        error: results.filter((r) => r.status === "error").length,
        byType,
        assets: results,
      },
      null,
      2
    )}\n`
  );

  const ok = results.filter((r) => r.status === "ok").length;
  const err = results.length - ok;
  console.error(
    `[asset-harvest] done: ${ok} ok, ${err} error -> ${path.relative(
      process.cwd(),
      manifestFile
    )}`
  );
  console.log(manifestFile);
}

main().catch((error) => {
  console.error(`asset-harvest failed: ${error.message}`);
  process.exit(1);
});
