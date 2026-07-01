#!/usr/bin/env node
/**
 * audit-clone.mjs — Pre-deploy residue scanner (trackers/brand/placeholders)
 *
 * Recursively walks a clone's source tree and greps every text/source file for
 * residue that must not survive into a shipped clone: analytics/tracking scripts,
 * original-brand names/trademarks, placeholder/TODO/lorem copy, configurable
 * source-language residue, and outbound external URLs (with special attention to
 * links that still point back at the original origin).
 *
 * Usage:
 *   node scripts/audit-clone.mjs <dir> [options]
 *   node scripts/audit-clone.mjs --project clones/<slug> --brand "OriginalBrand,ACME"
 *
 * Options:
 *   <dir> | --project <dir>   Clone directory to scan   (default: cwd)
 *   --brand "A,B,C"           Original brand term(s) to flag; comma-separated or repeatable
 *   --origin <host-or-url>    Flag external URLs still pointing at the original origin
 *   --residue "label=regex"   Configurable residue rule(s); repeatable. Example:
 *                               --residue "japanese=[\\u3040-\\u30ff]{2,}"
 *   --out <file>              Report path            (default: CLONE_AUDIT.md in cwd)
 *   -h, --help               Show this help
 *
 * Produces: CLONE_AUDIT.md — findings grouped by type as `relative/path:line · label · match`.
 * Mode:     Verify
 *
 * Exit code: 0 on success (report written, even with findings), 1 on bad input/IO error.
 */

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  node scripts/audit-clone.mjs <dir> [--brand "OriginalBrand,ACME"] [--origin example.com]
                                     [--residue "label=regex"]... [--out CLONE_AUDIT.md]

