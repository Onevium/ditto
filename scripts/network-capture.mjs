#!/usr/bin/env node
/**
 * network-capture.mjs — Capture XHR/fetch/graphql responses into local fixtures
 *
 * Usage:
 *   node scripts/network-capture.mjs <url> [--out clones/<slug>/network]
 *                                          [--label original] [--wait 5000]
 *                                          [--max-bytes 1000000]
 *   node scripts/network-capture.mjs --url <url> --out clones/<slug>/network
 *
 * Produces (Mode M3 — capture the data layer):
 *   <out>/<label>-network.json   Manifest: every request (url, method, resourceType,
 *                                headers, postData) + every response (status,
 *                                contentType, fixture path, bytes, error) plus
 *                                requestCount / responseCount / fixtureCount.
 *   <out>/fixtures/*.json|*.txt  Saved bodies. Filename = sanitized URL path + a
 *                                10-char URL hash, so identical endpoints are stable
 *                                and collisions are avoided.
 *
 * Only `xhr`/`fetch` resource types with a json|text|graphql|javascript content-type
 * are dumped as fixtures; images/CSS/fonts are logged but left to asset-harvest.mjs.
 * Bodies over --max-bytes are skipped with error "body too large".
 *
 * Playwright is loaded ONLY via ./lib/browser.mjs (portable install resolution).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadPlaywright, launchChromium } from "./lib/browser.mjs";

function usage() {
  console.log(`Usage:
  node scripts/network-capture.mjs <url> [--out clones/<slug>/network] [--label original] [--wait 5000] [--max-bytes 1000000]

Captures browser XHR/fetch/graphql responses and saves qualifying JSON/text bodies
as fixtures plus a manifest for a local mock server (Mode M3).

Options:
  --url <url>          Target URL (may also be passed as the first positional arg).
  --out <dir>          Output directory. Default: clones/<slug>/network (slug from URL host).
  --label <name>       Manifest label / filename prefix. Default: original.
  --wait <ms>          Extra settle time after network-idle. Default: 5000.
  --max-bytes <n>      Skip response bodies larger than this. Default: 1000000 (1 MB).
  -h, --help           Show this help.
`);
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "site";
}

function parseArgs(argv) {
  const out = { url: "", outDir: "", label: "original", waitMs: 5000, maxBytes: 1_000_000, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--url") out.url = argv[++i] || "";
    else if (arg === "--out") out.outDir = argv[++i] || "";
    else if (arg === "--label") out.label = argv[++i] || "original";
    else if (arg === "--wait") out.waitMs = Number(argv[++i] || "5000");
    else if (arg === "--max-bytes") out.maxBytes = Number(argv[++i] || "1000000");
    else if (arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    else if (!out.url) out.url = arg; // first positional = URL
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

function safeFixtureName(url, contentType) {
  const parsed = new URL(url);
  const cleanPath =
    parsed.pathname.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "response";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  const ext = contentType.includes("json") ? ".json" : ".txt";
  return `${cleanPath}-${hash}${ext}`;
}

function shouldSave(resourceType, contentType) {
  if (!["xhr", "fetch"].includes(resourceType)) return false;
  return /json|text|graphql|javascript/i.test(contentType || "");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(args.url);
  } catch {
    throw new Error(`Invalid --url: ${args.url}`);
  }
  if (!Number.isFinite(args.waitMs) || args.waitMs < 0) throw new Error(`Invalid --wait: must be a non-negative number`);
  if (!Number.isFinite(args.maxBytes) || args.maxBytes <= 0) throw new Error(`Invalid --max-bytes: must be a positive number`);

  // Default output dir is derived from the URL host so no flag is required.
  const outDir = path.resolve(args.outDir || path.join("clones", slugify(parsedUrl.hostname), "network"));
  const fixturesDir = path.join(outDir, "fixtures");
  fs.mkdirSync(fixturesDir, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const requests = [];
  const responses = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on("request", (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        headers: request.headers(),
        postData: request.postData() || "",
      });
    });

    page.on("response", async (response) => {
      const request = response.request();
      const headers = response.headers();
      const contentType = headers["content-type"] || "";
      const entry = {
        url: response.url(),
        status: response.status(),
        ok: response.ok(),
        method: request.method(),
        resourceType: request.resourceType(),
        contentType,
        fixture: "",
        bytes: 0,
        error: "",
      };

      if (shouldSave(request.resourceType(), contentType)) {
        try {
          const body = await response.body();
          if (body.length <= args.maxBytes) {
            const file = path.join(fixturesDir, safeFixtureName(response.url(), contentType));
            fs.writeFileSync(file, body);
            entry.fixture = path.relative(outDir, file);
            entry.bytes = body.length;
          } else {
            entry.error = `body too large: ${body.length}`;
          }
        } catch (error) {
          entry.error = error.message;
        }
      }

      responses.push(entry);
    });

    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: args.waitMs }).catch(() => {});
    if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);
  } finally {
    await browser.close().catch(() => {});
  }

  const manifest = {
    label: args.label,
    url: args.url,
    capturedAt: new Date().toISOString(),
    maxBytes: args.maxBytes,
    requestCount: requests.length,
    responseCount: responses.length,
    fixtureCount: responses.filter((response) => response.fixture).length,
    requests,
    responses,
  };

  const manifestFile = path.join(outDir, `${args.label}-network.json`);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Captured ${manifest.requestCount} requests, ${manifest.responseCount} responses, ` +
      `${manifest.fixtureCount} fixtures.`
  );
  console.log(`Manifest: ${manifestFile}`);
  console.log(`Fixtures: ${fixturesDir}`);
}

main().catch((error) => {
  console.error(`network-capture failed: ${error.message}`);
  process.exit(1);
});
