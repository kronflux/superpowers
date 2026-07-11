/**
 * Shared loader for the opt-in model-routing config.
 *
 * Routing activates only when docs/superpowers/model-routing.json exists in
 * the project (or ~/.claude/superpowers/model-routing.json as a user-level
 * fallback). Absent config, kill switch, or malformed/invalid JSON all
 * return null — callers treat null as "routing dormant, allow everything".
 *
 * Valid config maps every tier to a model string, e.g.:
 *   {"mechanical": "haiku", "standard": "sonnet", "frontier": "inherit"}
 * The value "inherit" means: no constraint for that tier.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export const TIERS = ['mechanical', 'standard', 'frontier'];

export function loadRouting(cwd) {
  if (process.env.SUPERPOWERS_ROUTING_GUARD === '0') return null;
  const candidates = [
    path.join(cwd || process.cwd(), 'docs', 'superpowers', 'model-routing.json'),
    path.join(os.homedir(), '.claude', 'superpowers', 'model-routing.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const routing = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (routing && TIERS.every((k) => typeof routing[k] === 'string')) {
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
