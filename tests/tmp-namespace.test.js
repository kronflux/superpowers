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

describe('tmp namespace', () => {
  it('scans a non-trivial number of files', () => {
    // Without this, a broken walk would make the guard below pass on nothing.
    expect(scanned().length).toBeGreaterThan(30);
  });

  it('nothing outside sp-tmp.js reaches os.tmpdir directly', () => {
    const hits = scanned()
      .filter((f) => /os\.tmpdir\s*\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
