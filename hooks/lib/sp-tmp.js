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

/**
 * Absolute path to `name` inside the plugin temp root.
 *
 * `name` is sanitized here — not left to each caller — because callers build
 * it from session ids that ultimately trace back to hook stdin. Anything
 * outside [A-Za-z0-9._-] becomes `_`, which removes every path separator
 * (`/`, `\`) from the input, so a multi-segment traversal payload (e.g.
 * `../../evil`) collapses to a single literal filename rather than walking
 * anywhere. That charset has to keep `.` for names like `stop-<sid>.lock`,
 * which leaves one gap a plain character filter can't close: a sanitized
 * result of exactly `.`, `..`, or `` (empty) is itself a directory reference
 * and `path.join(root, '..')` walks out one level. Those three exact values
 * are neutralized with a `_` prefix after sanitizing. Every name currently in
 * use (usage-, stop-, ctx-, conductor-, compress- plus their session-id/class
 * suffixes) is already outside this edge case, so this is a no-op for real
 * callers.
 */
function spTmp(name) {
  let safe = String(name).replace(/[^A-Za-z0-9._-]/g, '_');
  if (safe === '' || safe === '.' || safe === '..') safe = `_${safe}`;
  return path.join(spTmpDir(), safe);
}

export { ROOT_NAME, spTmpDir, spTmp };
