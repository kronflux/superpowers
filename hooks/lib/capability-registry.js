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

// One walk over installed, enabled plugins. Both the MCP-server probe and the
// LSP probe need the install paths, and reading installed_plugins.json twice
// would be the only difference between them.
function installedPlugins(root) {
  const idx = readJson(path.join(root, 'plugins', 'installed_plugins.json'));
  if (!idx || !idx.plugins) return [];
  const enabled = readJson(path.join(root, 'settings.json'))?.enabledPlugins;
  const out = [];
  for (const [key, entries] of Object.entries(idx.plugins)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    if (enabled && enabled[key] === false) continue;
    out.push({ key, installPath: entries[entries.length - 1].installPath || '' });
  }
  return out;
}

function pluginServers(root) {
  const names = [];
  for (const { key, installPath } of installedPlugins(root)) {
    names.push(key.split('@')[0]);
    const mcp = readJson(path.join(installPath, '.mcp.json'));
    if (mcp && mcp.mcpServers) names.push(...Object.keys(mcp.mcpServers));
  }
  return names;
}

function collectExtensions(lspServers, into) {
  if (!lspServers || typeof lspServers !== 'object') return;
  for (const server of Object.values(lspServers)) {
    const map = server && server.extensionToLanguage;
    if (!map || typeof map !== 'object') continue;
    for (const ext of Object.keys(map)) into.add(String(ext).toLowerCase());
  }
}

// File extensions covered by an installed language server. Claude Code ignores
// lspServers in project settings, so installed plugins are the complete search
// space — but they declare their servers in TWO different places, and only
// reading one of them was a shipped bug:
//
//   1. Plugin-local: `.lsp.json`, or `lspServers` in `plugin.json`. This is the
//      layout the plugin-authoring docs describe, and it is what a hand-written
//      LSP plugin uses.
//   2. Marketplace manifest: the marketplace's own `.claude-plugin/marketplace.json`
//      carries `lspServers` on each plugin's entry. This is how EVERY official
//      LSP plugin actually ships — a marketplace install leaves only LICENSE and
//      README in the install dir, with no manifest of its own.
//
// Path 2 was missing until 7.8.1, so the probe reported `absent` for every
// official language server. Both paths are checked; a plugin using either is
// detected, and the union covers a profile mixing the two.
//
// Returns a sorted array, not a Set: conductor-nudges caches probe() output as JSON.
function lspExtensions(root) {
  const exts = new Set();
  const installed = installedPlugins(root);

  for (const { installPath } of installed) {
    if (!installPath) continue;
    collectExtensions(
      readJson(path.join(installPath, '.lsp.json'))
        || readJson(path.join(installPath, 'plugin.json'))?.lspServers,
      exts,
    );
  }

  // Marketplace manifests are read once each, not once per plugin: a profile
  // with a dozen plugins from one marketplace should not parse it a dozen times.
  const byMarket = new Map();
  for (const { key } of installed) {
    const at = key.lastIndexOf('@');
    if (at <= 0) continue; // no marketplace suffix — plugin-local layout only
    const name = key.slice(0, at);
    const market = key.slice(at + 1);
    if (!byMarket.has(market)) byMarket.set(market, new Set());
    byMarket.get(market).add(name);
  }
  for (const [market, names] of byMarket) {
    const manifest = readJson(
      path.join(root, 'plugins', 'marketplaces', market, '.claude-plugin', 'marketplace.json'),
    );
    if (!manifest || !Array.isArray(manifest.plugins)) continue;
    for (const entry of manifest.plugins) {
      // Advertised is not installed: a marketplace lists every plugin it offers,
      // and only the ones this profile actually installed may contribute.
      if (!entry || !names.has(entry.name)) continue;
      collectExtensions(entry.lspServers, exts);
    }
  }

  return [...exts].sort();
}

// Per-plugin decline list. An empty marker file declines every language, so a
// single decline in a polyglot repo does not silence the others.
function lspDeclines(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, '.superpowers-no-lsp'), 'utf8');
    const declined = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    return { declined, declinedAll: declined.length === 0 };
  } catch {
    return { declined: [], declinedAll: false };
  }
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

function probe(cwd = process.cwd(), opts = {}) {
  const home = opts.home || os.homedir();
  const env = opts.env || process.env;
  const st = (cond) => (cond ? STATUS.CONFIGURED : STATUS.ABSENT);
  const extensions = lspExtensions(configDir(env));
  return {
    codegraph: {
      status: st(onPath('codegraph', env) || mcpConfigured('codegraph', cwd, home, env)),
      indexed: exists(path.join(cwd, '.codegraph')),
      declined: exists(path.join(cwd, '.superpowers-no-codegraph')),
    },
    lsp: { status: st(extensions.length > 0), extensions, ...lspDeclines(cwd) },
    context7: {
      status: st(mcpConfigured('context7', cwd, home, env)),
      declined: exists(path.join(cwd, '.superpowers-no-context7')),
    },
    docfork: { status: st(mcpConfigured('docfork', cwd, home, env)) },
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

// `lsp` is deliberately not in the "use first" list. It exposes no callable
// tool — announcing it as something to reach for repeats the noisy-nudge
// mistake this registry was rewritten to avoid.
function summaryLine(caps) {
  const present = Object.entries(caps)
    .filter(([k, v]) => k !== 'lsp' && v.status !== STATUS.ABSENT).map(([k]) => k);
  const parts = [];
  if (present.length) parts.push(`use first: ${present.join(', ')}`);
  if (caps.lsp && caps.lsp.status !== STATUS.ABSENT) parts.push('lsp diagnostics active');
  return parts.length
    ? `[conductor] ${parts.join(' | ')}`
    : '[conductor] no optional integrations detected';
}

export { probe, summaryLine, STATUS, mcpConfigured, onPath };
