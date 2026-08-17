// hooks/lib/gate-launcher-install.js — what /onboard writes to activate the
// version-stable gate-hook launcher, and what migrates an existing
// version-pinned registration to it.
import fs from 'fs';
import path from 'path';

const GATE_SCRIPTS = ['post-task-complete-revalidate.sh', 'stop-revalidate-user-gates.sh'];

/**
 * Copy the gate-hook launcher, its resolver, and a fallback copy of both gate
 * scripts to configRoot, outside the versioned plugin directory, so a plugin
 * update never orphans a hook registered against the copy. Returns the
 * launcher's absolute path.
 *
 * pluginRoot is the currently installed plugin's root (the directory holding
 * hooks/ and scripts/) — the source for every file copied here.
 */
function installGateLauncher(configRoot, pluginRoot) {
  fs.mkdirSync(configRoot, { recursive: true });

  const launcherDest = path.join(configRoot, 'superpowers-gate-launcher.sh');
  fs.copyFileSync(path.join(pluginRoot, 'hooks', 'lib', 'gate-launcher.sh'), launcherDest);
  fs.chmodSync(launcherDest, 0o755);

  const resolverDest = path.join(configRoot, 'superpowers-gate-resolver.sh');
  fs.copyFileSync(path.join(pluginRoot, 'scripts', 'resolve-plugin-script.sh'), resolverDest);
  fs.chmodSync(resolverDest, 0o755);

  const fallbackDir = path.join(configRoot, 'superpowers-gate-fallback');
  fs.mkdirSync(fallbackDir, { recursive: true });
  for (const name of GATE_SCRIPTS) {
    const src = path.join(pluginRoot, 'hooks', 'examples', name);
    if (fs.existsSync(src)) {
      const dest = path.join(fallbackDir, name);
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
  }

  return launcherDest;
}

// Matches a hook command that still points at a gate script inside a
// versioned plugin directory, either slash style.
function pinnedScriptIn(command, name) {
  return command.includes(`hooks/examples/${name}`) || command.includes(`hooks\\examples\\${name}`);
}

/**
 * Rewrite any hook command in settingsPath that points at a version-pinned
 * path for one of the gate scripts so it invokes the launcher instead,
 * leaving every other key untouched. Walks the whole `hooks` tree rather
 * than assuming PostToolUse/Stop are the only matchers used, so a hand-edited
 * registration is still caught.
 *
 * Returns { changed, path, state? } the same shape as patchSettings: a
 * present-but-unparseable or non-object file is refused rather than guessed
 * at, and an absent file is reported rather than treated as a no-op success.
 */
function migrateGateHookCommand(settingsPath, launcherPath) {
  let raw;
  try { raw = fs.readFileSync(settingsPath, 'utf8'); } catch { return { changed: false, path: settingsPath, state: 'absent' }; }
  let json;
  try { json = JSON.parse(raw); } catch { return { changed: false, path: settingsPath, state: 'unparseable' }; }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { changed: false, path: settingsPath, state: 'unparseable' };
  }
  if (!json.hooks || typeof json.hooks !== 'object') return { changed: false, path: settingsPath };

  let changed = false;
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (key === 'command' && typeof value === 'string') {
        const match = GATE_SCRIPTS.find((name) => pinnedScriptIn(value, name));
        if (match) { node[key] = `bash "${launcherPath}" ${match}`; changed = true; }
      } else {
        walk(value);
      }
    }
  };
  walk(json.hooks);

  if (!changed) return { changed: false, path: settingsPath };
  fs.writeFileSync(settingsPath, JSON.stringify(json, null, 2) + '\n');
  return { changed: true, path: settingsPath };
}

export { installGateLauncher, migrateGateHookCommand, GATE_SCRIPTS };
