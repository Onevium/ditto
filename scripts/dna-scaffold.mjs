#!/usr/bin/env node
/**
 * dna-scaffold.mjs — Generate and best-effort prefill design-dna.json from recon
 *
 * Usage:    node scripts/dna-scaffold.mjs --out <design-dna.json> [--recon <label-recon.json>] [--name <site name>]
 * Produces: <out> — the full DNA skeleton (design_system / design_style / visual_effects).
 *           With --recon it prefills fonts / color candidates / framework-effect signals
 *           from real recon evidence; everything else stays "" for the manual Analyze pass.
 * Mode:     M5 (Design-DNA reskin — "keep the DNA, swap the content"). See references/design-dna.md.
 *
 * Discipline: only carry over signals recon actually captured — never fabricate. Color values
 * whose role is uncertain (primary/accent) all go into _recon_signals for a human to assign.
 *
 * Paths are relative to the current clone directory (e.g. ./clones/<slug>/...), never a home dir.
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = { recon: "", out: "", name: "", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--recon") out.recon = argv[++i] || "";
    else if (a === "--out") out.out = argv[++i] || "";
    else if (a === "--name") out.name = argv[++i] || "";
  }
  return out;
}

function usage() {
  console.log(`dna-scaffold.mjs — generate the design-dna.json skeleton and best-effort prefill it

  node scripts/dna-scaffold.mjs --out <design-dna.json> [--recon <label-recon.json>] [--name <site name>]

Only for the "visual reskin / content overhaul" (M5) mode. A faithful mirror does not need DNA
(the real source is the truth). Schema and field meanings: references/design-dna.md.`);
}

// Full DNA skeleton (aligned with references/design-dna.md).
function skeleton(name) {
  const ts = () => ({ size: "", weight: "", line_height: "", tracking: "" });
  return {
    meta: { name: name || "", description: "", source_references: "", created_at: "" },
    design_system: {
      color: {
        palette_type: "",
        primary: { hex: "", role: "" },
        secondary: { hex: "", role: "" },
        accent: { hex: "", role: "" },
        neutral: { scale: "", usage: "" },
        semantic: { success: "", warning: "", error: "", info: "" },
        surface: { background: "", card: "", elevated: "" },
        contrast_strategy: "",
      },
      typography: {
        type_scale: {
          display: ts(), heading_1: ts(), heading_2: ts(), heading_3: ts(),
          body: ts(), body_small: ts(), caption: ts(), overline: ts(),
        },
        font_families: { heading: "", body: "", mono: "" },
        font_style_notes: "",
      },
      spacing: { base_unit: "", scale: "", content_density: "", section_rhythm: "" },
      layout: { grid_system: "", max_content_width: "", columns: "", gutter: "", breakpoints: "", alignment_tendency: "" },
      shape: { border_radius: { small: "", medium: "", large: "", pill: "" }, border_usage: "", divider_style: "" },
      elevation: { shadow_style: "", levels: { low: "", medium: "", high: "" }, depth_cues: "" },
      iconography: { style: "", stroke_weight: "", size_scale: "", preferred_set: "" },
      motion: { easing: "", duration_scale: { micro: "", normal: "", macro: "" }, entrance_pattern: "", exit_pattern: "", philosophy: "" },
      components: { button_style: "", input_style: "", card_style: "", navigation_pattern: "", modal_style: "", list_style: "", component_notes: "" },
    },
    design_style: {
      aesthetic: { mood: [], visual_metaphor: "", era_influence: "", genre: "", personality_traits: [], adjectives: [] },
      visual_language: { complexity: "", ornamentation: "", whitespace_usage: "", visual_weight_distribution: "", focal_strategy: "", contrast_level: "", texture_usage: "" },
      composition: { hierarchy_method: "", balance_type: "", flow_direction: "", grouping_strategy: "", negative_space_role: "" },
      imagery: { photo_treatment: "", illustration_style: "", graphic_elements: "", pattern_usage: "", image_shape: "" },
      interaction_feel: { feedback_style: "", hover_behavior: "", transition_personality: "", loading_style: "", microinteraction_density: "" },
      brand_voice_in_ui: { tone: "", formality: "", cta_style: "", empty_state_approach: "", error_tone: "" },
    },
    visual_effects: {
      overview: { effect_intensity: "", performance_tier: "", fallback_strategy: "", primary_technology: "" },
      background_effects: { type: "", description: "", technology: "", params: { color_palette: "", speed: "", density: "", opacity: "", blend_mode: "" } },
      particle_systems: { enabled: false, type: "", description: "", technology: "", params: { count: "", shape: "", size_range: "", movement_pattern: "", color_behavior: "", interaction: "", spawn_area: "" } },
      "3d_elements": { enabled: false, type: "", description: "", technology: "", params: { renderer: "", lighting: "", camera: "", materials: "", geometry: "", post_processing: [], interaction_model: "" } },
      shader_effects: { enabled: false, type: "", description: "", technology: "", params: { uniforms: "", vertex_manipulation: "", fragment_output: "", noise_type: "", distortion: "" } },
      scroll_effects: { parallax: { enabled: false, layers: "", depth_range: "", speed_curve: "" }, scroll_triggered_animations: { enabled: false, trigger_points: "", animation_type: "", scrub_behavior: "" }, scroll_morphing: { enabled: false, description: "" } },
      text_effects: { type: "", description: "", technology: "", params: { split_strategy: "", animation_per_unit: "", stagger: "", effect_style: "" } },
      cursor_effects: { enabled: false, type: "", description: "", params: { shape: "", size: "", blend_mode: "", trail: "", interaction_zone: "" } },
      image_effects: { type: "", description: "", technology: "", params: { filter_pipeline: "", hover_transform: "", reveal_animation: "", distortion_type: "" } },
      glassmorphism_neumorphism: { enabled: false, style: "", params: { blur_radius: "", transparency: "", border_treatment: "", shadow_type: "", light_source_angle: "" } },
      canvas_drawings: { enabled: false, type: "", description: "", technology: "", params: { draw_method: "", animation_loop: "", color_scheme: "", responsiveness: "", interaction: "" } },
      svg_animations: { enabled: false, type: "", description: "", params: { animation_method: "", path_morphing: "", stroke_animation: "", filter_effects: "" } },
      composite_notes: "",
    },
  };
}

const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\))/;

// recon.mjs nests signals per viewport under captures[].signals; flatten the widest viewport.
// Also tolerates recon inputs that are already flat. If flattening fails, return as-is
// (enrich() is defensive about missing fields).
function flattenRecon(recon) {
  if (recon && Array.isArray(recon.captures) && recon.captures.length) {
    const widest = recon.captures
      .filter((c) => c && c.signals)
      .sort((a, b) => (b?.viewport?.width || 0) - (a?.viewport?.width || 0))[0];
    if (widest && widest.signals) {
      // Fall back to the top-level url as href so meta.source_references can prefill.
      return { href: recon.url, ...widest.signals };
    }
  }
  return recon;
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

// Best-effort extract signals from recon JSON and prefill the fields the skeleton can prove.
function enrich(dna, recon) {
  const signals = { fonts: [], color_candidates: [], frameworks: {}, canvas_count: 0, css_color_vars: [] };

  // Fonts: fonts[] + sections[].style.fontFamily
  const fontList = uniq([
    ...(Array.isArray(recon.fonts) ? recon.fonts : []),
    ...((recon.sections || []).map((s) => s?.style?.fontFamily).filter(Boolean)),
  ]).map((f) => String(f).replace(/^["']|["']$/g, "").split(",")[0].trim()).filter(Boolean);
  signals.fonts = uniq(fontList);
  if (signals.fonts.length) {
    const mono = signals.fonts.find((f) => /mono|code|consol|courier/i.test(f)) || "";
    const nonMono = signals.fonts.filter((f) => f !== mono);
    dna.design_system.typography.font_families.heading = nonMono[0] || "";
    dna.design_system.typography.font_families.body = nonMono[1] || nonMono[0] || "";
    dna.design_system.typography.font_families.mono = mono;
  }

  // Colors: color-valued CSS variables + section background/foreground.
  const cssVars = Array.isArray(recon.cssVariables) ? recon.cssVariables : [];
  for (const pair of cssVars) {
    const [name, val] = Array.isArray(pair) ? pair : [pair?.name, pair?.value];
    if (val && COLOR_RE.test(String(val))) signals.css_color_vars.push(`${name}: ${String(val).trim()}`);
  }
  const sectionColors = [];
  for (const s of recon.sections || []) {
    const bg = s?.style?.backgroundColor;
    const fg = s?.style?.color;
    if (bg && !/rgba?\(0, 0, 0, 0\)|transparent/i.test(bg)) sectionColors.push(bg);
    if (fg) sectionColors.push(fg);
  }
  signals.color_candidates = uniq([
    ...signals.css_color_vars.map((v) => v.split(":").slice(1).join(":").trim()),
    ...sectionColors,
  ]).slice(0, 24);
  // First non-transparent section background is a surface.background candidate.
  const firstBg = (recon.sections || []).map((s) => s?.style?.backgroundColor)
    .find((c) => c && !/rgba?\(0, 0, 0, 0\)|transparent/i.test(c));
  if (firstBg) dna.design_system.color.surface.background = firstBg;

  // Framework / effect signals.
  const fw = recon.frameworks || {};
  signals.frameworks = fw;
  signals.canvas_count = (recon.canvases && recon.canvases.length) || recon?.counts?.canvas || 0;

  if (fw.three) {
    dna.visual_effects.overview.primary_technology = "WebGL/Three.js";
    dna.visual_effects.overview.performance_tier = "heavy";
    dna.visual_effects["3d_elements"].enabled = true;
    dna.visual_effects["3d_elements"].technology = "Three.js";
  } else if (signals.canvas_count > 0) {
    dna.visual_effects.overview.primary_technology = "Canvas 2D";
    dna.visual_effects.canvas_drawings.enabled = true;
  } else if (fw.gsap) {
    dna.visual_effects.overview.primary_technology = "GSAP";
  }
  if (fw.gsap || fw.lenis) {
    dna.visual_effects.scroll_effects.scroll_triggered_animations.enabled = true;
    dna.visual_effects.scroll_effects.scroll_triggered_animations.scrub_behavior =
      fw.lenis ? "lenis smooth-scroll detected" : "gsap detected";
  }

  // meta prefill
  if (recon.href) dna.meta.source_references = recon.href;
  if (!dna.meta.name && recon.title) dna.meta.name = recon.title;

  // Keep the raw signals at top level for a human to assign roles (never fabricate primary/accent).
  dna._recon_signals = signals;
  dna._scaffold_note =
    "Best-effort prefill from recon. font_families / surface.background / visual_effects were " +
    "written from real signals; color primary/secondary/accent roles must be assigned by a human " +
    "from _recon_signals.color_candidates; all \"\" fields need a manual Analyze pass " +
    "(see references/design-dna.md). Delete _recon_signals and this note once verified.";
  return dna;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.out) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  let dna = skeleton(args.name);
  if (args.recon) {
    try {
      const recon = JSON.parse(fs.readFileSync(path.resolve(args.recon), "utf8"));
      dna = enrich(dna, flattenRecon(recon));
    } catch (e) {
      console.warn(`Warning: could not read recon (${e.message}); emitting an empty skeleton only.`);
    }
  }
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(dna, null, 2)}\n`);
  console.log(`design-dna skeleton written: ${outPath}`);
  if (dna._recon_signals) {
    const s = dna._recon_signals;
    console.log(`  prefilled: ${s.fonts.length} font(s) / ${s.color_candidates.length} color candidate(s) / canvas ${s.canvas_count} / three=${!!s.frameworks.three} gsap=${!!s.frameworks.gsap} lenis=${!!s.frameworks.lenis}`);
  }
  console.log(`  next: manually Analyze the "" fields and assign color roles from _recon_signals. Schema -> references/design-dna.md`);
} catch (e) {
  console.error(`dna-scaffold failed: ${e.message}`);
  process.exit(1);
}
