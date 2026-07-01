#!/usr/bin/env node
/**
 * visual-diff.mjs — Pixel + SSIM fidelity score for original vs clone screenshots.
 *
 * Usage:
 *   node scripts/visual-diff.mjs --original <orig.png> --clone <clone.png> \
 *        --out <diff.json> [--diff <diff.png>] [--threshold 0.08]
 *   (aliases: --a == --original, --b == --clone)
 *
 * Produces:
 *   - <diff.json>: numeric metrics — diffPixelRatio, meanAbsDiff, rmse, ssim (0–1),
 *     and a 1–5 visualScore bucket that fuses the pixel and perceptual signals.
 *   - <diff.png> (optional): highlighted diff map — changed pixels in red over a
 *     faded copy of the original, so you can see *where* the clone diverged.
 *
 * Mode: Verify. Run once per viewport (1440 / 768 / 390) and record every result.
 *
 * How it works: both PNGs are decoded with pngjs and size-normalized onto a common
 * canvas (padded to the larger of each dimension, white background) so a taller or
 * wider clone still aligns at the top-left origin. pixelmatch produces the diff PNG
 * and the changed-pixel count; ssim.js adds the perceptual/structural score that
 * naive abs-diff misses. No browser is required — this is pure Node image math.
 */

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { ssim } from "ssim.js";

function usage() {
  console.log(`Usage:
  node scripts/visual-diff.mjs --original <orig.png> --clone <clone.png> --out <diff.json> [--diff <diff.png>] [--threshold 0.08]

Compares two screenshots (pixel delta + SSIM) and writes numeric visual-diff metrics.
Aliases: --a=--original, --b=--clone. Screenshots are size-normalized before comparison.
`);
}

function parseArgs(argv) {
  const out = { original: "", clone: "", out: "visual-diff.json", diff: "", threshold: 0.08 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--original" || arg === "--a") out.original = argv[++i] || "";
    else if (arg === "--clone" || arg === "--b") out.clone = argv[++i] || "";
    else if (arg === "--out") out.out = argv[++i] || "visual-diff.json";
    else if (arg === "--diff") out.diff = argv[++i] || "";
    else if (arg === "--threshold") out.threshold = Number(argv[++i] || "0.08");
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

/** Decode a PNG file into { width, height, data } (RGBA Uint8Array). */
function readPng(file) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return PNG.sync.read(fs.readFileSync(file));
}

/**
 * Copy `src` (RGBA) onto a fresh white canvas of size width×height at origin (0,0).
 * This is the size-normalized alignment step: a larger clone is padded, not scaled,
 * so genuine content stays pixel-aligned instead of being warped.
 */
function padToCanvas(src, width, height) {
  const data = new Uint8Array(width * height * 4).fill(255); // opaque white
  for (let y = 0; y < src.height && y < height; y += 1) {
    for (let x = 0; x < src.width && x < width; x += 1) {
      const s = (y * src.width + x) * 4;
      const d = (y * width + x) * 4;
      data[d] = src.data[s];
      data[d + 1] = src.data[s + 1];
      data[d + 2] = src.data[s + 2];
      data[d + 3] = src.data[s + 3];
    }
  }
  return data;
}

/** Average normalized abs-difference and RMSE across all channels of two RGBA buffers. */
function pixelStats(a, b) {
  let sumAbs = 0;
  let sumSq = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i]) / 255;
    sumAbs += delta;
    sumSq += delta * delta;
  }
  return {
    meanAbsDiff: sumAbs / a.length,
    rmse: Math.sqrt(sumSq / a.length),
  };
}

/**
 * Map the numeric signals onto a 1–5 fidelity bucket.
 * SSIM (perceptual/structural) is the primary axis; pixel ratio and mean abs-diff
 * guard against asset misses that SSIM can be lenient about. Worst wins — we never
 * flatter the clone by ignoring a channel that says it is broken.
 */
function scoreFrom(diffRatio, meanAbsDiff, ssimScore) {
  const perceptual =
    ssimScore >= 0.98 ? 5 :
    ssimScore >= 0.95 ? 4.5 :
    ssimScore >= 0.9 ? 4 :
    ssimScore >= 0.8 ? 3 :
    ssimScore >= 0.6 ? 2 : 1;

  const pixel =
    diffRatio <= 0.01 && meanAbsDiff <= 0.01 ? 5 :
    diffRatio <= 0.04 && meanAbsDiff <= 0.025 ? 4.5 :
    diffRatio <= 0.08 && meanAbsDiff <= 0.05 ? 4 :
    diffRatio <= 0.16 && meanAbsDiff <= 0.08 ? 3 :
    diffRatio <= 0.3 && meanAbsDiff <= 0.14 ? 2 : 1;

  return Math.min(perceptual, pixel);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.original || !args.clone) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (!Number.isFinite(args.threshold) || args.threshold < 0 || args.threshold > 1) {
    throw new Error(`--threshold must be a number in [0,1], got: ${args.threshold}`);
  }

  const left = readPng(args.original);
  const right = readPng(args.clone);

  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);

  const a = padToCanvas(left, width, height);
  const b = padToCanvas(right, width, height);

  // pixelmatch writes the highlighted diff into `diffBuf` and returns the count of
  // pixels whose delta exceeds `threshold`. includeAA=false so anti-aliasing noise
  // is not counted as a real difference.
  const diffPng = new PNG({ width, height });
  const changedPixels = pixelmatch(a, b, diffPng.data, width, height, {
    threshold: args.threshold,
    includeAA: false,
    alpha: 0.4,
    diffColor: [255, 0, 0],
  });

  const totalPixels = width * height;
  const diffPixelRatio = changedPixels / totalPixels;
  const { meanAbsDiff, rmse } = pixelStats(a, b);

  // SSIM over the size-normalized canvases (0 = unrelated, 1 = identical structure).
  const { mssim } = ssim(
    { data: a, width, height },
    { data: b, width, height },
  );

  const visualScore = scoreFrom(diffPixelRatio, meanAbsDiff, mssim);

  const result = {
    original: { width: left.width, height: left.height },
    clone: { width: right.width, height: right.height },
    comparedCanvas: { width, height },
    threshold: args.threshold,
    changedPixels,
    totalPixels,
    diffPixelRatio,
    meanAbsDiff,
    rmse,
    ssim: mssim,
    visualScore,
    files: {
      original: path.resolve(args.original),
      clone: path.resolve(args.clone),
      diff: args.diff ? path.resolve(args.diff) : "",
    },
  };

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);

  if (args.diff) {
    fs.mkdirSync(path.dirname(path.resolve(args.diff)), { recursive: true });
    fs.writeFileSync(args.diff, PNG.sync.write(diffPng));
  }

  console.log(path.resolve(args.out));
}

try {
  main();
} catch (error) {
  console.error(`visual-diff failed: ${error.message}`);
  process.exit(1);
}
