// hooks/lib/statusline-config.js — the statusline's project configuration.
//
// The interview writes this file; the renderer reads it. Keeping the choice in
// data rather than in a generated per-project script means one tested renderer
// serves every project, so a rendering bug is fixed once instead of once per repo.
import fs from 'fs';
import path from 'path';

const SEGMENT_IDS = ['capabilities', 'delegation', 'plan', 'usage'];

const DEFAULT_CONFIG = Object.freeze({
  segments: [...SEGMENT_IDS],
  separator: ' · ',
  mode: 'widget',
});

/** Project statusline config, or defaults. Never throws. */
function loadConfig(cwd) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(cwd, '.superpowers', 'statusline.json'), 'utf8'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
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

export { loadConfig, DEFAULT_CONFIG, SEGMENT_IDS };
