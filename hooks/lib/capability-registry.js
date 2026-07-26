'use strict';
// hooks/lib/capability-registry.js — conductor capability probe (absent|configured).
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATUS = { ABSENT: 'absent', CONFIGURED: 'configured', VERIFIED: 'verified' };

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function onPath(bin, env) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return ((env.PATH ?? process.env.PATH) || '').split(path.delimiter)
    .some((d) => d && exts.some((e) => exists(path.join(d, bin + e))));
}

function mcpConfigured(pattern, cwd, home) {
  const re = new RegExp(pattern, 'i');
  const pools = [];
  const proj = readJson(path.join(cwd, '.mcp.json'));
  if (proj) pools.push(proj.mcpServers || {});
  const global = readJson(path.join(home, '.claude.json'));
  if (global) {
    pools.push(global.mcpServers || {});
    for (const p of Object.values(global.projects || {})) pools.push(p.mcpServers || {});
  }
  return pools.some((pool) => Object.keys(pool).some((k) => re.test(k)));
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
      status: st(onPath('codegraph', env) || mcpConfigured('codegraph', cwd, home)),
      indexed: exists(path.join(cwd, '.codegraph')),
      declined: exists(path.join(cwd, '.superpowers-no-codegraph')),
    },
    serena: { status: st(mcpConfigured('serena', cwd, home)) },
    context7: { status: st(mcpConfigured('context7', cwd, home)) },
    docfork: { status: st(mcpConfigured('docfork', cwd, home)) },
    'basic-memory': { status: st(mcpConfigured('basic-?memory', cwd, home)) },
    'obsidian-cli': { status: st(onPath('obsidian-cli', env)), vault: vaultAbove(cwd) },
    middleware: {
      status: st([path.join(cwd, '.claude', 'middleware-config.json'),
                  path.join(home, '.claude', 'middleware-config.json')].some(exists)),
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

module.exports = { probe, summaryLine, STATUS, mcpConfigured, onPath };
