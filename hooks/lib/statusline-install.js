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
 * Add or update a top-level key in a settings file.
 *
 * By default the target is <projectDir>/.claude/settings.json: projectDir is
 * the project root, not an arbitrary cwd, and a projectDir whose basename is
 * already '.claude' is refused with state 'nested-claude-dir' rather than
 * joined into a '.claude/.claude/settings.json' the harness never reads.
 *
 * options.settingsDir bypasses the '.claude' join entirely and targets
 * <settingsDir>/<filename> directly (projectDir is ignored, and the
 * nested-claude-dir guard does not apply — there is no nesting to guard
 * against). This is what a user-global write needs: configDir() is already
 * the config root, so joining another '.claude' under it, or refusing
 * because its basename happens to be '.claude', would both be wrong.
 *
 * options.filename overrides the default 'settings.json', e.g.
 * 'settings.local.json' for a project-local write alongside the same
 * '.claude' directory a default-mode call would use.
 *
 * Every branch returns the absolute path involved, present or refused, so a
 * caller never has to guess what was written.
 *
 * A present-but-unparseable file is left untouched and reported as
 * 'unparseable' rather than treated like an absent one. Overwriting it with a
 * freshly built object would silently discard the user's entire settings
 * file (permissions, hooks, model, everything) on a single JSON typo — one
 * comma away from valid — while reporting changed: true as a clean success.
 * Refusing to act is correct when the existing content can't be read: the
 * caller can then tell the user their settings file has a syntax error to
 * fix first.
 */
function patchSettings(projectDir, key, value, options = {}) {
  const filename = options.filename || 'settings.json';
  let dir;
  if (options.settingsDir) {
    dir = options.settingsDir;
  } else {
    if (path.basename(projectDir) === '.claude') {
      return { changed: false, path: path.resolve(projectDir), state: 'nested-claude-dir' };
    }
    dir = path.join(projectDir, '.claude');
  }
  const file = path.join(dir, filename);
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = null; }
  let json = {};
  if (raw !== null) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { changed: false, path: file, state: 'unparseable' }; }
    // JSON.parse succeeds on arrays, null, strings, numbers and booleans, so a
    // catch-only guard lets them through to the assignment below. `"str"` then
    // throws an uncaught TypeError, and `[]` accepts the property but
    // JSON.stringify drops it — reporting changed:true for a write that never
    // landed. A settings file that is valid JSON but not an object is no more
    // safely overwritable than a malformed one: refuse both the same way.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { changed: false, path: file, state: 'unparseable' };
    }
    json = parsed;
  }
  if (JSON.stringify(json[key]) === JSON.stringify(value)) return { changed: false, path: file };
  json[key] = value;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return { changed: true, path: file };
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
