#!/usr/bin/env node
/**
 * sync-skills.mjs — Regenerate per-platform command files from SKILL.md
 *
 * Usage:    node scripts/sync-skills.mjs [--check]
 * Produces: dist/<platform>/... command files with AUTO-GENERATED headers.
 * Mode:     Distribution
 *
 * Source of truth: <repo>/SKILL.md (frontmatter: name / description / argument-hint).
 * Emits one command/skill file per supported AI coding platform:
 *   - Codex CLI, GitHub Copilot ...... verbatim SKILL.md
 *   - Cursor, Windsurf ............... plain markdown (no $ARGUMENTS substitution)
 *   - Gemini CLI ..................... TOML ({{args}} for arguments)
 *   - OpenCode, Augment, Continue .... markdown + YAML frontmatter
 *   - Amazon Q ....................... JSON agent definition
 *
 * With --check, nothing is written: the script recomputes every target and exits
 * non-zero if any on-disk file is missing or stale (intended for CI).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Resolve paths relative to this script (portable, no personal paths) ---

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const BASE = ROOT; // SKILL.md lives at the repo root
const SOURCE = join(BASE, 'SKILL.md');
const DIST = join(ROOT, 'dist');

// --- CLI ---

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const unknown = args.filter((a) => a !== '--check');
if (unknown.length) {
  console.error(`Error: unknown argument(s): ${unknown.join(', ')}`);
  console.error('Usage: node scripts/sync-skills.mjs [--check]');
  process.exit(1);
}

// --- Read source ---

let raw;
try {
  raw = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
} catch {
  console.error(`Error: source skill not found at ${relative(process.cwd(), SOURCE)}`);
  process.exit(1);
}

const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!fmMatch) {
  console.error('Error: could not parse SKILL.md frontmatter (missing --- fences)');
  process.exit(1);
}

const frontmatter = parseFrontmatter(fmMatch[1]);
const body = fmMatch[2];

const name = frontmatter.name || 'clone-website';
const description = collapse(frontmatter.description || '');
const argumentHint = frontmatter['argument-hint'] || '<url>';

if (!description) {
  console.error('Error: SKILL.md frontmatter is missing a `description`.');
  process.exit(1);
}

// --- Minimal YAML frontmatter parser (inline + folded/literal block scalars) ---

function parseFrontmatter(text) {
  const lines = text.split('\n');
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s/.test(line)) continue; // skip blanks + indented (handled below)
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];

    if (/^[|>][+-]?$/.test(value.trim())) {
      // Block scalar: gather following indented lines.
      const folded = value.trim()[0] === '>';
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() && !/^\s/.test(l)) break; // dedented -> next key
        block.push(l.replace(/^\s{1,}/, ''));
      }
      i = j - 1;
      value = folded ? block.join(' ') : block.join('\n');
    }
    out[key] = collapse(unquote(value));
  }
  return out;
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function jsonString(s) {
  return JSON.stringify(String(s));
}

// --- Header / argument substitution helpers ---

const REGEN_HINT = 'node scripts/sync-skills.mjs';

const MD_HEADER =
  `<!-- AUTO-GENERATED from SKILL.md — do not edit directly.\n` +
  `     Run \`${REGEN_HINT}\` to regenerate. -->\n\n`;

const HASH_HEADER =
  `# AUTO-GENERATED from SKILL.md — do not edit directly.\n` +
  `# Run \`${REGEN_HINT}\` to regenerate.\n\n`;

// Platforms without native $ARGUMENTS support get a human-readable stand-in.
const noArgs = (text) =>
  text.replace(/\$ARGUMENTS/g, 'the target URL(s) provided by the user');

// --- Build the set of target files (path relative to dist/ -> content) ---

function buildTargets() {
  const targets = [];
  const add = (relPath, content) => targets.push({ relPath, content });

  // 1 & 2. Codex CLI + GitHub Copilot — verbatim SKILL.md (native skill format).
  add(join('codex', 'skills', name, 'SKILL.md'), raw);
  add(join('github', 'skills', name, 'SKILL.md'), raw);

  // 3. Cursor — plain markdown command, no argument substitution.
  add(join('cursor', 'commands', `${name}.md`), MD_HEADER + noArgs(body));

  // 4. Windsurf — markdown workflow.
  add(join('windsurf', 'workflows', `${name}.md`), MD_HEADER + noArgs(body));

  // 5. Gemini CLI — TOML, {{args}} for arguments.
  const geminiBody = body.replace(/\$ARGUMENTS/g, '{{args}}');
  add(
    join('gemini', 'commands', `${name}.toml`),
    HASH_HEADER +
      `description = ${jsonString(description)}\n` +
      `name = ${jsonString(name)}\n\n` +
      `prompt = '''\n${geminiBody}\n'''\n`
  );

  // 6. OpenCode — markdown + YAML frontmatter, $ARGUMENTS works natively.
  add(
    join('opencode', 'commands', `${name}.md`),
    `---\ndescription: ${jsonString(description)}\n---\n${MD_HEADER}${body}`
  );

  // 7. Augment Code — markdown + YAML frontmatter with argument-hint.
  add(
    join('augment', 'commands', `${name}.md`),
    `---\ndescription: ${jsonString(description)}\n` +
      `argument-hint: ${jsonString(argumentHint)}\n---\n${MD_HEADER}${body}`
  );

  // 8. Continue — prompt file with invokable: true.
  add(
    join('continue', 'commands', `${name}.md`),
    `---\nname: ${name}\ndescription: ${jsonString(description)}\n` +
      `invokable: true\n---\n${MD_HEADER}${body}`
  );

  // 9. Amazon Q — JSON agent definition (JSON has no comments, so mark via _generated).
  add(
    join('amazonq', 'cli-agents', `${name}.json`),
    JSON.stringify(
      {
        _generated: `AUTO-GENERATED from SKILL.md — run \`${REGEN_HINT}\` to regenerate.`,
        name,
        description,
        prompt: noArgs(body),
        fileContext: ['SKILL.md', 'AGENTS.md', 'references/**', 'scripts/**'],
      },
      null,
      2
    ) + '\n'
  );

  return targets;
}

// --- Run ---

const targets = buildTargets();

if (CHECK) {
  const stale = [];
  for (const { relPath, content } of targets) {
    const full = join(DIST, relPath);
    const current = existsSync(full) ? readFileSync(full, 'utf8') : null;
    if (current !== content) {
      stale.push({ relPath, reason: current === null ? 'missing' : 'stale' });
    }
  }
  if (stale.length) {
    console.error('Error: generated platform files are out of date:');
    for (const s of stale) console.error(`  ✗ dist/${s.relPath} (${s.reason})`);
    console.error(`\nRun \`${REGEN_HINT}\` and commit the result.`);
    process.exit(1);
  }
  console.log(`OK: ${targets.length} platform files are up to date.`);
  process.exit(0);
}

console.log(`Syncing "${name}" skill to all platforms...`);
console.log(`  Source: ${relative(process.cwd(), SOURCE)}\n`);

for (const { relPath, content } of targets) {
  const full = join(DIST, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  console.log(`  ✓ dist/${relPath}`);
}

console.log(`\nDone! ${targets.length} platform command files generated from SKILL.md.`);