Scans a clone's source files for tracking scripts, original-brand residue, TODO/placeholder
copy, configurable source-language residue, and risky external dependencies.
`);
}

function parseArgs(argv) {
  const out = { project: null, brand: [], origin: null, residue: [], out: "CLONE_AUDIT.md" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--project") out.project = argv[++i];
    else if (arg === "--brand") out.brand.push(...(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (arg === "--origin") out.origin = argv[++i] || null;
    else if (arg === "--residue") out.residue.push(argv[++i] || "");
    else if (arg === "--out") out.out = argv[++i] || "CLONE_AUDIT.md";
    else if (arg.startsWith("-")) throw new Error(`Unexpected option: ${arg}`);
    else if (out.project === null) out.project = arg; // first positional = <dir>
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (out.project === null) out.project = process.cwd();
  return out;
}

const includeExt = new Set([
  ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".json", ".md", ".txt", ".svg", ".vue", ".astro",
]);
const skipDirs = new Set([
  ".git", "node_modules", "dist", "build", ".next", ".nuxt", "coverage",
  "RECON", "screenshots", ".cache", ".vercel", ".output",
]);
const skipFiles = new Set([
  "NOTES.md", "TEARDOWN.md", "CLONE_REPORT.md", "CLONE_AUDIT.md", "REPLACE_GUIDE.md",
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (!skipFiles.has(entry.name) && includeExt.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

// Escape a literal string for safe embedding in a RegExp.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Parse a --residue "label=regex" spec. If no "=" is present, the whole string
// is treated as the pattern and a generic label is used.
function parseResidueRule(spec) {
  const eq = spec.indexOf("=");
  if (eq === -1) return { label: "source-language residue", pattern: spec };
  return { label: spec.slice(0, eq).trim() || "source-language residue", pattern: spec.slice(eq + 1) };
}

// Normalize an --origin value (URL or bare host) to a comparable hostname.
function originHost(origin) {
  if (!origin) return null;
  try {
    return new URL(origin.includes("://") ? origin : `https://${origin}`).hostname.replace(/^www\./, "");
  } catch {
    return origin.replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

function collectMatches(file, text, checks, originHostName) {
  const findings = [];
  for (const check of checks) {
    const regex = new RegExp(check.pattern, check.flags || "gi");
    for (const match of text.matchAll(regex)) {
      const matchedText = String(match[0]);
      let type = check.type;
      let label = check.label;
      if (check.type === "external") {
        // W3C namespaces (xmlns, xlink) are schema noise, not real outbound links.
        if (/^https?:\/\/(www\.)?w3\.org\//i.test(matchedText)) continue;
        // Local/dev hosts are expected during clone bring-up.
        if (/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/i.test(matchedText)) continue;
        // Escalate links that still point back at the original origin.
        if (originHostName) {
          try {
            const host = new URL(matchedText).hostname.replace(/^www\./, "");
            if (host === originHostName || host.endsWith(`.${originHostName}`)) {
              type = "origin";
              label = `still points at original origin (${originHostName})`;
            }
          } catch {
            // Malformed URL — leave as a plain external finding.
          }
        }
      }
      findings.push({
        type,
        label,
        file,
        line: lineNumber(text, match.index || 0),
        match: matchedText.slice(0, 160),
      });
    }
  }
  return findings;
}

function markdown(findings, project, scannedFiles) {
  const byType = new Map();
  for (const finding of findings) {
    if (!byType.has(finding.type)) byType.set(finding.type, []);
    byType.get(finding.type).push(finding);
  }
  const types = [
    ["tracking", "Tracking scripts / analytics pixels"],
    ["brand", "Original brand residue"],
    ["origin", "Links back to original origin"],
    ["residue", "Source-language residue"],
    ["todo", "TODO / placeholder content"],
    ["external", "External dependencies / outbound links"],
  ];
  const blockers = (byType.get("tracking")?.length || 0) + (byType.get("brand")?.length || 0) + (byType.get("origin")?.length || 0);

  const lines = [
    `# Clone Audit`,
    "",
    `- Project: ${project}`,
    `- Scanned files: ${scannedFiles}`,
    `- Findings: ${findings.length}`,
    `- Blocking (tracking + brand + origin): ${blockers}`,
    "",
  ];

  for (const [type, title] of types) {
    const items = byType.get(type) || [];
    lines.push(`## ${title}`);
    if (!items.length) {
      lines.push("- none found");
      lines.push("");
      continue;
    }
    for (const item of items.slice(0, 200)) {
      const rel = path.relative(project, item.file) || path.basename(item.file);
      lines.push(`- ${rel}:${item.line} · ${item.label} · \`${item.match.replaceAll("`", "'")}\``);
    }
    if (items.length > 200) lines.push(`- …and ${items.length - 200} more not shown`);
    lines.push("");
  }

  lines.push("## Verdict");
  if (blockers > 0) {
    lines.push(`- NOT deployable: ${blockers} blocking residue item(s). Strip trackers, replace brand/origin references, then re-run.`);
  } else if (findings.length > 0) {
    lines.push("- No blocking residue. Triage remaining placeholder/external items before shipping; confirm asset licensing manually.");
  } else {
    lines.push("- No residue found. Still verify asset licensing and visual screenshots manually.");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const project = path.resolve(args.project);
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw new Error(`Project directory not found: ${project}`);
  }

  const originHostName = originHost(args.origin);

  const brandPatterns = args.brand.map((brand) => ({
    type: "brand",
    label: `brand residue: ${brand}`,
    pattern: escapeRegex(brand),
    flags: "gi",
  }));

  const residuePatterns = args.residue
    .map(parseResidueRule)
    .filter((rule) => rule.pattern)
    .map((rule) => ({ type: "residue", label: rule.label, pattern: rule.pattern, flags: "g" }));

  const checks = [
    { type: "tracking", label: "Google Tag Manager", pattern: "googletagmanager|gtm\\.start", flags: "gi" },
    { type: "tracking", label: "Google Analytics / gtag", pattern: "google-analytics|gtag\\s*\\(|\\bga\\s*\\(", flags: "gi" },
    // Measurement IDs must stay CASE-SENSITIVE (no `i` flag): a lowercase `g-...` is
    // ordinary text (e.g. the surname "Wong-Godfrey"), not a GA4 tag.
    { type: "tracking", label: "Tracking measurement ID", pattern: "GTM-[A-Z0-9]{5,}|G-[A-Z0-9]{8,}|UA-\\d{4,}-\\d+", flags: "g" },
    { type: "tracking", label: "Meta Pixel / fbq", pattern: "connect\\.facebook\\.net|fbq\\s*\\(", flags: "gi" },
    { type: "tracking", label: "Hotjar", pattern: "hotjar|hj\\s*\\(", flags: "gi" },
    { type: "tracking", label: "Microsoft Clarity", pattern: "clarity\\.ms|clarity\\s*\\(", flags: "gi" },
    { type: "todo", label: "TODO / placeholder content", pattern: "TODO|FIXME|XXX|lorem ipsum|placeholder", flags: "gi" },
    { type: "external", label: "external URL", pattern: "https?://[^\\s\"')<>]+", flags: "gi" },
    ...residuePatterns,
    ...brandPatterns,
  ];

  const files = walk(project);
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue; // Unreadable/binary file — skip.
    }
    findings.push(...collectMatches(file, text, checks, originHostName));
  }

  const output = path.resolve(args.out);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, markdown(findings, project, files.length));
  console.log(output);
}

try {
  main();
} catch (error) {
  console.error(`audit-clone failed: ${error.message}`);
  process.exit(1);
}
