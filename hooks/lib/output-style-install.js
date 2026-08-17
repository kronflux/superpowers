// hooks/lib/output-style-install.js — places the shipped Signal output style in the
// active config root so Claude Code lists it and can load it into the system prompt.
// An output style reaches the model on every turn; a skill's guidance reaches it only
// when that skill is read, which is why presence is established without being asked for.
import fs from 'fs';
import path from 'path';
import { configDir } from './config-dir.js';

const STYLE_FILE = 'signal.md';
const STYLE_NAME = 'Signal';

/** Absolute path the style occupies inside a config root. */
function stylePath(configRoot) {
  return path.join(configRoot, 'output-styles', STYLE_FILE);
}

/**
 * Copy the shipped style into the config root when no file of that name is there.
 *
 * An existing file is never overwritten: once the operator has the style, its
 * contents are theirs to edit, and a plugin update that silently replaced local
 * wording would discard that edit with no record. Returns one of 'installed',
 * 'present', or 'skipped'; every fault yields 'skipped' and no throw, since this
 * runs on the SessionStart path where a failure must not block the session.
 */
function ensureStylePresent(pluginRoot, env = process.env) {
  try {
    const source = path.join(pluginRoot, 'output-styles', STYLE_FILE);
    if (!fs.existsSync(source)) return 'skipped';

    const target = stylePath(configDir(env));
    if (fs.existsSync(target)) return 'present';

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(source, 'utf8'));
    return 'installed';
  } catch {
    return 'skipped';
  }
}

/** The value `outputStyle` carries in settings when this style is selected. */
function styleName() {
  return STYLE_NAME;
}

export { ensureStylePresent, stylePath, styleName, STYLE_FILE, STYLE_NAME };
