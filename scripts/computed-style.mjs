#!/usr/bin/env node
/**
 * computed-style.mjs — getComputedStyle DOM walker for section spec extraction
 *
 * Usage:
 *   node scripts/computed-style.mjs <url> --selector <sel> --out <file> [options]
 *
 * Options:
 *   --selector <css>   Container to walk (default: "body").
 *   --out <file>       JSON artifact path (default: ./computed-style.json).
 *   --depth <n>        Max descend depth (default: 4).
 *   --max-children <n> Cap children walked per node (default: 24).
 *   --viewport <WxH>   Viewport, e.g. 1440x900 (default: 1440x900).
 *   --wait <ms>        Settle time after load (default: 1000).
 *   --trigger <spec>   Capture a second state after a gesture, then diff A→B.
 *                      Forms: scroll:<px> | scroll (=800) | click:<css> |
 *                             hover:<css> | wait:<ms>
 *   --url <url>        Alternative to the positional URL argument.
 *
 * Produces: JSON with { stateA, stateB?, diff? }. Per node: tag, classes
 *   (ORIGINAL class names), a curated ~30-property computed-style map that
 *   KEEPS meaningful zero/default values, verbatim text, aria/role, and asset
 *   refs (img src/alt/natural size + background-image url). The A→B diff is the
 *   behavior spec for stateful sections.
 * Mode: M2/M3 foreman (spec extraction, references/spec-and-dispatch.md).
 */

import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "./lib/browser.mjs";

function usage() {
  console.log(`Usage:
  node scripts/computed-style.mjs <url> --selector <css> --out <file> [options]

Options:
  --selector <css>    container to walk (default: body)
  --out <file>        output JSON path (default: ./computed-style.json)
  --depth <n>         max descend depth (default: 4)
  --max-children <n>  children per node cap (default: 24)
  --viewport <WxH>    viewport size (default: 1440x900)
  --wait <ms>         settle time after load (default: 1000)
  --trigger <spec>    second-state gesture: scroll:<px> | click:<css> |
                      hover:<css> | wait:<ms>
`);
}

