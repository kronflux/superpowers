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

/** Add or update the statusLine block in <cwd>/.claude/settings.json. */
function patchSettings(cwd, command) {
  const dir = path.join(cwd, '.claude');
  const file = path.join(dir, 'settings.json');
  let json = {};
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { json = {}; }
  if (json.statusLine && json.statusLine.command === command) return { changed: false };
  json.statusLine = { type: 'command', command };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return { changed: true };
}

/**
 * Ensure .claude/ is gitignored, reporting which of three states applied.
 *
 * 'tracked' is the case that matters: a .gitignore rule NEVER untracks an
 * already-tracked path, so writing one there would change nothing while
 * implying the job was done. In that state this writes nothing and lets the
 * caller tell the user the truth.
 */
function ensureGitignored(cwd) {
  const giPath = path.join(cwd, '.gitignore');
  let gi = '';
  try { gi = fs.readFileSync(giPath, 'utf8'); } catch {}
  if (/^\.claude\/?\s*$/m.test(gi)) return { state: 'already' };

  let tracked = false;
  try {
    const out = execFileSync('git', ['ls-files', '.claude'], {
      cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    tracked = out.trim().length > 0;
  } catch {
    tracked = false; // not a git repo, or git unavailable — fall through to 'added'
  }
  if (tracked) return { state: 'tracked' };

  const suffix = gi.length && !gi.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(giPath, `${gi}${suffix}.claude/\n`);
  return { state: 'added' };
}

export { installLauncher, patchSettings, ensureGitignored };
