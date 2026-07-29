// hooks/lib/capability-registry.js — conductor capability probe (absent|configured).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { configDir } from './config-dir.js';

const STATUS = { ABSENT: 'absent', CONFIGURED: 'configured', VERIFIED: 'verified' };

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function onPath(bin, env) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return ((env.PATH ?? process.env.PATH) || '').split(path.delimiter)
    .some((d) => d && exts.some((e) => exists(path.join(d, bin + e))));
}

function normalizeDir(p) {
  const resolved = path.resolve(p);
  if (process.platform === 'win32') {
    return resolved.toLowerCase().replace(/\\/g, '/');
  }
  return resolved;
}

function pluginServers(root) {
  const idx = readJson(path.join(root, 'plugins', 'installed_plugins.json'));
  if (!idx || !idx.plugins) return [];
  const enabled = readJson(path.join(root, 'settings.json'))?.enabledPlugins;
  const names = [];
  for (const [key, entries] of Object.entries(idx.plugins)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    if (enabled && enabled[key] === false) continue;
    names.push(key.split('@')[0]);
    const mcp = readJson(path.join(entries[entries.length - 1].installPath || '', '.mcp.json'));
    if (mcp && mcp.mcpServers) names.push(...Object.keys(mcp.mcpServers));
  }
  return names;
}

function mcpConfigured(pattern, cwd, home, env = {}) {
  const re = new RegExp(pattern, 'i');
  const pools = [];
  const proj = readJson(path.join(cwd, '.mcp.json'));
  if (proj) pools.push(proj.mcpServers || {});
  const normalizedCwd = normalizeDir(cwd);
  const global = readJson(path.join(home, '.claude.json'));
  if (global) {
    pools.push(global.mcpServers || {});
    for (const [key, projCfg] of Object.entries(global.projects || {})) {
      if (normalizeDir(key) === normalizedCwd) {
        pools.push(projCfg.mcpServers || {});
      }
    }
  }
  const root = configDir(env);
  const rootConfig = readJson(path.join(root, '.claude.json'));
  if (rootConfig) {
    pools.push(rootConfig.mcpServers || {});
    for (const [key, projCfg] of Object.entries(rootConfig.projects || {})) {
      if (normalizeDir(key) === normalizedCwd) {
        pools.push(projCfg.mcpServers || {});
      }
    }
  }
  if (pools.some((pool) => Object.keys(pool).some((k) => re.test(k)))) return true;
  return pluginServers(root).some((name) => re.test(name));
}

function vaultAbove(cwd) {
  let dir = cwd;
  for (;;) {
    if (exists(path.join(dir, '.obsidian'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function probe(cwd = process.cwd(), opts = {}) {
  const home = opts.home || os.homedir();
  const env = opts.env || process.env;
  const st = (cond) => (cond ? STATUS.CONFIGURED : STATUS.ABSENT);
  return {
    codegraph: {
      status: st(onPath('codegraph', env) || mcpConfigured('codegraph', cwd, home, env)),
      indexed: exists(path.join(cwd, '.codegraph')),
      declined: exists(path.join(cwd, '.superpowers-no-codegraph')),
    },
    serena: {
      status: st(mcpConfigured('serena', cwd, home, env)),
      declined: exists(path.join(cwd, '.superpowers-no-serena')),
    },
    context7: {
      status: st(mcpConfigured('context7', cwd, home, env)),
      declined: exists(path.join(cwd, '.superpowers-no-context7')),
    },
    docfork: { status: st(mcpConfigured('docfork', cwd, home, env)) },
    'basic-memory': { status: st(mcpConfigured('basic-?memory', cwd, home, env)) },
    'obsidian-cli': {
      status: st(onPath('obsidian', env) || onPath('obsidian-cli', env)),
      vault: vaultAbove(cwd),
      declined: exists(path.join(cwd, '.superpowers-no-obsidian-cli')),
    },
    middleware: {
      // Same candidate chain as scripts/middleware-exec.mjs resolveConfig():
      // project -> active config root -> legacy home. Omitting the config-root
      // candidate makes the probe blind to configs written under a custom
      // CLAUDE_CONFIG_DIR, which is exactly where /onboard writes them.
      status: st([path.join(cwd, '.claude', 'middleware-config.json'),
                  path.join(configDir(env), 'middleware-config.json'),
                  path.join(home, '.claude', 'middleware-config.json')].some(exists)),
      declined: exists(path.join(cwd, '.superpowers-no-middleware')),
    },
  };
}

function summaryLine(caps) {
  const present = Object.entries(caps)
    .filter(([, v]) => v.status !== STATUS.ABSENT).map(([k]) => k);
  return present.length
    ? `[conductor] available: ${present.join(', ')}`
    : '[conductor] no optional integrations detected';
}

export { probe, summaryLine, STATUS, mcpConfigured, onPath };
