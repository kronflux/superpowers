// hooks/lib/sp-tmp.js — the only sanctioned way to name a plugin temp path.
//
// Every plugin tmpfile lives under one directory rather than being scattered
// across the shared temp root behind an `sp-` prefix. That is what makes the
// reaper safe: it deletes by enumerating a directory we created and own, so a
// wrong pattern cannot reach another tool's files. Prefix matching against the
// shared root has no such floor.
//
// tests/tmp-namespace.test.js enforces that nothing else in hooks/ or tests/
// calls os.tmpdir() directly.
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT_NAME = 'sp';

/** Absolute path to the plugin temp root, created on demand. */
function spTmpDir() {
  const dir = path.join(os.tmpdir(), ROOT_NAME);
  // Failing open matters more than reporting: every caller already wraps its
  // write in try/catch, so a creation failure surfaces there as the same
  // no-op it would have been before this directory existed.
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* caller's write handles it */ }
  return dir;
}

/** Absolute path to `name` inside the plugin temp root. */
function spTmp(name) {
  return path.join(spTmpDir(), name);
}

export { ROOT_NAME, spTmpDir, spTmp };
