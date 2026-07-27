/**
 * Shared loader for the opt-in model-routing config.
 *
 * Routing activates only when docs/superpowers/model-routing.json exists in
 * the project, or a superpowers/model-routing.json exists under the active
 * config dir (CLAUDE_CONFIG_DIR, or ~/.claude as legacy fallback). Absent
 * config, kill switch, or malformed/invalid JSON all return null — callers
 * treat null as "routing dormant, allow everything".
 *
 * Valid config maps every tier to a model string, e.g.:
 *   {"mechanical": "haiku", "standard": "sonnet", "frontier": "inherit"}
 * The value "inherit" means: no constraint for that tier.
 */

import fs from 'fs';
import path from 'path';
import { configDir, userCandidates } from './config-dir.js';

export const TIERS = ['mechanical', 'standard', 'frontier'];

let lastSource = null;

/** Path of the config candidate that last satisfied loadRouting, or null. */
export function routingSource() {
  return lastSource;
}

function logSource(p, env) {
  try {
    const logDir = path.join(configDir(env), 'hooks-logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'routing-config.log'), `routing-config: using ${p}\n`);
  } catch {
    // Logging is best-effort; never let it break routing resolution.
  }
}

export function loadRouting(cwd, env = process.env) {
  lastSource = null;
  if (env.SUPERPOWERS_ROUTING_GUARD === '0') return null;
  const candidates = [
    path.join(cwd || process.cwd(), 'docs', 'superpowers', 'model-routing.json'),
    ...userCandidates(['superpowers', 'model-routing.json'], env),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const routing = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (routing && TIERS.every((k) => typeof routing[k] === 'string')) {
        lastSource = p;
        logSource(p, env);
        return routing;
      }
    } catch {
      // Malformed JSON -> fail open.
    }
    // First existing file wins entirely; invalid content -> dormant.
    return null;
  }
  return null;
}

/** Extract and parse the ```json:metadata fence from a task description. */
export function fenceMeta(description) {
  const m = /```json:metadata\s*\n([\s\S]*?)\n```/.exec(description || '');
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]);
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
  } catch {
    return null;
  }
}
