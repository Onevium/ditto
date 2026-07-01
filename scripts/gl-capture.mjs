#!/usr/bin/env node
/**
 * gl-capture.mjs — Runtime WebGL frame/shader/uniform capture (spector.js-style)
 *
 * Usage:    node scripts/gl-capture.mjs <url> [--out clones/<slug>/gl]
 *                  [--frames N] [--interval MS] [--wait MS] [--viewport WxH]
 *                  [--scroll] [--interact] [--timeout MS]
 * Produces: capture.json  (ordered draw-call log, program bindings, uniform
 *                          names+values, GL state, FBO/texture sizes)
 *           shaders/*.glsl (captured vertex/fragment source per program)
 *           frames/*.png   (sampled frames of the live effect — BASELINE target)
 * Mode:     M4 (effect reverse-engineering) — captured runtime truth == SOURCE evidence.
 *
 * How it works: an addInitScript installs a spector.js-style hook BEFORE any page
 * script runs, patching WebGLRenderingContext / WebGL2RenderingContext prototypes
 * (draw*, useProgram, shaderSource, uniform*, bindFramebuffer, tex*, enable/blend…)
 * so it records what the site actually draws — not what it "looks like".
 * See references/effect-extraction.md ("No source? Runtime capture with gl-capture.mjs").
 */

import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "./lib/browser.mjs";

// ---------------------------------------------------------------------------
// arg parsing (simple, process.argv)
// ---------------------------------------------------------------------------

