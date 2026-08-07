import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Operational surfaces only. The allowlist below is history, not code:
// RELEASE-NOTES is a changelog, docs/adr and docs/superpowers are a committed
// design archive, .superpowers is local scratch. Rewriting any of them to make
// a grep return clean would be falsifying the record.
const SCAN_DIRS = ['skills', 'hooks', 'commands'];
const SCAN_ROOT_FILES = ['README.md', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'plugin.universal.mjs'];

// Two files MUST name the legacy keys: they exist to explain that logs written
// before 7.8.0 still carry `serena` and `obsidian` and are read, never
// rewritten. Scrubbing the names out of them would make the tolerance
// undocumented, which is the opposite of the point.
const ALLOWLIST = [
  path.join('hooks', 'usage-aggregator.js'),
  path.join('commands', 'usage.md'),
];

function allowed(file) {
  const rel = path.relative(ROOT, file);
  return ALLOWLIST.includes(rel);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function scanFiles() {
  return [
    ...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
    ...SCAN_ROOT_FILES.map((f) => path.join(ROOT, f)).filter(fs.existsSync),
  ].filter((f) => !allowed(f));
}

describe('conductor removals', () => {
  it('no operational file references serena', () => {
    const hits = scanFiles().filter((f) => /serena/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('no operational file references obsidian-cli or basic-memory', () => {
    // Bare "Obsidian" is allowed: doc-format.md legitimately explains that its
    // callout vocabulary renders in both GitHub and Obsidian. The tooling names
    // are what must not come back.
    const hits = scanFiles()
      .filter((f) => /obsidian-cli|basic-?memory/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
