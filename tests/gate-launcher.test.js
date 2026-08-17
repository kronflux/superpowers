import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { installGateLauncher, migrateGateHookCommand, GATE_SCRIPTS } from '../hooks/lib/gate-launcher-install.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const bashAvailable = spawnSync('bash', ['--version']).status === 0;

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(spTmpDir(), 'gate-launcher-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function cacheDir(configRoot, version) {
  return path.join(configRoot, 'plugins', 'cache', 'superpowers-dev', 'superpowers', version);
}

// Builds a fake plugin install directory (hooks/lib, hooks/examples,
// scripts/) with a marker gate script that prints its own version and exit
// code, so a test can tell which copy actually ran.
function seedPluginInstall(dir, version, exitCode = 0) {
  fs.mkdirSync(path.join(dir, 'hooks', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'hooks', 'examples'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'hooks', 'lib', 'gate-launcher.sh'), path.join(dir, 'hooks', 'lib', 'gate-launcher.sh'));
  fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'resolve-plugin-script.sh'), path.join(dir, 'scripts', 'resolve-plugin-script.sh'));
  for (const name of GATE_SCRIPTS) {
    const body = `#!/usr/bin/env bash\necho "${version}"\nexit ${exitCode}\n`;
    const dest = path.join(dir, 'hooks', 'examples', name);
    fs.writeFileSync(dest, body);
    fs.chmodSync(dest, 0o755);
  }
}

function runLauncher(configRoot, launcher, scriptName) {
  return spawnSync('bash', [launcher, scriptName], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configRoot },
  });
}

describe('installGateLauncher', () => {
  it('copies the launcher, resolver, and fallback gate scripts to configRoot', () => {
    const pluginRoot = path.join(root, 'plugin-src');
    seedPluginInstall(pluginRoot, '7.15.0');
    const configRoot = path.join(root, 'cfg');

    const launcher = installGateLauncher(configRoot, pluginRoot);

    expect(launcher).toBe(path.join(configRoot, 'superpowers-gate-launcher.sh'));
    expect(fs.existsSync(launcher)).toBe(true);
    expect(fs.existsSync(path.join(configRoot, 'superpowers-gate-resolver.sh'))).toBe(true);
    for (const name of GATE_SCRIPTS) {
      expect(fs.existsSync(path.join(configRoot, 'superpowers-gate-fallback', name))).toBe(true);
    }
  });
});

