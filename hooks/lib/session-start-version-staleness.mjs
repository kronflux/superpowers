// hooks/lib/session-start-version-staleness.mjs — warns when CLAUDE_PLUGIN_ROOT's
// version is not the newest cached under the marketplace directory. Invoked
// as a Node subprocess from the bash `session-start` hook (which cannot
// import ESM directly). Prints one line to stdout on a mismatch, nothing
// otherwise; best-effort only. Read-only: no directory is ever pruned here.
import fs from 'fs';
import path from 'path';

function newestVersionDir(base) {
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return null; }
  const versions = entries
    .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    });
  return versions.length ? versions[versions.length - 1] : null;
}

/**
 * Compares the version segment of pluginRoot (CLAUDE_PLUGIN_ROOT's basename)
 * against the newest version directory under
 * <configRoot>/plugins/cache/superpowers-dev/superpowers. Returns a one-line
 * warning naming both versions on a mismatch, or null when they match, the
 * loaded path's basename does not parse as a version, or the cache is
 * absent/unreadable.
 */
function staleWarning(pluginRoot, configRoot) {
  if (!pluginRoot) return null;
  const loaded = path.basename(pluginRoot);
  if (!/^\d+\.\d+\.\d+$/.test(loaded)) return null;
  const base = path.join(configRoot, 'plugins', 'cache', 'superpowers-dev', 'superpowers');
  const newest = newestVersionDir(base);
  if (!newest || newest === loaded) return null;
  return `[plugin] loaded ${loaded}, but ${newest} is the newest cached version — restart or run /plugin marketplace update to pick it up.`;
}

function main() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const configRoot = process.env.CLAUDE_CONFIG_DIR
    || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.claude');
  const line = staleWarning(pluginRoot, configRoot);
  if (line) process.stdout.write(line);
}

try {
  main();
} catch {
  // best-effort; SessionStart must never fault on this probe
}

export { staleWarning, newestVersionDir };
