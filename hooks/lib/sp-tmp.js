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
  try {
    // Never create or write through a symlinked root: an attacker who
    // pre-creates it pointing at a directory we can write to would otherwise
    // get us writing state into their directory silently.
    if (fs.lstatSync(dir).isSymbolicLink()) return dir;
  } catch { /* doesn't exist yet */ }
  // Failing open matters more than reporting: every caller already wraps its
  // write in try/catch, so a creation failure surfaces there as the same
  // no-op it would have been before this directory existed.
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // A stray non-directory at this path (e.g. a regular file) makes mkdir
    // fail every time and silently breaks every writer under this root.
    // Clear it and retry once; if that also fails, still return the path.
    try {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() && !st.isSymbolicLink()) {
        fs.rmSync(dir, { force: true });
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch { /* caller's write handles it */ }
  }
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
 *
 * Exported on its own so every site that needs to build or match a name
 * from a raw session id (session-end-cleanup.js, tmp-reaper.js's isLive) goes
 * through the same transform `spTmp()` applies — a private, differently-scoped
 * filter at any of those sites would let a name that `spTmp()` sanitizes one
 * way be built or matched another way.
 */
function spSafe(name) {
  let safe = String(name).replace(/[^A-Za-z0-9._-]/g, '_');
  if (safe === '' || safe === '.' || safe === '..') safe = `_${safe}`;
  return safe;
}

function spTmp(name) {
  return path.join(spTmpDir(), spSafe(name));
}

export { ROOT_NAME, spTmpDir, spTmp, spSafe };