describe('migrateGateHookCommand', () => {
  it('rewrites a version-pinned entry and leaves other keys untouched', () => {
    const configRoot = path.join(root, 'cfg-mig');
    fs.mkdirSync(path.join(configRoot, '.claude'), { recursive: true });
    const settingsPath = path.join(configRoot, '.claude', 'settings.json');
    const before = {
      permissions: { allow: ['Bash'] },
      model: 'opus',
      hooks: {
        PostToolUse: [{
          matcher: 'TaskUpdate',
          hooks: [{ type: 'command', command: 'bash ".../superpowers/7.15.0/hooks/examples/post-task-complete-revalidate.sh"' }],
        }],
        Stop: [{
          hooks: [{ type: 'command', command: 'bash ".../superpowers/7.15.0/hooks/examples/stop-revalidate-user-gates.sh"' }],
        }],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(before, null, 2));

    const launcherPath = path.join(configRoot, 'superpowers-gate-launcher.sh');
    const result = migrateGateHookCommand(settingsPath, launcherPath);

    expect(result.changed).toBe(true);
    expect(result.path).toBe(settingsPath);
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(after.permissions).toEqual(before.permissions);
    expect(after.model).toBe(before.model);
    expect(after.hooks.PostToolUse[0].matcher).toBe('TaskUpdate');
    expect(after.hooks.PostToolUse[0].hooks[0].command).toBe(`bash "${launcherPath}" post-task-complete-revalidate.sh`);
    expect(after.hooks.Stop[0].hooks[0].command).toBe(`bash "${launcherPath}" stop-revalidate-user-gates.sh`);
  });

  it('is a no-op when no command is version-pinned', () => {
    const configRoot = path.join(root, 'cfg-noop');
    fs.mkdirSync(path.join(configRoot, '.claude'), { recursive: true });
    const settingsPath = path.join(configRoot, '.claude', 'settings.json');
    const before = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash "/cfg/superpowers-gate-launcher.sh" stop-revalidate-user-gates.sh' }] }] } };
    fs.writeFileSync(settingsPath, JSON.stringify(before));
    const result = migrateGateHookCommand(settingsPath, path.join(configRoot, 'superpowers-gate-launcher.sh'));
    expect(result.changed).toBe(false);
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual(before);
  });

  it('refuses an unparseable settings file rather than guessing', () => {
    const configRoot = path.join(root, 'cfg-bad');
    fs.mkdirSync(path.join(configRoot, '.claude'), { recursive: true });
    const settingsPath = path.join(configRoot, '.claude', 'settings.json');
    const before = '{ not json';
    fs.writeFileSync(settingsPath, before);
    const result = migrateGateHookCommand(settingsPath, '/x/superpowers-gate-launcher.sh');
    expect(result).toEqual({ changed: false, path: settingsPath, state: 'unparseable' });
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(before);
  });

  it('reports "absent" without writing when the settings file does not exist', () => {
    const configRoot = path.join(root, 'cfg-absent');
    const settingsPath = path.join(configRoot, '.claude', 'settings.json');
    const result = migrateGateHookCommand(settingsPath, '/x/superpowers-gate-launcher.sh');
    expect(result).toEqual({ changed: false, path: settingsPath, state: 'absent' });
    expect(fs.existsSync(settingsPath)).toBe(false);
  });
});

describe.skipIf(!bashAvailable)('gate-launcher.sh runtime resolution', () => {
  it('tier 1: resolves via installed_plugins.json, even when it disagrees with the launcher\'s own fallback copy', () => {
    const configRoot = path.join(root, 'cfg-t1');
    // The launcher is built from one plugin root (whose scripts also become
    // its tier-3 fallback copy)...
    const launcherSrcRoot = path.join(root, 'launcher-src-plugin');
    seedPluginInstall(launcherSrcRoot, 'fallback-marker', 9);
    const launcher = installGateLauncher(configRoot, launcherSrcRoot);

    // ...while installed_plugins.json points at a DIFFERENT install. If tier
    // 1 were skipped, tiers 2 (no cache present) and 3 (the fallback copy
    // above) would both resolve to 'fallback-marker' instead, so this only
    // passes when tier 1 genuinely wins.
    const registeredRoot = path.join(root, 'registered-plugin');
    seedPluginInstall(registeredRoot, '9.9.9', 3);
    fs.mkdirSync(path.join(configRoot, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(configRoot, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 1,
      plugins: { 'superpowers@superpowers-dev': [{ installPath: registeredRoot }] },
    }));

    const res = runLauncher(configRoot, launcher, 'post-task-complete-revalidate.sh');
    expect(res.stdout.trim()).toBe('9.9.9');
    expect(res.status).toBe(3);
  });

  it('tier 2: falls back to a version-sorted cache scan when the registry is absent', () => {
    const configRoot = path.join(root, 'cfg-t2');
    const pluginRoot = path.join(root, 'src-plugin');
    seedPluginInstall(pluginRoot, 'src-version');
    const launcher = installGateLauncher(configRoot, pluginRoot);

    // Semantic vs. collation trap: '7.9.0' sorts AFTER '7.10.0' lexically,
    // so a collation-based scan would pick the wrong one here.
    seedPluginInstall(cacheDir(configRoot, '7.4.0'), '7.4.0');
    seedPluginInstall(cacheDir(configRoot, '7.9.0'), '7.9.0');
    seedPluginInstall(cacheDir(configRoot, '7.15.0'), '7.15.0');
    seedPluginInstall(cacheDir(configRoot, '7.16.0'), '7.16.0');

    const res = runLauncher(configRoot, launcher, 'post-task-complete-revalidate.sh');
    expect(res.stdout.trim()).toBe('7.16.0');
    expect(res.status).toBe(0);
  });

  it('propagates a nonzero exit from the resolved tier-2 script (a gate hook can block)', () => {
    const configRoot = path.join(root, 'cfg-t2-block');
    const pluginRoot = path.join(root, 'src-plugin-block');
    seedPluginInstall(pluginRoot, 'src-version');
    const launcher = installGateLauncher(configRoot, pluginRoot);
    seedPluginInstall(cacheDir(configRoot, '7.15.0'), '7.15.0', 2);

    const res = runLauncher(configRoot, launcher, 'post-task-complete-revalidate.sh');
    expect(res.status).toBe(2);
  });

  it('tier 3: falls back to the copy installed alongside the launcher when both prior tiers fail', () => {
    const configRoot = path.join(root, 'cfg-t3');
    const pluginRoot = path.join(root, 'src-plugin-t3');
    seedPluginInstall(pluginRoot, 'fallback-copy', 5);
    const launcher = installGateLauncher(configRoot, pluginRoot);
    // No installed_plugins.json, and no cache directory at all: tiers 1 and 2 both fail.

    const res = runLauncher(configRoot, launcher, 'post-task-complete-revalidate.sh');
    expect(res.stdout.trim()).toBe('fallback-copy');
    expect(res.status).toBe(5);
  });

  it('a total resolution failure exits 0 without breaking the caller', () => {
    const configRoot = path.join(root, 'cfg-t-fail');
    fs.mkdirSync(configRoot, { recursive: true });
    // A launcher installed with no plugin source behind it at all: build the
    // bare launcher file directly, no resolver, no fallback copies.
    const launcher = path.join(configRoot, 'superpowers-gate-launcher.sh');
    fs.copyFileSync(path.join(REPO_ROOT, 'hooks', 'lib', 'gate-launcher.sh'), launcher);

    const res = runLauncher(configRoot, launcher, 'post-task-complete-revalidate.sh');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('');
  });
});
