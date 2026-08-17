import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { ensureStylePresent, stylePath, styleName } from '../hooks/lib/output-style-install.js';

const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let configRoot;
let env;

beforeEach(() => {
  configRoot = fs.mkdtempSync(path.join(spTmpDir(), 'sp-style-'));
  env = { CLAUDE_CONFIG_DIR: configRoot };
});

afterEach(() => {
  fs.rmSync(configRoot, { recursive: true, force: true });
});

describe('output style install', () => {
  it('writes the style into a config root that does not have it', () => {
    expect(ensureStylePresent(PLUGIN_ROOT, env)).toBe('installed');
    expect(fs.existsSync(stylePath(configRoot))).toBe(true);
  });

  it('writes the shipped bytes, not a placeholder', () => {
    ensureStylePresent(PLUGIN_ROOT, env);
    const written = fs.readFileSync(stylePath(configRoot), 'utf8');
    const shipped = fs.readFileSync(path.join(PLUGIN_ROOT, 'output-styles', 'signal.md'), 'utf8');
    expect(written).toBe(shipped);
  });

  it('creates the output-styles directory when it is absent', () => {
    expect(fs.existsSync(path.join(configRoot, 'output-styles'))).toBe(false);
    ensureStylePresent(PLUGIN_ROOT, env);
    expect(fs.existsSync(path.join(configRoot, 'output-styles'))).toBe(true);
  });

  it('leaves an operator-edited style untouched', () => {
    const target = stylePath(configRoot);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'operator wording');

    expect(ensureStylePresent(PLUGIN_ROOT, env)).toBe('present');
    expect(fs.readFileSync(target, 'utf8')).toBe('operator wording');
  });

  it('reports skipped and does not throw when the plugin has no style to copy', () => {
    expect(ensureStylePresent(path.join(configRoot, 'no-such-plugin'), env)).toBe('skipped');
  });

  it('names the style the value settings must carry', () => {
    const frontmatter = fs.readFileSync(path.join(PLUGIN_ROOT, 'output-styles', 'signal.md'), 'utf8');
    expect(frontmatter).toMatch(new RegExp(`^name:\\s*${styleName()}$`, 'm'));
  });
});
