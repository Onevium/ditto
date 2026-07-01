#!/usr/bin/env node
/**
 * lib/browser.mjs — Shared Playwright loader with portable install-path search.
 *
 * Resolves the `playwright` (or `playwright-core`) module without hardcoding any
 * personal home path. Search order: $DITTO_PLAYWRIGHT, local node_modules
 * (playwright / playwright-core), then common global locations derived from
 * process.execPath and `npm root -g`.
 *
 * Exports:
 *   loadPlaywright()                 -> playwright module (with .chromium)
 *   launchChromium(chromium, opts)   -> Browser (headless, channel:'chrome' fallback)
 *   withPage(fn, { viewport })       -> await fn(page, { browser, context }), always cleans up
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);

/**
 * Best-effort lookup of the global npm root (e.g. /usr/local/lib/node_modules).
 * Returns null if npm is unavailable.
 */
function npmGlobalRoot() {
  try {
    const out = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Build the ordered list of candidate module specifiers/paths to try.
 */
function playwrightCandidates() {
  const candidates = [];

  // 1. Explicit override via environment variable.
  if (process.env.DITTO_PLAYWRIGHT) {
    candidates.push(process.env.DITTO_PLAYWRIGHT);
  }

  // 2. Normal resolution from local node_modules / NODE_PATH.
  candidates.push("playwright", "playwright-core");

  // 3. Global locations derived from the running node binary.
  //    process.execPath is e.g. /usr/local/bin/node or
  //    ~/.nvm/versions/node/vX/bin/node -> ../lib/node_modules/<pkg>.
  const binDir = path.dirname(process.execPath);
  const nodePrefix = path.dirname(binDir); // strip /bin
  const globalRoots = new Set([
    path.join(nodePrefix, "lib", "node_modules"),
    path.join(nodePrefix, "node_modules"),
  ]);

  // 4. Global root reported by npm itself.
  const npmRoot = npmGlobalRoot();
  if (npmRoot) globalRoots.add(npmRoot);

  for (const root of globalRoots) {
    for (const pkg of ["playwright", "playwright-core"]) {
      candidates.push(path.join(root, pkg));
      // Playwright is also commonly nested under @playwright/mcp.
      candidates.push(path.join(root, "@playwright", "mcp", "node_modules", pkg));
    }
  }

  return candidates;
}

export function loadPlaywright() {
  const tried = [];
  for (const candidate of playwrightCandidates()) {
    tried.push(candidate);
    try {
      const mod = require(candidate);
      if (mod && mod.chromium) return mod;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(
    "Playwright not found. Run `npm install -D playwright` in the clone project, " +
      "set $DITTO_PLAYWRIGHT to a Playwright install path, or install it globally " +
      "(`npm install -g playwright`).\nSearched:\n  " +
      tried.join("\n  ")
  );
}

export async function launchChromium(chromium, opts = {}) {
  try {
    return await chromium.launch({ headless: true, ...opts });
  } catch (firstError) {
    try {
      return await chromium.launch({ headless: true, channel: "chrome", ...opts });
    } catch {
      throw firstError;
    }
  }
}

export async function withPage(fn, { viewport } = {}) {
  const playwright = loadPlaywright();
  const browser = await launchChromium(playwright.chromium);
  let context;
  try {
    context = await browser.newContext(viewport ? { viewport } : {});
    const page = await context.newPage();
    return await fn(page, { browser, context });
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
