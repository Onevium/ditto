#!/usr/bin/env node
/**
 * init-clone.mjs — Scaffold ./clones/<slug>/ workspace + pre-filled NOTES.md
 *
 * Usage:    node scripts/init-clone.mjs <slug> [--url <url>] [--mode M1..M5] [--level L1..L6]
 * Produces: clones/<slug>/{RECON,screenshots,specs}/ + NOTES.md + .gitignore
 * Mode:     Phase 0 (no browser needed)
 *
 * Creates a clone workspace relative to the current working directory
 * (./clones/<slug>/), seeding NOTES.md with the source/license/complexity/mode
 * comparison + replacement + verification template, including the Pre-Clone
 * Prediction block from references/assessment.md.
 */

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  node scripts/init-clone.mjs <slug> [--url <url>] [--mode M1..M5] [--level L1..L6]

Produces (relative to the current directory):
  clones/<slug>/NOTES.md
  clones/<slug>/RECON/
  clones/<slug>/screenshots/
  clones/<slug>/specs/
  clones/<slug>/.gitignore
`);
}

function parseArgs(argv) {
  const out = { slug: null, url: "", mode: "", level: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--url") out.url = argv[++i] || "";
    else if (arg === "--mode") out.mode = argv[++i] || "";
    else if (arg === "--level") out.level = argv[++i] || "";
    else if (!out.slug) out.slug = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

function cleanSlug(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function notesTemplate({ name, url, mode, level }) {
  return `# ${name} · Clone Notes

## Source Info
- Original URL: ${url}
- Source repository:
- Original author:
- License:
- Attribution required:

## Tech Stack
- Framework / key libraries / Node version:

## Pre-Clone Prediction
- Complexity grade: ${level || "L_"}
- Chosen mode: ${mode || "M_"}  (exactly one primary; note any secondary, e.g. "M2 + M4 for hero")
- Evidence grade of the plan: SOURCE / PARTIAL / GUESS
- Expected fidelity range: __–__%   (per viewport if it differs: 1440 / 768 / 390)
- High-fidelity parts: __
- Approximate / substituted parts: __
- Explicitly NOT cloned: __   (backend, auth, payments, proprietary API, licensed media)
- Main risks: license / media / login-state / API / performance / WebGL / responsive

## Run It
\`\`\`bash
cd clones/${name}
python3 -m http.server 8123
\`\`\`

## What Changed (vs original)
-

## Original vs Clone
| Module | Original behavior | Clone implementation | Diff / trade-off | Evidence |
|---|---|---|---|---|
| Hero / first view |  |  |  |  |
| Navigation |  |  |  |  |
| Core animation |  |  |  |  |
| Content sections |  |  |  |  |
| Mobile |  |  |  |  |

## Clone Score
- Source evidence: /5
- Structural fidelity: /5
- Visual fidelity: /5
- Animation / interaction: /5
- Responsiveness: /5
- Feature completeness: /5
- Content replacement: /5
- Legal / deployment risk: /5
- Overall:

## Replacement Map (what to swap, where)
- Text -> file, line
- Images / media -> directory
- Color scheme -> CSS variables / theme
- 3D models / fonts ->

## Verification
- [ ] Runs locally, 0 console errors
- [ ] Screenshots compared against original (screenshots/)
- [ ] Fidelity meets the Pre-Clone Prediction range
- Things that could not be verified (record honestly, do not fabricate):
`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.slug) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  if (args.mode && !/^M[1-5]$/i.test(args.mode)) {
    throw new Error(`Invalid --mode "${args.mode}" (expected M1..M5).`);
  }
  if (args.level && !/^L[1-6]$/i.test(args.level)) {
    throw new Error(`Invalid --level "${args.level}" (expected L1..L6).`);
  }

  const slug = cleanSlug(args.slug);
  if (!slug) throw new Error("Slug is empty after normalization.");
  const name = slug;
  const root = path.resolve(process.cwd(), "clones");
  const project = path.join(root, name);

  if (fs.existsSync(project)) {
    throw new Error(`Project already exists: ${project}`);
  }

  for (const sub of ["RECON", "screenshots", "specs"]) {
    fs.mkdirSync(path.join(project, sub), { recursive: true });
  }

  fs.writeFileSync(
    path.join(project, "NOTES.md"),
    notesTemplate({
      name,
      url: args.url,
      mode: (args.mode || "").toUpperCase(),
      level: (args.level || "").toUpperCase(),
    })
  );
  fs.writeFileSync(
    path.join(project, ".gitignore"),
    "node_modules/\n.DS_Store\n"
  );

  console.log(project);
} catch (error) {
  console.error(`init-clone failed: ${error.message}`);
  process.exit(1);
}
