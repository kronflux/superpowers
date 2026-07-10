import fs from 'fs';
import os from 'os';
import path from 'path';

const MCP_MARKER = 'mcp__plugin_context-mode_context-mode__ctx_';

function _cacheFile(sessionId) {
  return path.join(os.tmpdir(), `sp-ctx-${sessionId || 'default'}.json`);
}

function defaultConfigDir(env) {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  const home = env.HOME || env.USERPROFILE || '.';
  return path.join(home, '.claude');
}

// Signal 1: an MCP tool marker for context-mode is visible in the environment.
// Claude Code does not expose a dedicated env var, so we scan the values of any
// env entries that may carry the tool list for the ctx_* MCP prefix.
function hasMcpMarker(env) {
  for (const v of Object.values(env)) {
    if (typeof v === 'string' && v.includes(MCP_MARKER)) return true;
  }
  return false;
}

// Signal 2: installed_plugins.json mentions context-mode.
function hasInstalledPlugin(installedPluginsPath) {
  try {
    return fs.readFileSync(installedPluginsPath, 'utf8').includes('context-mode');
  } catch {
    return false;
  }
}

// Signal 3: the context-mode sessions store exists under the config dir.
function hasSessionsDir(configDir) {
  try {
    return fs.existsSync(path.join(configDir, 'context-mode', 'sessions'));
  } catch {
    return false;
  }
}

function detect({ env, configDir, installedPluginsPath }) {
  if (process.env.SP_TEST_FORCE_CTX === '1') return true;
  return (
    hasMcpMarker(env) ||
    hasInstalledPlugin(installedPluginsPath) ||
    hasSessionsDir(configDir)
  );
}

/**
 * Returns true when context-mode is active. Result is cached per session in a
 * tmpdir file (sp-ctx-<sessionId>.json) so all hooks in a session agree and
 * avoid repeated filesystem probing. Fail-open to false on any error.
 */
function isContextModeActive(opts = {}) {
  if (process.env.SP_TEST_FORCE_CTX === '1') return true;
  const env = opts.env || process.env;
  const sessionId = opts.sessionId;
  const configDir = opts.configDir || defaultConfigDir(env);
  const installedPluginsPath =
    opts.installedPluginsPath ||
    path.join(defaultConfigDir(env), 'plugins', 'installed_plugins.json');

  const cacheFile = _cacheFile(sessionId);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (typeof cached.active === 'boolean') return cached.active;
  } catch {
    // no cache yet
  }

  let active = false;
  try {
    active = detect({ env, configDir, installedPluginsPath });
  } catch {
    active = false;
  }

  try {
    fs.writeFileSync(cacheFile, JSON.stringify({ active, ts: Date.now() }));
  } catch {
    // cache write failure is non-fatal
  }
  return active;
}

export { isContextModeActive, detect, _cacheFile };
