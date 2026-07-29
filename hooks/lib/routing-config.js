/**
 * Shared loader for the opt-in model-routing config.
 *
 * Routing activates only when docs/superpowers/model-routing.json exists in
 * the project, or a superpowers/model-routing.json exists under the active
 * config dir (CLAUDE_CONFIG_DIR, or ~/.claude as legacy fallback). Absent
 * config, kill switch, or malformed/invalid JSON all return null — callers
 * treat null as "routing dormant, allow everything".
 *
 * Two config shapes are accepted and normalized to one four-key object:
 *   - legacy (no "schema" key): {"mechanical": "haiku", "standard": "sonnet",
 *     "frontier": "inherit"} — "frontier" here is the old ungated ceiling and
 *     becomes "advanced"; the new gated "frontier" tier is disabled ("off").
 *   - schema 2: {"schema": 2, "mechanical": "haiku", "standard": "sonnet",
 *     "advanced": "opus", "frontier": "fable"} — all four keys explicit.
 * The value "inherit" means: no constraint for that tier. "off" means: the
 * tier is unreachable. See normalizeRouting() for the full normalization and
 * rejection rules.
 */

import fs from 'fs';
import path from 'path';
import { configDir, userCandidates } from './config-dir.js';

export const TIERS = ['mechanical', 'standard', 'advanced', 'frontier'];
export const REQUIRED_TIERS = ['mechanical', 'standard', 'advanced'];

// Deliberately broad: a false positive costs a dormant config plus a log
// line, a false negative costs silent 2x spend.
const FABLE_RE = /fable/i;

/**
 * Accept both config shapes and return one normalized four-key object.
 * Returns { routing, reason }; routing is null when the config is unusable.
 */
export function normalizeRouting(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { routing: null, reason: 'not a JSON object' };
  }

  const isNew = raw.schema === 2 || Object.prototype.hasOwnProperty.call(raw, 'advanced');
  let cfg;

  if (isNew) {
    cfg = { ...raw };
    if (cfg.schema !== 2) cfg.schema = 2;
  } else {
    // Legacy three-key shape: the old "frontier" was the ungated ceiling and
    // becomes "advanced". Never let that ceiling be a Fable model, which
    // would route every advanced task to 2x pricing with no gate.
    if (typeof raw.frontier !== 'string' || !raw.frontier) {
      return { routing: null, reason: 'legacy config has no frontier tier' };
    }
    if (FABLE_RE.test(raw.frontier)) {
      return {
        routing: null,
        reason: `legacy config maps frontier to a fable model ('${raw.frontier}'); `
          + 'add an explicit "advanced" tier and "schema": 2 to enable gated frontier routing',
      };
    }
    cfg = { ...raw, advanced: raw.frontier, frontier: 'off', schema: 1 };
  }

  for (const k of REQUIRED_TIERS) {
    if (typeof cfg[k] !== 'string' || !cfg[k]) {
      return { routing: null, reason: `missing or non-string tier '${k}'` };
    }
  }

  // frontier is optional; absent or empty means the tier is unreachable.
  if (typeof cfg.frontier !== 'string' || !cfg.frontier) cfg.frontier = 'off';

  // The consent gate keys on "dispatch model equals the frontier model". If
  // advanced resolved to the same model, every advanced dispatch would demand
  // a frontier approval that can never be satisfied. Reject rather than gate
  // the wrong thing.
  if (cfg.frontier !== 'off' && cfg.frontier !== 'inherit' && cfg.frontier === cfg.advanced) {
    return {
      routing: null,
      reason: `advanced and frontier must be distinct models (both are '${cfg.frontier}')`,
    };
  }

  return { routing: cfg, reason: null };
}

let lastSource = null;

/** Path of the config candidate that last satisfied loadRouting, or null. */
export function routingSource() {
  return lastSource;
}

function logSource(p, env, note) {
  try {
    const logDir = path.join(configDir(env), 'hooks-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const line = note ? `routing-config: rejected ${p} - ${note}\n` : `routing-config: using ${p}\n`;
    fs.appendFileSync(path.join(logDir, 'routing-config.log'), line);
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
      const { routing, reason } = normalizeRouting(JSON.parse(fs.readFileSync(p, 'utf8')));
      if (routing) {
        lastSource = p;
        logSource(p, env);
        return routing;
      }
      logSource(p, env, reason);
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
