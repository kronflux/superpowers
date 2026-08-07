#!/usr/bin/env node
// Stable entry point for the superpowers statusline.
//
// This file is COPIED to the config root by /superpowers:statusline and must
// stay outside the versioned plugin directory. settings.json points here, so a
// plugin update does not invalidate the path — the resolution happens at run
// time instead. Pointing settings.json directly at
// .../superpowers/<version>/scripts/statusline.mjs breaks silently on the next
// update, and a broken statusline is invisible.
//
// Note ${CLAUDE_PLUGIN_ROOT} is a hook-manifest substitution and does NOT
// expand in a statusLine command, and scripts/resolve-plugin-script.sh is bash,
// which the statusline shell on Windows may not be. Hence a Node launcher.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function newestVersionDir(base) {
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return null; }
  const versions = entries
    .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
      return 0;
    });
  return versions.length ? versions[versions.length - 1] : null;
}

async function main() {
  try {
    const root = process.env.CLAUDE_CONFIG_DIR
      || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.claude');
    const base = path.join(root, 'plugins', 'cache', 'superpowers-dev', 'superpowers');
    const ver = newestVersionDir(base);
    if (!ver) { process.stdout.write('\n'); return; }
    const target = path.join(base, ver, 'scripts', 'statusline.mjs');
    if (!fs.existsSync(target)) { process.stdout.write('\n'); return; }
    process.argv[1] = target;
    await import(pathToFileURL(target).href);
  } catch {
    process.stdout.write('\n');
  }
}

main().catch(() => { process.stdout.write('\n'); });
