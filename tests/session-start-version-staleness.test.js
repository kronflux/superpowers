import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { staleWarning, newestVersionDir } from '../hooks/lib/session-start-version-staleness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'session-start').replace(/\\/g, '/');

function dirOf(bin) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && exts.some((ext) => fs.existsSync(path.join(dir, bin + ext)))) return dir;
  }
  return null;
}
const SANDBOX_PATH = [dirOf('bash'), dirOf('node')]
  .filter(Boolean)
  .filter((d, i, arr) => arr.indexOf(d) === i)
  .join(path.delimiter);

let root;
function withScratch(fn) {
  root = fs.mkdtempSync(path.join(spTmpDir(), 'sp-staleness-'));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function cacheDir(configRoot, version) {
  const dir = path.join(configRoot, 'plugins', 'cache', 'superpowers-dev', 'superpowers', version);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('staleWarning (unit)', () => {
  it('emits nothing when the loaded version is the newest cached', () => {
    withScratch((scratch) => {
      cacheDir(scratch, '7.15.0');
      expect(staleWarning(path.join('x', '7.15.0'), scratch)).toBeNull();
    });
  });

  it('emits one line naming both versions on a mismatch', () => {
    withScratch((scratch) => {
      cacheDir(scratch, '7.4.0');
      cacheDir(scratch, '7.15.0');
      cacheDir(scratch, '7.16.0');
      const line = staleWarning(path.join('x', '7.15.0'), scratch);
      expect(line).not.toBeNull();
      expect(line).toContain('7.15.0');
      expect(line).toContain('7.16.0');
    });
  });

  it('semantic ordering: a cache of 7.4.0, 7.9.0, 7.15.0, 7.16.0 resolves 7.16.0 as newest', () => {
    // '7.9.0' sorts AFTER '7.16.0' lexically ('9' > '1'), so a collation-based
    // compare would report no staleness here even though 7.16.0 is cached.
    withScratch((scratch) => {
      cacheDir(scratch, '7.4.0');
      cacheDir(scratch, '7.9.0');
      cacheDir(scratch, '7.15.0');
      cacheDir(scratch, '7.16.0');
      expect(newestVersionDir(path.join(scratch, 'plugins', 'cache', 'superpowers-dev', 'superpowers'))).toBe('7.16.0');
      const line = staleWarning(path.join('x', '7.9.0'), scratch);
      expect(line).toContain('7.9.0');
      expect(line).toContain('7.16.0');
    });
  });

  it('emits nothing when the marketplace cache directory does not exist at all', () => {
    withScratch((scratch) => {
      expect(fs.existsSync(path.join(scratch, 'plugins'))).toBe(false);
      expect(staleWarning(path.join('x', '7.15.0'), scratch)).toBeNull();
    });
  });

  it('emits nothing when the cache is unreadable (a file where a directory is expected)', () => {
    withScratch((scratch) => {
      const base = path.join(scratch, 'plugins', 'cache', 'superpowers-dev');
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(path.join(base, 'superpowers'), 'not a directory');
      expect(staleWarning(path.join('x', '7.15.0'), scratch)).toBeNull();
    });
  });

  it('emits nothing when the loaded path does not parse as a version', () => {
    withScratch((scratch) => {
      cacheDir(scratch, '7.16.0');
      expect(staleWarning(path.join('x', 'dev-build'), scratch)).toBeNull();
    });
  });

  it('emits nothing for an absent pluginRoot', () => {
    withScratch((scratch) => {
      cacheDir(scratch, '7.16.0');
      expect(staleWarning(undefined, scratch)).toBeNull();
      expect(staleWarning('', scratch)).toBeNull();
    });
  });

  it('never deletes anything under the cache it inspects', () => {
    withScratch((scratch) => {
      cacheDir(scratch, '7.4.0');
      cacheDir(scratch, '7.15.0');
      staleWarning(path.join('x', '7.4.0'), scratch);
      expect(fs.existsSync(path.join(scratch, 'plugins', 'cache', 'superpowers-dev', 'superpowers', '7.4.0'))).toBe(true);
      expect(fs.existsSync(path.join(scratch, 'plugins', 'cache', 'superpowers-dev', 'superpowers', '7.15.0'))).toBe(true);
    });
  });
});

describe('session-start staleness line (integration)', () => {
  function runHook(scratch, pluginRoot) {
    const raw = execSync(`bash "${HOOK}"`, {
      cwd: scratch,
      input: '',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        HOME: scratch,
        CLAUDE_CONFIG_DIR: scratch,
        PATH: SANDBOX_PATH,
        COPILOT_CLI: '',
        CURSOR_PLUGIN_ROOT: '',
      },
    }).toString();
    const parsed = JSON.parse(raw);
    return parsed?.hookSpecificOutput?.additionalContext ?? raw;
  }

  it('a superseded load emits a [plugin] line naming both versions', () => {
    withScratch((scratch) => {
      cacheDir(scratch, '7.15.0');
      cacheDir(scratch, '7.16.0');
      const ctx = runHook(scratch, path.join(scratch, 'plugin-install', '7.15.0'));
      expect(ctx).toMatch(/\[plugin\] loaded 7\.15\.0.*7\.16\.0/);
    });
  });

  it('the newest load emits no [plugin] line', () => {
    withScratch((scratch) => {
      cacheDir(scratch, '7.16.0');
      const ctx = runHook(scratch, path.join(scratch, 'plugin-install', '7.16.0'));
      expect(ctx).not.toContain('[plugin] loaded');
    });
  });

  it('an absent marketplace cache emits no [plugin] line and does not fault', () => {
    withScratch((scratch) => {
      const ctx = runHook(scratch, path.join(scratch, 'plugin-install', '7.16.0'));
      expect(ctx).not.toContain('[plugin] loaded');
    });
  });
});