function fail(msg, code = 1) {
  console.error(`[ditto] gl-capture: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    url: null,
    out: null,
    frames: 6,
    interval: 500,
    wait: 1500,
    viewport: { width: 1440, height: 900 },
    scroll: false,
    interact: false,
    timeout: 45000,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--out": opts.out = next(); break;
      case "--frames": opts.frames = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--interval": opts.interval = Math.max(0, parseInt(next(), 10) || 0); break;
      case "--wait": opts.wait = Math.max(0, parseInt(next(), 10) || 0); break;
      case "--timeout": opts.timeout = Math.max(1000, parseInt(next(), 10) || 45000); break;
      case "--viewport": {
        const m = /^(\d+)x(\d+)$/.exec(next());
        if (m) opts.viewport = { width: +m[1], height: +m[2] };
        break;
      }
      case "--scroll": opts.scroll = true; break;
      case "--interact": opts.interact = true; break;
      case "-h": case "--help": opts.help = true; break;
      default:
        if (a.startsWith("-")) fail(`unknown flag ${a}`);
        else rest.push(a);
    }
  }
  opts.url = rest[0] || null;
  return opts;
}

function slugFromUrl(u) {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "");
    return host.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "site";
  } catch {
    return "site";
  }
}

// ---------------------------------------------------------------------------
// The in-page hook. Serialized by Playwright and injected via addInitScript,
// so it must be fully self-contained (no closures over Node scope).
// ---------------------------------------------------------------------------

function installGLHook() {
  if (window.__DITTO_GL) return;

  const MAX_DRAWS = 20000;
  const MAX_UNIFORM_LEN = 64;

  const store = {
    meta: { href: location.href, ua: navigator.userAgent, start: Date.now() },
    contexts: [],        // { type, width, height, attributes }
    draws: [],           // ordered draw-call log
    shaders: {},         // id -> { id, type, typeName, source }
    programs: {},        // id -> { id, shaders:[], uniforms:{}, uniformLocations:{} }
    textures: {},        // id -> { id, width, height, format }
    framebuffers: {},    // id -> { id, attachments:[] }
    webgpu: typeof navigator !== "undefined" && !!navigator.gpu,
    truncated: false,
  };
  window.__DITTO_GL = store;

  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => {
    if (!o) return null;
    let id = ids.get(o);
    if (id === undefined) { id = nextId++; ids.set(o, id); }
    return id;
  };

  const ctxState = new WeakMap();  // gl -> per-context tracked state
  const locInfo = new WeakMap();   // WebGLUniformLocation -> { programId, name }

  function state(gl) {
    let s = ctxState.get(gl);
    if (!s) {
      s = {
        program: null, framebuffer: null, boundTexture: null,
        blend: false, depthTest: false, cullFace: false,
        blendFunc: null, blendEquation: null, depthFunc: null,
        viewport: null, clearColor: null,
      };
      ctxState.set(gl, s);
    }
    return s;
  }

  const SHADER_TYPE = { 35633: "vertex", 35632: "fragment" };
  const DRAW_MODE = {
    0: "POINTS", 1: "LINES", 2: "LINE_LOOP", 3: "LINE_STRIP",
    4: "TRIANGLES", 5: "TRIANGLE_STRIP", 6: "TRIANGLE_FAN",
  };

  function serVal(v) {
    if (v == null || typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const arr = Array.prototype.slice.call(v);
      if (arr.length > MAX_UNIFORM_LEN) {
        return arr.slice(0, MAX_UNIFORM_LEN).concat([`…+${arr.length - MAX_UNIFORM_LEN}`]);
      }
      return arr;
    }
    try { return String(v); } catch { return "<unserializable>"; }
  }

  function snapshotUniforms(u) {
    if (!u) return null;
    const out = {};
    for (const k in u) out[k] = u[k];
    return out;
  }

  // ---- generic wrappers ----
  function before(proto, name, fn) {
    const orig = proto[name];
    if (typeof orig !== "function") return;
    proto[name] = function () {
      try { fn(this, arguments); } catch (_) {}
      return orig.apply(this, arguments);
    };
  }
  function after(proto, name, fn) {
    const orig = proto[name];
    if (typeof orig !== "function") return;
    proto[name] = function () {
      const r = orig.apply(this, arguments);
      try { fn(this, arguments, r); } catch (_) {}
      return r;
    };
  }

  function recordUniform(gl, method, args) {
    const loc = args[0];
    const info = locInfo.get(loc);
    if (!info) return;
    const prog = store.programs[info.programId];
    if (!prog) return;
    let val;
    if (method.indexOf("uniformMatrix") === 0) val = args[2];
    else if (/v$/.test(method)) val = args[1];
    else val = Array.prototype.slice.call(args, 1);
    prog.uniforms[info.name] = { method, value: serVal(val) };
  }

  function recordDraw(gl, method, args) {
    if (store.draws.length >= MAX_DRAWS) { store.truncated = true; return; }
    const s = state(gl);
    const prog = s.program != null ? store.programs[s.program] : null;
    const isElements = method.indexOf("Elements") >= 0;
    const draw = {
      seq: store.draws.length,
      t: Date.now() - store.meta.start,
      method,
      mode: DRAW_MODE[args[0]] != null ? DRAW_MODE[args[0]] : args[0],
      count: isElements ? args[1] : args[2],
      instances: method.indexOf("Instanced") >= 0 ? (isElements ? args[4] : args[3]) : undefined,
      program: s.program,
      framebuffer: s.framebuffer,   // null => default framebuffer (canvas / screen)
      blend: s.blend,
      blendFunc: s.blendFunc,
      blendEquation: s.blendEquation,
      depthTest: s.depthTest,
      depthFunc: s.depthFunc,
      cullFace: s.cullFace,
      viewport: s.viewport,
      uniforms: prog ? snapshotUniforms(prog.uniforms) : null,
    };
    store.draws.push(draw);
  }

  function patchProto(proto) {
    if (!proto || proto.__dittoPatched) return;
    proto.__dittoPatched = true;

    // --- programs & shaders ---
    after(proto, "createProgram", (gl, a, r) => {
      if (!r) return;
      store.programs[idOf(r)] = { id: idOf(r), shaders: [], uniforms: {}, uniformLocations: {} };
    });
    after(proto, "createShader", (gl, a, r) => {
      if (!r) return;
      const id = idOf(r);
      store.shaders[id] = { id, type: a[0], typeName: SHADER_TYPE[a[0]] || String(a[0]), source: null };
    });
    before(proto, "shaderSource", (gl, a) => {
      const id = idOf(a[0]);
      const rec = store.shaders[id] || (store.shaders[id] = { id, source: null });
      rec.source = a[1];
    });
    before(proto, "attachShader", (gl, a) => {
      const prog = store.programs[idOf(a[0])];
      if (prog && prog.shaders.indexOf(idOf(a[1])) < 0) prog.shaders.push(idOf(a[1]));
    });
    after(proto, "getUniformLocation", (gl, a, r) => {
      if (!r) return;
      const pid = idOf(a[0]);
      locInfo.set(r, { programId: pid, name: a[1] });
      const prog = store.programs[pid];
      if (prog) prog.uniformLocations[a[1]] = true;
    });

    // --- current-state tracking ---
    before(proto, "useProgram", (gl, a) => { state(gl).program = idOf(a[0]); });
    before(proto, "bindFramebuffer", (gl, a) => {
      const s = state(gl);
      s.framebuffer = idOf(a[1]);
      if (a[1] && !store.framebuffers[s.framebuffer]) {
        store.framebuffers[s.framebuffer] = { id: s.framebuffer, attachments: [] };
      }
    });
    before(proto, "bindTexture", (gl, a) => { state(gl).boundTexture = idOf(a[1]); });
    before(proto, "viewport", (gl, a) => { state(gl).viewport = [a[0], a[1], a[2], a[3]]; });
    before(proto, "clearColor", (gl, a) => { state(gl).clearColor = [a[0], a[1], a[2], a[3]]; });
    before(proto, "blendFunc", (gl, a) => { state(gl).blendFunc = [a[0], a[1]]; });
    before(proto, "blendFuncSeparate", (gl, a) => { state(gl).blendFunc = [a[0], a[1], a[2], a[3]]; });
    before(proto, "blendEquation", (gl, a) => { state(gl).blendEquation = a[0]; });
    before(proto, "depthFunc", (gl, a) => { state(gl).depthFunc = a[0]; });
    before(proto, "enable", (gl, a) => { setCap(state(gl), gl, a[0], true); });
    before(proto, "disable", (gl, a) => { setCap(state(gl), gl, a[0], false); });

    // --- texture / renderbuffer / framebuffer sizing ---
    before(proto, "texImage2D", (gl, a) => {
      // 9-arg form: (target, level, internalformat, width, height, border, format, type, pixels)
      if (a.length >= 9) recordTex(gl, a[3], a[4], a[6]);
    });
    before(proto, "texStorage2D", (gl, a) => { recordTex(gl, a[3], a[4], a[2]); });
    before(proto, "renderbufferStorage", (gl, a) => { recordTex(gl, a[2], a[3], a[1]); });
    before(proto, "framebufferTexture2D", (gl, a) => {
      const s = state(gl);
      const fb = store.framebuffers[s.framebuffer];
      if (fb) fb.attachments.push({ attachment: a[1], texture: idOf(a[3]) });
    });

    // --- enumerate uniform* and draw* on this prototype ---
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (/^uniform/.test(name) && typeof proto[name] === "function" && name !== "uniformBlockBinding") {
        before(proto, name, (gl, a) => recordUniform(gl, name, a));
      } else if (/^draw(Arrays|Elements|RangeElements)/.test(name) && typeof proto[name] === "function") {
        before(proto, name, (gl, a) => recordDraw(gl, name, a));
      }
    }
  }

  function setCap(s, gl, cap, on) {
    if (cap === gl.BLEND) s.blend = on;
    else if (cap === gl.DEPTH_TEST) s.depthTest = on;
    else if (cap === gl.CULL_FACE) s.cullFace = on;
  }

  function recordTex(gl, w, h, format) {
    const s = state(gl);
    if (s.boundTexture == null) return;
    const rec = store.textures[s.boundTexture] || (store.textures[s.boundTexture] = { id: s.boundTexture });
    rec.width = w; rec.height = h; rec.format = format;
  }

  if (typeof WebGLRenderingContext !== "undefined") patchProto(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined") patchProto(WebGL2RenderingContext.prototype);

  // Patch context creation so we tag the GL canvas (for targeted frame capture)
  // and record context attributes / canvas size.
  if (typeof HTMLCanvasElement !== "undefined") {
    after(HTMLCanvasElement.prototype, "getContext", function (canvas, a, ctx) {
      const type = a[0];
      if (!ctx) return;
      if (type === "webgl" || type === "experimental-webgl" || type === "webgl2") {
        try { canvas.setAttribute("data-ditto-gl", "1"); } catch (_) {}
        store.contexts.push({
          type,
          width: canvas.width,
          height: canvas.height,
          attributes: (typeof ctx.getContextAttributes === "function") ? ctx.getContextAttributes() : a[1] || null,
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Node-side driver
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log("Usage: node scripts/gl-capture.mjs <url> [--out DIR] [--frames N] " +
      "[--interval MS] [--wait MS] [--viewport WxH] [--scroll] [--interact] [--timeout MS]");
    return;
  }
  if (!opts.url) fail("missing <url>. Usage: node scripts/gl-capture.mjs <url> [--out DIR]", 2);
  if (!/^https?:\/\//i.test(opts.url)) fail(`<url> must start with http(s):// — got "${opts.url}"`, 2);

  const slug = slugFromUrl(opts.url);
  const outDir = path.resolve(process.cwd(), opts.out || path.join("clones", slug, "gl"));
  const shadersDir = path.join(outDir, "shaders");
  const framesDir = path.join(outDir, "frames");
  for (const d of [outDir, shadersDir, framesDir]) fs.mkdirSync(d, { recursive: true });

  const playwright = loadPlaywright();
  const browser = await launchChromium(playwright.chromium);
  let context;
  const frameFiles = [];
  try {
    context = await browser.newContext({ viewport: opts.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();

    // Inject the hook BEFORE any page script runs.
    await page.addInitScript(installGLHook);

    page.on("console", (m) => {
      const t = m.type();
      if (t === "error") console.error(`[page:error] ${m.text()}`);
    });

    try {
      await page.goto(opts.url, { waitUntil: "load", timeout: opts.timeout });
    } catch (e) {
      console.error(`[ditto] gl-capture: navigation warning — ${e.message}`);
    }

    // Settle, then let time-driven effects run while we sample frames.
    await page.waitForTimeout(opts.wait);

    const glCanvas = await page.$("canvas[data-ditto-gl]").catch(() => null);

    for (let i = 0; i < opts.frames; i++) {
      if (opts.scroll) {
        await page.evaluate((y) => window.scrollBy(0, y), Math.round(opts.viewport.height * 0.6)).catch(() => {});
      }
      if (opts.interact) {
        const x = opts.viewport.width * (0.3 + 0.4 * Math.random());
        const y = opts.viewport.height * (0.3 + 0.4 * Math.random());
        await page.mouse.move(x, y).catch(() => {});
      }
      const file = path.join(framesDir, `frame-${String(i).padStart(3, "0")}.png`);
      let shot = false;
      if (glCanvas) {
        try {
          const box = await glCanvas.boundingBox();
          if (box && box.width > 1 && box.height > 1) {
            await glCanvas.screenshot({ path: file });
            shot = true;
          }
        } catch (_) {}
      }
      if (!shot) {
        await page.screenshot({ path: file }).catch(() => {});
      }
      frameFiles.push(path.basename(file));
      if (i < opts.frames - 1) await page.waitForTimeout(opts.interval);
    }

    // Pull the captured store out of the page (already JSON-serializable).
    const data = await page.evaluate(() => window.__DITTO_GL || null);

    if (!data) fail("hook produced no data (page may have blocked script injection).", 3);

    // Write shader sources.
    const shaderIndex = [];
    const writeShader = (rec, label) => {
      if (!rec || rec.source == null) return null;
      const base = `${label}.${rec.typeName || rec.type || "shader"}.glsl`;
      fs.writeFileSync(path.join(shadersDir, base), rec.source, "utf8");
      shaderIndex.push({ file: `shaders/${base}`, shader: rec.id, program: label, type: rec.typeName });
      return base;
    };

    const writtenShaderIds = new Set();
    for (const pid of Object.keys(data.programs)) {
      const prog = data.programs[pid];
      for (const sid of prog.shaders) {
        const rec = data.shaders[sid];
        writeShader(rec, `program-${pid}`);
        writtenShaderIds.add(String(sid));
      }
    }
    // Orphan shaders (never attached to a linked program we saw).
    for (const sid of Object.keys(data.shaders)) {
      if (!writtenShaderIds.has(String(sid))) writeShader(data.shaders[sid], `shader-${sid}`);
    }

    // Assemble capture.json.
    const capture = {
      tool: "gl-capture.mjs",
      version: 1,
      capturedAt: new Date().toISOString(),
      url: opts.url,
      slug,
      viewport: opts.viewport,
      meta: data.meta,
      webgpuPresent: data.webgpu,
      summary: {
        contexts: data.contexts.length,
        programs: Object.keys(data.programs).length,
        shaders: Object.keys(data.shaders).length,
        textures: Object.keys(data.textures).length,
        framebuffers: Object.keys(data.framebuffers).length,
        drawCalls: data.draws.length,
        drawCallsTruncated: data.truncated,
        frames: frameFiles.length,
      },
      contexts: data.contexts,
      programs: data.programs,
      shaderIndex,
      textures: data.textures,
      framebuffers: data.framebuffers,
      draws: data.draws,
      frames: frameFiles,
    };

    fs.writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(capture, null, 2), "utf8");

    const s = capture.summary;
    console.log(
      `[ditto] gl-capture OK — ${s.contexts} ctx, ${s.programs} programs, ` +
      `${s.shaders} shaders, ${s.drawCalls} draws${s.drawCallsTruncated ? " (truncated)" : ""}, ` +
      `${s.frames} frames -> ${path.relative(process.cwd(), outDir)}`
    );
    if (s.contexts === 0) {
      console.error(
        "[ditto] gl-capture: no WebGL context detected. The effect may use Canvas2D, " +
        "CSS, or WebGPU" + (data.webgpu ? " (navigator.gpu is present here)" : "") + "."
      );
    }
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  fail(e && e.stack ? e.stack : String(e), 1);
});
