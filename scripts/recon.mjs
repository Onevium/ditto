#!/usr/bin/env node
/**
 * recon.mjs — Core reconnaissance: screenshots + framework/font/CSS-var signals
 *
 * Usage:
 *   node scripts/recon.mjs <url> [--out clones/<slug>/RECON] [--label original|clone]
 *                          [--widths 1440,768,390] [--wait 1200]
 *
 * Produces (paths relative to cwd, default ./RECON):
 *   <out>/<label>-recon.json       full signals per viewport + console/page errors
 *   <out>/<label>-summary.md       human-readable summary
 *   <out>/screenshots/<label>-<width>.png   full-page screenshot per viewport
 *
 * Step 1 of the clone decision tree. Records how the target looks / is built as
 * auditable evidence; it does NOT pick a mode. Default widths 1440/768/390 are the
 * contract — capture at the widths verification will score at.
 */

import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "./lib/browser.mjs";

function usage() {
  console.log(`Usage:
  node scripts/recon.mjs <url> [--out <RECON dir>] [--label original|clone] [--widths 1440,768,390] [--wait 1200]

Produces:
  <out>/<label>-recon.json
  <out>/<label>-summary.md
  <out>/screenshots/<label>-<width>.png
`);
}

function parseArgs(argv) {
  const out = {
    url: "",
    outDir: "RECON",
    label: "original",
    widths: [1440, 768, 390],
    waitMs: 1200,
    headful: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--url") out.url = argv[++i] || "";
    else if (arg === "--out") out.outDir = argv[++i] || "";
    else if (arg === "--label") out.label = argv[++i] || "original";
    else if (arg === "--widths") {
      out.widths = (argv[++i] || "")
        .split(",")
        .map((n) => Number(n.trim()))
        .filter(Boolean);
    } else if (arg === "--wait") out.waitMs = Number(argv[++i] || "1200");
    else if (arg === "--headful") out.headful = true; // real Chrome; clears Cloudflare/anti-bot
    else if (arg.startsWith("-")) throw new Error(`Unexpected argument: ${arg}`);
    else if (!out.url) out.url = arg; // first positional is the URL
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

function summarizeFlags(signals) {
  return Object.entries(signals.frameworks || {})
    .filter(([, value]) => value)
    .map(([key]) => key);
}

function writeSummary(file, data) {
  const first = data.captures[0]?.signals || {};
  const lines = [
    `# ${data.label} recon`,
    "",
    `- URL: ${data.url}`,
    `- Title: ${first.title || ""}`,
    `- Lang: ${first.lang || ""}`,
    `- Captured: ${data.capturedAt}`,
    `- Viewports: ${data.captures.map((c) => c.viewport.width).join(", ")}`,
    `- ScrollHeight (first): ${first.scrollHeight ?? 0}`,
    `- Framework signals: ${summarizeFlags(first).join(", ") || "none"}`,
    `- Canvas count: ${first.counts?.canvas ?? 0}${(first.canvases || []).some((c) => c.pointerEvents === "none") ? " (incl. effect/texture overlay)" : ""}`,
    `- Video count: ${first.counts?.video ?? 0}`,
    ...((first.videos || []).length ? [`- Videos: ${first.videos.map((v) => v.src).filter(Boolean).join(", ")}`] : []),
    `- Image count: ${first.counts?.images ?? 0}`,
    ...((first.backgroundImages || []).length ? [`- Background images: ${first.backgroundImages.length}`] : []),
    ...((first.images || []).some((i) => i.siblingImgs > 1) ? [`- Layered image compositions detected (stacked <img> in a container)`] : []),
    `- Link count: ${first.counts?.links ?? 0}`,
    `- Fonts: ${(first.fonts || []).join(", ") || "none"}`,
    `- Console errors: ${data.console.errors.length}`,
    `- Page errors: ${data.console.pageErrors.length}`,
    "",
    "## Screenshots",
    ...data.captures.map((c) => `- ${c.viewport.width}: ${c.screenshot}`),
    "",
  ];
  fs.writeFileSync(file, lines.join("\n"));
}

async function collectSignals(page) {
  return page.evaluate(() => {
    const bySelector = (selector) => Array.from(document.querySelectorAll(selector));
    const text = (node) => (node?.textContent || "").trim().replace(/\s+/g, " ");
    const win = window;
    const scripts = bySelector("script[src]").map((s) => s.src);
    const stylesheets = bySelector("link[rel='stylesheet']").map((s) => s.href);
    const headings = bySelector("h1,h2,h3").slice(0, 60).map((h) => ({
      tag: h.tagName.toLowerCase(),
      text: text(h).slice(0, 160),
    }));
    const sections = bySelector("header,nav,main,section,article,aside,footer").slice(0, 80).map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase(),
        id: node.id || "",
        className: String(node.className || "").slice(0, 160),
        text: text(node).slice(0, 240),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        style: {
          display: style.display,
          position: style.position,
          backgroundColor: style.backgroundColor,
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
        },
      };
    });
    const cssVariables = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules || []);
      } catch {
        return [];
      }
    }).flatMap((rule) => {
      const style = rule.style;
      if (!style) return [];
      return Array.from(style)
        .filter((name) => name.startsWith("--"))
        .map((name) => [name, style.getPropertyValue(name).trim()]);
    }).slice(0, 200);
    // Asset Discovery: enumerate the full media/dynamic layer, not just counts —
    // with parent/sibling/position so LAYERED compositions are visible.
    const images = bySelector("img").slice(0, 120).map((img) => {
      const parent = img.parentElement;
      const cs = getComputedStyle(img);
      return {
        src: img.currentSrc || img.src,
        alt: img.alt || "",
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        position: cs.position,
        zIndex: cs.zIndex,
        parentClasses: String(parent?.className || "").slice(0, 80),
        siblingImgs: parent ? parent.querySelectorAll("img").length : 1, // >1 hints a layered composition
      };
    });
    // Videos are the #1 thing a lifeless clone drops — capture src/poster/flags, never just a count.
    const videos = bySelector("video").map((v) => ({
      src: v.currentSrc || v.src || (v.querySelector("source") && v.querySelector("source").src) || "",
      poster: v.poster || "",
      autoplay: v.autoplay,
      loop: v.loop,
      muted: v.muted,
      width: v.videoWidth || 0,
      height: v.videoHeight || 0,
    }));
    // Background images (watercolors, gradients-as-image, sprites) — markup-only cloners miss these.
    const backgroundImages = bySelector("*").slice(0, 4000).map((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none" || !/url\(/.test(bg)) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) return null;
      return {
        url: bg.slice(0, 300),
        element: el.tagName.toLowerCase() + "." + String(el.className || "").split(" ")[0],
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }).filter(Boolean).slice(0, 60);
    const canvases = bySelector("canvas").map((canvas) => {
      const cs = getComputedStyle(canvas);
      const r = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: Math.round(r.width),
        cssHeight: Math.round(r.height),
        className: String(canvas.className || "").slice(0, 80),
        position: cs.position,
        pointerEvents: cs.pointerEvents, // "none" + absolute inset-0 => a texture/effect overlay
      };
    });
    return {
      href: location.href,
      title: document.title,
      lang: document.documentElement.lang || "",
      bodyTextChars: (document.body?.innerText || "").length,
      scrollHeight: document.documentElement.scrollHeight,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      h1: bySelector("h1").map((h) => text(h)).filter(Boolean).slice(0, 10),
      headings,
      metaDescription: document.querySelector("meta[name='description']")?.content || "",
      counts: {
        links: bySelector("a[href]").length,
        images: bySelector("img").length,
        video: bySelector("video").length,
        canvas: bySelector("canvas").length,
        sections: sections.length,
        forms: bySelector("form").length,
        buttons: bySelector("button").length,
        inputs: bySelector("input,textarea,select").length,
        interactive: bySelector("a[href],button,input,textarea,select,summary,[role='button'],[tabindex]").length,
        scripts: scripts.length,
        stylesheets: stylesheets.length,
      },
      frameworks: {
        react: Boolean(win.__REACT_DEVTOOLS_GLOBAL_HOOK__) || Boolean(document.querySelector("#__next,[data-reactroot],[data-reactid]")),
        next: Boolean(document.querySelector("#__next")) || scripts.some((src) => src.includes("/_next/")),
        vue: Boolean(win.__VUE__) || Boolean(document.querySelector("[data-v-app]")),
        nuxt: Boolean(win.__NUXT__) || scripts.some((src) => src.includes("/_nuxt/")),
        svelte: Boolean(document.querySelector("[data-svelte-h]")),
        astro: Boolean(document.querySelector("[data-astro-cid]")) || scripts.some((src) => src.includes("astro")),
        three: Boolean(win.THREE) || scripts.some((src) => /three(\.module)?(\.min)?\.js/i.test(src)),
        gsap: Boolean(win.gsap) || scripts.some((src) => src.toLowerCase().includes("gsap")),
        lenis: Boolean(win.Lenis) || scripts.some((src) => src.toLowerCase().includes("lenis")),
      },
      scripts: scripts.slice(0, 120),
      stylesheets: stylesheets.slice(0, 80),
      sections,
      cssVariables,
      fonts: Array.from(document.fonts || []).map((font) => font.family).filter(Boolean).slice(0, 40),
      images,
      videos,
      backgroundImages,
      canvases,
    };
  });
}