function parseArgs(argv) {
  const out = {
    url: "",
    selector: "body",
    outFile: "computed-style.json",
    depth: 4,
    maxChildren: 24,
    viewport: { width: 1440, height: 900 },
    waitMs: 1000,
    trigger: "",
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--url") out.url = argv[++i] || "";
    else if (arg === "--selector") out.selector = argv[++i] || "body";
    else if (arg === "--out") out.outFile = argv[++i] || "";
    else if (arg === "--depth") out.depth = Number(argv[++i]);
    else if (arg === "--max-children") out.maxChildren = Number(argv[++i]);
    else if (arg === "--wait") out.waitMs = Number(argv[++i]);
    else if (arg === "--trigger") out.trigger = argv[++i] || "";
    else if (arg === "--viewport") {
      const [w, h] = String(argv[++i] || "").toLowerCase().split("x");
      out.viewport = { width: Number(w) || 1440, height: Number(h) || 900 };
    } else if (!arg.startsWith("-") && !out.url) {
      out.url = arg; // positional URL
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return out;
}

/**
 * The DOM-walk executed in the page. Returns a tree of nodes. Keeps meaningful
 * zero/default values (does NOT drop borderRadius:0, letterSpacing:normal, etc.)
 * because a dropped value becomes a builder's guess.
 */
function walkInPage({ selector, depth, maxChildren }) {
  const props = [
    // typography
    "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing",
    "color", "textAlign", "textTransform", "textDecorationLine", "whiteSpace",
    // box + background
    "backgroundColor", "backgroundImage", "padding", "margin",
    "width", "height", "maxWidth",
    "borderRadius", "border", "boxShadow",
    // layout
    "display", "flexDirection", "justifyContent", "alignItems", "gap",
    "gridTemplateColumns",
    // position + effects
    "position", "zIndex", "overflow", "opacity", "transform", "transition",
    "cursor", "objectFit", "filter", "backdropFilter",
  ];

  const extractStyles = (element) => {
    const cs = getComputedStyle(element);
    const styles = {};
    for (const p of props) {
      const v = cs[p];
      // Keep zero/default values; only skip empty strings the engine omits.
      if (v !== "" && v != null) styles[p] = v;
    }
    return styles;
  };

  const assetsOf = (element) => {
    const assets = {};
    if (element.tagName === "IMG") {
      assets.img = {
        src: element.currentSrc || element.src || "",
        alt: element.alt || "",
        naturalWidth: element.naturalWidth || 0,
        naturalHeight: element.naturalHeight || 0,
      };
    }
    const bg = getComputedStyle(element).backgroundImage;
    if (bg && bg !== "none") assets.backgroundImage = bg;
    if (element.tagName === "svg" || element.tagName === "SVG") assets.svg = true;
    if (element.tagName === "VIDEO") {
      assets.video = {
        src: element.currentSrc || element.src || "",
        poster: element.poster || "",
      };
    }
    return Object.keys(assets).length ? assets : null;
  };

  const directText = (element) => {
    // Verbatim text from direct text-node children only (trimmed).
    let t = "";
    for (const n of element.childNodes) {
      if (n.nodeType === 3) t += n.textContent;
    }
    t = t.trim().replace(/\s+/g, " ");
    return t ? t.slice(0, 400) : null;
  };

  const ariaOf = (element) => {
    const aria = {};
    for (const attr of element.attributes || []) {
      if (attr.name === "role" || attr.name.startsWith("aria-")) {
        aria[attr.name] = attr.value;
      }
    }
    const placeholder = element.getAttribute && element.getAttribute("placeholder");
    if (placeholder) aria.placeholder = placeholder;
    return Object.keys(aria).length ? aria : null;
  };

  const walk = (element, d) => {
    const children = Array.from(element.children || []);
    const node = {
      tag: element.tagName.toLowerCase(),
      classes: String(element.className || "").trim() || null, // ORIGINAL names
      id: element.id || null,
      text: directText(element),
      aria: ariaOf(element),
      assets: assetsOf(element),
      styles: extractStyles(element),
      childCount: children.length,
    };
    if (d < depth && children.length) {
      node.children = children
        .slice(0, maxChildren)
        .map((c) => walk(c, d + 1))
        .filter(Boolean);
      if (children.length > maxChildren) node.truncated = children.length - maxChildren;
    }
    return node;
  };

  const el = document.querySelector(selector);
  if (!el) return { error: `Element not found: ${selector}` };
  return walk(el, 0);
}

/** Flatten a node tree into path-keyed style maps for diffing. */
function flattenStyles(node, at, acc) {
  if (!node || node.error) return acc;
  acc.push({ path: at, tag: node.tag, classes: node.classes, styles: node.styles || {} });
  (node.children || []).forEach((child, i) => flattenStyles(child, `${at}>${child.tag}[${i}]`, acc));
  return acc;
}

/** Compute per-property A→B style changes across the two trees. */
function diffStates(a, b) {
  const flatA = flattenStyles(a, a.tag, []);
  const flatB = flattenStyles(b, b.tag, []);
  const changes = [];
  const len = Math.min(flatA.length, flatB.length);
  for (let i = 0; i < len; i += 1) {
    const na = flatA[i];
    const nb = flatB[i];
    const keys = new Set([...Object.keys(na.styles), ...Object.keys(nb.styles)]);
    for (const key of keys) {
      const from = na.styles[key];
      const to = nb.styles[key];
      if (from !== to) {
        changes.push({ path: na.path, tag: na.tag, classes: na.classes, property: key, from, to });
      }
    }
  }
  return changes;
}

/** Perform a trigger gesture and return a human description of it. */
async function applyTrigger(page, spec) {
  const [kindRaw, ...rest] = spec.split(":");
  const kind = kindRaw.trim().toLowerCase();
  const arg = rest.join(":").trim();
  if (kind === "scroll") {
    const px = Number(arg) || 800;
    await page.evaluate((y) => window.scrollTo(0, y), px);
    return `scroll to ${px}px`;
  }
  if (kind === "click") {
    if (!arg) throw new Error("--trigger click:<css> requires a selector");
    await page.click(arg, { timeout: 5000 });
    return `click ${arg}`;
  }
  if (kind === "hover") {
    if (!arg) throw new Error("--trigger hover:<css> requires a selector");
    await page.hover(arg, { timeout: 5000 });
    return `hover ${arg}`;
  }
  if (kind === "wait") {
    await page.waitForTimeout(Number(arg) || 1000);
    return `wait ${Number(arg) || 1000}ms`;
  }
  throw new Error(`Unknown --trigger spec: ${spec}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.url) {
    console.error("computed-style: missing target URL.\n");
    usage();
    process.exit(1);
  }
  if (!args.outFile) {
    console.error("computed-style: --out requires a file path.");
    process.exit(1);
  }
  if (!Number.isFinite(args.depth) || args.depth < 0) {
    console.error("computed-style: --depth must be a non-negative number.");
    process.exit(1);
  }

  const walkOpts = { selector: args.selector, depth: args.depth, maxChildren: args.maxChildren };

  const playwright = loadPlaywright();
  const browser = await launchChromium(playwright.chromium);
  let result;
  try {
    const context = await browser.newContext({ viewport: args.viewport });
    const page = await context.newPage();
    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);

    const stateA = await page.evaluate(walkInPage, walkOpts);
    if (stateA && stateA.error) {
      throw new Error(stateA.error);
    }

    let stateB = null;
    let triggerDesc = null;
    let diff = null;
    if (args.trigger) {
      triggerDesc = await applyTrigger(page, args.trigger);
      await page.waitForTimeout(600); // let transitions settle
      stateB = await page.evaluate(walkInPage, walkOpts);
      if (stateB && stateB.error) throw new Error(stateB.error);
      diff = diffStates(stateA, stateB);
    }

    result = {
      url: args.url,
      selector: args.selector,
      capturedAt: new Date().toISOString(),
      viewport: args.viewport,
      depth: args.depth,
      trigger: triggerDesc,
      stateA,
      stateB,
      diff,
    };
  } finally {
    await browser.close().catch(() => {});
  }

  const outPath = path.resolve(args.outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(outPath);
}

main().catch((error) => {
  console.error(`computed-style failed: ${error.message}`);
  process.exit(1);
});
