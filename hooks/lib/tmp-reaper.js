// hooks/lib/tmp-reaper.js — age-based reaping of the plugin temp root.
//
// The search root is <tmpdir>/sp/, a directory this plugin creates and owns.
// That confinement is the whole safety story: the sweep enumerates a directory
// rather than pattern-matching the shared temp root, so no bug here can reach
// another tool's files.
//
// The age threshold doubles as the concurrency guard. A second session running
// while this one sweeps has files minutes old, far inside any retention window,
// so the dangerous case is unreachable rather than merely handled — no lock and
// no cross-session coordination needed.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ROOT_NAME, spSafe } from './sp-tmp.js';

const DEFAULT_RETENTION_DAYS = 7;
const THROTTLE_MS = 24 * 60 * 60 * 1000;
const MARKER = '.last-sweep';
const DAY_MS = 86400000;

// Pre-migration flat names in the SHARED temp root. Exact prefixes, never a
// wildcard: this is the only code that looks outside our own directory, and it
// exists to clean up after ourselves once. Delete this list — and the pass that
// uses it — once installs have rolled past the migration.
//
// 'sp-mw-' is the one exception: it is CURRENT, not legacy.
// scripts/middleware-exec.mjs still creates its CLI-subprocess working
// directory directly under the bare temp root (a deliberate, documented gap —
// see docs/ARCHITECTURE.md), so this is its only aging backstop against a
// SIGKILL or crash between mkdtemp and its own cleanup. Do not remove it when
// the rest of this list is retired.
const LEGACY_PREFIXES = [
  'sp-usage-', 'sp-stop-', 'sp-ctx-', 'sp-conductor-', 'sp-compress-', 'sp-safety-hooks-',
  'sp-mw-',
];

function retentionMs(env) {
  let raw = env.SUPERPOWERS_TMP_RETENTION_DAYS;
  if (typeof raw === 'string') raw = raw.trim();
  if (raw === undefined || raw === '') return DEFAULT_RETENTION_DAYS * DAY_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_DAYS * DAY_MS;
  return n * DAY_MS;
}

function isThrottled(markerPath, now) {
  try {
    return now - fs.statSync(markerPath).mtimeMs < THROTTLE_MS;
  } catch {
    return false; // no marker yet — first sweep
  }
}

/**
 * @param {object} opts
 * @param {object} [opts.env]        environment (for SUPERPOWERS_TMP_RETENTION_DAYS)
 * @param {number} [opts.now]        clock injection for tests
 * @param {string} [opts.sessionId]  live session; entries naming it are never removed
 * @param {boolean} [opts.force]     bypass the 24h throttle
 * @param {string} [opts.tmpRoot]    temp root injection for tests
 */
function sweep(opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now ?? Date.now();
  const sessionId = opts.sessionId || '';
  const tmpRoot = opts.tmpRoot || os.tmpdir();
  const result = { removed: 0, legacy: 0, skipped: null };

  try {
    const ms = retentionMs(env);
    if (ms === 0) { result.skipped = 'disabled'; return result; }

    const root = path.join(tmpRoot, ROOT_NAME);
    const markerPath = path.join(root, MARKER);
    if (!opts.force && isThrottled(markerPath, now)) {
      result.skipped = 'throttled';
      return result;
    }

    const stale = (full) => {
      try { return now - fs.statSync(full).mtimeMs > ms; } catch { return false; }
    };
    // Exact-segment match against the sanitized id, not a raw substring test:
    // spTmp() may have sanitized the live session's id differently than a
    // caller's raw id would compare (e.g. a `.` in the id), so build the
    // known name shapes from spSafe(sessionId) and require the whole
    // session-id segment to match, not merely appear somewhere in the name.
    // Checked against both the current `<name>` form and the pre-migration
    // `sp-<name>` flat form, since isLive guards both passes below.
    const sid = sessionId ? spSafe(sessionId) : '';
    const liveShapes = sid ? [
      `usage-${sid}`, `stop-${sid}.lock`, `ctx-${sid}.json`,
      `conductor-${sid}`, `compress-${sid}.json`,
    ] : [];
    const isLive = (name) => {
      if (!sid) return false;
      if (liveShapes.includes(name) || liveShapes.some((s) => name === `sp-${s}`)) return true;
      return name.startsWith(`conductor-${sid}-`) || name.startsWith(`sp-conductor-${sid}-`);
    };

    // Never enumerate through a symlinked root: fs.readdirSync follows a
    // symlink, and the recursive rmSync below would then resolve through it
    // too. A directory an attacker pre-created at this path (pointing at
    // something the victim can write to) must be refused, not traversed.
    try { if (fs.lstatSync(root).isSymbolicLink()) return result; } catch {}

    // --- our own root -----------------------------------------------------
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries) {
      if (e.name === MARKER) continue;          // never reap the throttle marker
      if (e.isSymbolicLink()) continue;         // never traverse out of the root
      if (isLive(e.name)) continue;
      const full = path.join(root, e.name);
      if (!stale(full)) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); result.removed++; } catch {}
    }

    // --- legacy flat names in the shared root (time-boxed) ----------------
    let flat = [];
    try { flat = fs.readdirSync(tmpRoot, { withFileTypes: true }); } catch { flat = []; }
    for (const e of flat) {
      if (e.isSymbolicLink()) continue;
      if (!LEGACY_PREFIXES.some((p) => e.name.startsWith(p))) continue;
      if (isLive(e.name)) continue;
      const full = path.join(tmpRoot, e.name);
      if (!stale(full)) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); result.legacy++; } catch {}
    }

    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(markerPath, new Date(now).toISOString());
      // Stamp mtime to the injected clock, not the real write time: the
      // throttle check below compares against `now`, and tests inject a
      // `now` far from wall-clock time.
      fs.utimesSync(markerPath, new Date(now), new Date(now));
    } catch {}
  } catch {
    // Fail open. A cleanup routine must never be the reason a session fails to start.
  }
  return result;
}

export { sweep, retentionMs, LEGACY_PREFIXES, MARKER, DEFAULT_RETENTION_DAYS };
