// hooks/lib/config-dir.js — single resolver for the active Claude Code config root.
// Precedence: CLAUDE_CONFIG_DIR → HOME/.claude → USERPROFILE/.claude.
import os from 'os';
import path from 'path';

export function configDir(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  const home = env.HOME || env.USERPROFILE || '.';
  return path.join(home, '.claude');
}

// Ordered user-level candidate paths for a relative artifact:
// active config root first, legacy ~/.claude second, deduped.
export function userCandidates(relPathSegments, env = process.env) {
  const active = path.join(configDir(env), ...relPathSegments);
  const legacy = path.join(os.homedir(), '.claude', ...relPathSegments);
  return path.resolve(active) === path.resolve(legacy) ? [active] : [active, legacy];
}
