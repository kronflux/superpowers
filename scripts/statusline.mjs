#!/usr/bin/env node
// scripts/statusline.mjs — the conductor statusline provider.
//
// Two modes, one code path:
//   default   emit only conductor segments — paste into a ccstatusline
//             Custom Command widget and let it do the rendering.
//   --full    additionally prefix model and context % from stdin, so this can
//             be the whole statusline with no third-party install.
//
// FAILURE CONTRACT, stricter than the hooks': a hook that fails open costs a
// missing nudge; a statusline that fails visibly puts a stack trace across the
// bottom of the terminal on EVERY assistant message. So: nothing throws past
// the top-level handler, and any fault prints an empty line and exits 0.
import path from 'path';
import { configDir } from '../hooks/lib/config-dir.js';
import { loadConfig } from '../hooks/lib/statusline-config.js';
import { segCapabilities, segDelegation, segPlan, segUsage } from '../hooks/lib/statusline-segments.js';

const PROVIDERS = {
  capabilities: segCapabilities,
  delegation: segDelegation,
  plan: segPlan,
  usage: segUsage,
};

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function render(stdin, cwd, full) {
  const cfg = loadConfig(cwd);
  const ctx = {
    stdin,
    cwd,
    logDir: path.join(configDir(process.env), 'hooks-logs'),
    now: Date.now(),
    // Threaded through so segCapabilities can sandbox probe()'s env/home
    // resolution instead of silently falling back to the real ones.
    env: process.env,
  };

  const parts = [];
  if (full) {
    const model = stdin?.model?.display_name;
    if (model) parts.push(String(model));
    const pct = stdin?.context_window?.used_percentage;
    if (Number.isFinite(pct)) parts.push(`${Math.round(pct)}%`);
  }
  for (const id of cfg.segments) {
    const fn = PROVIDERS[id];
    if (!fn) continue;
    let out = null;
    // One failing segment must not cost the others.
    try { out = fn(ctx); } catch { out = null; }
    if (typeof out === 'string' && out.length) parts.push(out);
  }
  // Joining a filtered list is what keeps a null segment from leaving a
  // dangling separator behind.
  return parts.join(cfg.separator);
}

async function main() {
  let line = '';
  try {
    const raw = await readStdin();
    const stdin = JSON.parse(raw);
    const cwd = stdin?.cwd || stdin?.workspace?.current_dir || process.cwd();
    line = render(stdin, cwd, process.argv.includes('--full'));
  } catch {
    line = '';
  }
  process.stdout.write(line + '\n');
}

main().catch(() => { process.stdout.write('\n'); });
