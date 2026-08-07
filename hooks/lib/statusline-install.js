// hooks/lib/statusline-install.js — what /superpowers:statusline writes.
//
// Kept out of the skill prose so the mechanics are testable. The skill decides
// WHAT to install; this module performs it and reports what actually happened.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Copy the launcher to the config root and return its absolute path. */
function installLauncher(configRoot, sourcePath) {
  fs.mkdirSync(configRoot, { recursive: true });
  const dest = path.join(configRoot, 'superpowers-statusline.mjs');
  fs.copyFileSync(sourcePath, dest);
  return dest;
}

/**
 * Add or update the statusLine block in <cwd>/.claude/settings.json.
 *
 * A present-but-unparseable file is left untouched and reported as
 * 'unparseable' rather than treated like an absent one. Overwriting it with a
 * freshly built {statusLine: ...} object would silently discard the user's
 * entire settings file (permissions, hooks, model, everything) on a single
 * JSON typo — one comma away from valid — while reporting changed: true as a
 * clean success. Refusing to act is correct when the existing content can't
 * be read: the caller can then tell the user their settings file has a
 * syntax error to fix first.
 */
function patchSettings(cwd, command) {
  const dir = path.join(cwd, '.claude');
  const file = path.join(dir, 'settings.json');
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = null; }
  let json = {};
  if (raw !== null) {
    try { json = JSON.parse(raw) || {}; } catch { return { changed: false, state: 'unparseable' }; }
  }
  if (json.statusLine && json.statusLine.command === command) return { changed: false };
  json.statusLine = { type: 'command', command };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return { changed: true };
}

/**
 * Ensure .claude/ is gitignored, reporting which of four states applied.
 *
 * 'tracked' is the case that matters most: a .gitignore rule NEVER untracks
 * an already-tracked path, so writing one there would change nothing while
 * implying the job was done. In that state this writes nothing and lets the
 * caller tell the user the truth.
 *
 * 'unknown' exists for the same reason, one layer earlier: when cwd IS a git
 * repo but the `ls-files` probe itself fails (lock contention, permissions,
 * the timeout below), we cannot tell whether .claude/ is tracked. Folding
 * that into "not tracked" would risk the exact misreport the 'tracked' state
 * exists to prevent — writing a no-op rule and reporting success against a
 * repo that may well have .claude/ tracked. A directory that is not a repo
 * at all has nothing that could be tracked, so it still resolves to 'added'.
 */
function ensureGitignored(cwd) {
  const giPath = path.join(cwd, '.gitignore');
  let gi = '';
  try { gi = fs.readFileSync(giPath, 'utf8'); } catch {}
  if (/^\.claude\/?\s*$/m.test(gi)) return { state: 'already' };

  const isRepo = fs.existsSync(path.join(cwd, '.git'));
  if (isRepo) {
    let out;
    try {
      out = execFileSync('git', ['ls-files', '.claude'], {
        cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return { state: 'unknown' }; // probe failed against a real repo — do not guess
    }
    if (out.trim().length > 0) return { state: 'tracked' };
  }

  const suffix = gi.length && !gi.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(giPath, `${gi}${suffix}.claude/\n`);
  return { state: 'added' };
}

export { installLauncher, patchSettings, ensureGitignored };
