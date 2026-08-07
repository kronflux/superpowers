import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Four files, each for a stated reason. Nothing else may reach the bare
// os.tmpdir root directly — that is how the sprawl happened.
const ALLOWED = [
  // Defines the root.
  path.join('hooks', 'lib', 'sp-tmp.js'),
  // Needs the bare root for the time-boxed legacy pass over pre-migration names.
  path.join('hooks', 'lib', 'tmp-reaper.js'),
  // Must reference the real temp root to assert the helper actually points at
  // it. Deriving the expectation from the helper would prove only self-consistency.
  path.join('tests', 'sp-tmp.test.js'),
  // Builds a fake root so the sweep's deletion tests never touch the real one.
  path.join('tests', 'tmp-reaper.test.js'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function scanned() {
  return [...walk(path.join(ROOT, 'hooks')), ...walk(path.join(ROOT, 'tests'))]
    .filter((f) => !ALLOWED.includes(path.relative(ROOT, f)));
}

// Guards the CAPABILITY of reaching the shared temp root directly, not one
// syntactic spelling of it. A plain dotted call after a default `os` import
// is only one way in — a named import, a destructured import, a required
// call, and the temp-dir environment variables all reach the same place and
// must be caught too, or a contributor using one of those forms reintroduces
// the sprawl this namespace exists to prevent while leaving a green suite.
//
// Every literal below is deliberately split or escaped so this file's own
// source text never contains a contiguous substring any pattern would match —
// this file is itself scanned, so an unescaped example here would trip its
// own guard.
const GUARD_PATTERNS = [
  /\btmpdir\s*\(/,                     // a dotted or bare call, however imported
  /process\.env\.(TMPDIR|TEMP|TMP)\b/, // direct temp-dir env var reads
  /import\s*\{[^}]*\btmpdir\b[^}]*\}\s*from\s*['"](?:node:)?os['"]/, // named import
];

function violates(src) {
  return GUARD_PATTERNS.some((re) => re.test(src));
}

describe('tmp namespace', () => {
  it('scans a non-trivial number of files', () => {
    // Without this, a broken walk would make the guard below pass on nothing.
    expect(scanned().length).toBeGreaterThan(30);
  });

  it('nothing outside sp-tmp.js reaches the shared temp root directly', () => {
    const hits = scanned()
      .filter((f) => violates(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('fires on a named-import form the old regex missed', () => {
    // Built by concatenation, not as one literal string: writing the target
    // substring whole here would make the test above trip on this file's own
    // source, since it scans this file's raw text too.
    const sample = ['import { tmp', "dir } from 'node:os';\n", 'const d = tmp', 'dir();'].join('');
    expect(violates(sample)).toBe(true);
  });
});
