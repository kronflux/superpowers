import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Operational surfaces only. The allowlist below is history, not code:
// RELEASE-NOTES is a changelog, docs/adr is a committed decision record, and
// .superpowers is local scratch holding plans and specs. Rewriting any of them
// to make a grep return clean would be falsifying the record.
const SCAN_DIRS = ['skills', 'hooks', 'commands', 'agents', 'scripts'];

// plugin.universal.mjs isn't a .md file, so the root markdown glob below
// doesn't pick it up. It's the single source for all hook manifests and must
// be scanned explicitly.
const SCAN_ROOT_EXTRA = ['plugin.universal.mjs'];

// RELEASE-NOTES.md is a changelog: it must keep its historical mentions of
// retired tooling as a record of what shipped and when. Excluding it here is
// deliberate, not an oversight — same rationale as the docs/adr exclusion
// noted above.
const UNSCANNED_ROOT = ['RELEASE-NOTES.md'];

function rootMarkdownFiles() {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !UNSCANNED_ROOT.includes(e.name))
    .map((e) => path.join(ROOT, e.name));
}

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
    ...rootMarkdownFiles(),
    ...SCAN_ROOT_EXTRA.map((f) => path.join(ROOT, f)).filter(fs.existsSync),
  ].filter((f) => !allowed(f));
}

describe('conductor removals', () => {
  it('scans a non-trivial number of files', () => {
    // If skills/, hooks/, or commands/ get renamed and SCAN_DIRS isn't updated,
    // walk() silently returns [] for that dir and the hits-equal-[] assertions
    // below pass trivially — a green suite with zero real coverage. 50 is well
    // under the measured baseline (139 files after the allowlist filter) and
    // only trips on a genuine coverage collapse; if it trips, check whether a
    // directory moved or was renamed before touching this number.
    expect(scanFiles().length).toBeGreaterThan(50);
  });

  it('no operational file references serena', () => {
    const hits = scanFiles().filter((f) => /serena/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('no operational file references obsidian or basic-memory', () => {
    // The authoring conventions in doc-format.md are stated as properties of the
    // markdown itself — what renders on GitHub, what grep and ctx_search can see —
    // so no operational surface names the editor they were compared against.
    const hits = scanFiles()
      .filter((f) => /obsidian|basic[ _-]?memory/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('no operational file references docfork', () => {
    // The docs-MCP fallback tier is generic: any configured docs MCP follows the
    // resolve-then-query shape. Naming one unmaintained provider as the example
    // is what the capability probe and the adapter no longer do.
    const hits = scanFiles().filter((f) => /docfork/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
