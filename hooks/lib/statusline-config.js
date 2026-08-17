// hooks/lib/statusline-config.js — the statusline's project configuration.
//
// The interview writes this file; the renderer reads it. Keeping the choice in
// data rather than in a generated per-project script means one tested renderer
// serves every project, so a rendering bug is fixed once instead of once per repo.
import fs from 'fs';
import path from 'path';
import { configDir } from './config-dir.js';

const SEGMENT_IDS = ['capabilities', 'delegation', 'plan', 'usage'];

const DEFAULT_CONFIG = Object.freeze({
  segments: [...SEGMENT_IDS],
  separator: ' · ',
  mode: 'widget',
});

function parseConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };

  // An explicitly empty array is a real choice — every segment off — so it must
  // survive rather than falling back to defaults the way a missing key does.
  const segments = Array.isArray(raw.segments)
    ? raw.segments.filter((s) => SEGMENT_IDS.includes(s))
    : [...DEFAULT_CONFIG.segments];

  const separator = typeof raw.separator === 'string' ? raw.separator : DEFAULT_CONFIG.separator;
  const mode = raw.mode === 'full' ? 'full' : DEFAULT_CONFIG.mode;

  return { segments, separator, mode };
}

/**
 * Project statusline config, falling back to the user config dir when the
 * project has none, and defaults when neither exists. Never throws. Returns
 * the resolved config plus the absolute path it was read from, or null when
 * neither candidate parsed and defaults were used.
 */
function loadConfig(cwd) {
  const projectPath = path.join(cwd, '.superpowers', 'statusline.json');
  const configDirPath = path.join(configDir(), 'superpowers', 'statusline.json');

  for (const candidate of [projectPath, configDirPath]) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch {
      continue;
    }
    return { ...parseConfig(raw), path: candidate };
  }

  return { ...DEFAULT_CONFIG, path: null };
}

export { loadConfig, DEFAULT_CONFIG, SEGMENT_IDS };