/** Scroll the whole page top→bottom (then back) so lazy media / canvases mount before capture. */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let last = 0, still = 0;
      const step = () => {
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        const h = document.documentElement.scrollHeight;
        if (h === last) { still += 1; } else { still = 0; last = h; }
        if (still > 3 || window.scrollY + window.innerHeight >= h + 4) return resolve();
        setTimeout(step, 250);
      };
      step();
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.url) {
    usage();
    throw new Error("A target <url> is required.");
  }
  if (!args.widths.length) {
    throw new Error("No valid widths parsed from --widths.");
  }

  const chromium = loadPlaywright().chromium;
  const outDir = path.resolve(process.cwd(), args.outDir);
  const screenshotsDir = path.join(outDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const consoleState = { errors: [], warnings: [], pageErrors: [] };
  const browser = await launchChromium(
    chromium,
    args.headful ? { headless: false, channel: "chrome" } : {}
  );
  const captures = [];

  try {
    for (const width of args.widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      page.on("console", (message) => {
        const entry = { type: message.type(), text: message.text(), viewport: width };
        if (message.type() === "error") consoleState.errors.push(entry);
        if (message.type() === "warning") consoleState.warnings.push(entry);
      });
      page.on("pageerror", (error) => {
        consoleState.pageErrors.push({ message: error.message, viewport: width });
      });

      await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      // Anti-bot interstitial (Cloudflare "Just a moment...", etc.): poll until the
      // real page appears. Never ingest the challenge page as if it were content.
      for (let tries = 0; tries < 20; tries += 1) {
        const title = await page.title().catch(() => "");
        const links = await page.evaluate(() => document.querySelectorAll("a").length).catch(() => 0);
        if (!/just a moment|checking your browser|attention required|verifying you are human/i.test(title) && links > 3) break;
        if (tries === 0 && !args.headful) {
          console.warn("[ditto] anti-bot challenge detected — retry with --headful (real Chrome) if it does not clear.");
        }
        await page.waitForTimeout(1500);
      }
      if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);
      await autoScroll(page); // trigger lazy media / canvases before inventorying the dynamic layer

      const signals = await collectSignals(page);
      const screenshotName = `${args.label}-${width}.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      captures.push({
        viewport: { width, height: 900 },
        screenshot: path.relative(outDir, screenshotPath),
        signals,
      });
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const result = {
    label: args.label,
    url: args.url,
    capturedAt: new Date().toISOString(),
    console: consoleState,
    captures,
  };
  const jsonFile = path.join(outDir, `${args.label}-recon.json`);
  fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`);
  writeSummary(path.join(outDir, `${args.label}-summary.md`), result);
  console.log(jsonFile);
}

main().catch((error) => {
  console.error(`recon failed: ${error.message}`);
  process.exit(1);
});
