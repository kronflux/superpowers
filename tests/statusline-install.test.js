import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { installLauncher, patchSettings, ensureGitignored } from '../hooks/lib/statusline-install.js';
import { loadConfig } from '../hooks/lib/statusline-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER_SRC = path.join(__dirname, '..', 'scripts', 'statusline-launcher.mjs');

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(spTmpDir(), 'slinst-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function seedPlugin(cfgRoot, version, body) {
  const dir = path.join(cfgRoot, 'plugins', 'cache', 'superpowers-dev', 'superpowers', version, 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'statusline.mjs'), body);
  return dir;
}
function runLauncher(cfgRoot, launcher) {
  return execFileSync('node', [launcher], {
    input: '{}', encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgRoot },
  });
}

describe('launcher version resolution', () => {
  it('picks the highest version by semver, not lexically', () => {
    // '7.9.0' > '7.10.0' lexically. A string sort here would silently pin an
    // old plugin forever after the first two-digit minor.
    const cfgRoot = path.join(root, 'cfg');
    seedPlugin(cfgRoot, '7.9.0', 'process.stdout.write("NINE\\n");');
    seedPlugin(cfgRoot, '7.10.0', 'process.stdout.write("TEN\\n");');
    const launcher = installLauncher(cfgRoot, LAUNCHER_SRC);
    expect(runLauncher(cfgRoot, launcher).trim()).toBe('TEN');
  });

  it('follows a newer version that appears after install', () => {
    const cfgRoot = path.join(root, 'cfg2');
    seedPlugin(cfgRoot, '7.9.0', 'process.stdout.write("OLD\\n");');
    const launcher = installLauncher(cfgRoot, LAUNCHER_SRC);
    expect(runLauncher(cfgRoot, launcher).trim()).toBe('OLD');
    seedPlugin(cfgRoot, '7.11.0', 'process.stdout.write("NEW\\n");');
    expect(runLauncher(cfgRoot, launcher).trim()).toBe('NEW');
  });

  it('prints an empty line and exits 0 when no version is installed', () => {
    const cfgRoot = path.join(root, 'cfg3');
    fs.mkdirSync(cfgRoot, { recursive: true });
    const launcher = installLauncher(cfgRoot, LAUNCHER_SRC);
    expect(runLauncher(cfgRoot, launcher).trim()).toBe('');
  });
});

describe('patchSettings', () => {
  it('creates the file, adds the key, and returns the path it wrote', () => {
    const cwd = path.join(root, 'p1'); fs.mkdirSync(cwd, { recursive: true });
    const file = path.join(cwd, '.claude', 'settings.json');
    const result = patchSettings(cwd, 'statusLine', { type: 'command', command: 'node /x/launcher.mjs' });
    expect(result.changed).toBe(true);
    expect(result.path).toBe(file);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(j.statusLine.type).toBe('command');
    expect(j.statusLine.command).toBe('node /x/launcher.mjs');
  });

  it('preserves unrelated keys', () => {
    const cwd = path.join(root, 'p2');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash'] } }));
    patchSettings(cwd, 'statusLine', { type: 'command', command: 'node /x/launcher.mjs' });
    const j = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(j.permissions.allow).toEqual(['Bash']);
    expect(j.statusLine).toBeTruthy();
  });

  it('is idempotent and reports the path on the unchanged branch too', () => {
    const cwd = path.join(root, 'p3'); fs.mkdirSync(cwd, { recursive: true });
    const file = path.join(cwd, '.claude', 'settings.json');
    const first = patchSettings(cwd, 'statusLine', { type: 'command', command: 'node /x/launcher.mjs' });
    expect(first.changed).toBe(true);
    expect(first.path).toBe(file);
    const second = patchSettings(cwd, 'statusLine', { type: 'command', command: 'node /x/launcher.mjs' });
    expect(second.changed).toBe(false);
    expect(second.path).toBe(file);
  });

  it('reports "unparseable" with the refused path and leaves a malformed settings file byte-for-byte untouched', () => {
    // Real settings files carry permissions, hooks, model, API keys. A single
    // typo (trailing comma below) must never be treated as "no file" and
    // silently replaced with a fresh object.
    const cwd = path.join(root, 'p4');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    const file = path.join(cwd, '.claude', 'settings.json');
    const before = '{\n  "permissions": {"allow": ["Bash"]},\n  "model": "opus",\n  "hooks": {},\n}\n';
    fs.writeFileSync(file, before);
    const result = patchSettings(cwd, 'statusLine', { type: 'command', command: 'node /x/launcher.mjs' });
    expect(result).toEqual({ changed: false, path: file, state: 'unparseable' });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('treats valid-JSON non-objects as unparseable rather than throwing or lying', () => {
    // JSON.parse succeeds on these, so a `catch`-only guard lets them through:
    // `"str"` threw an uncaught TypeError on property assignment, and `[]`
    // reported changed:true while JSON.stringify silently dropped the added
    // key — a success report for a write that never landed.
    for (const [i, body] of ['[]', 'null', '"str"', '42', 'true'].entries()) {
      const cwd = path.join(root, `p5-${i}`);
      fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
      const file = path.join(cwd, '.claude', 'settings.json');
      fs.writeFileSync(file, body);
      let result;
      expect(() => { result = patchSettings(cwd, 'statusLine', { type: 'command', command: 'node /x/launcher.mjs' }); },
        `body ${body} must not throw`).not.toThrow();
      expect(result, `body ${body}`).toEqual({ changed: false, path: file, state: 'unparseable' });
      expect(fs.readFileSync(file, 'utf8'), `body ${body} must be untouched`).toBe(body);
    }
  });

  it('refuses a projectDir whose basename is already .claude, writing nothing and nesting nothing', () => {
    const cwd = path.join(root, 'p6', '.claude'); fs.mkdirSync(cwd, { recursive: true });
    const result = patchSettings(cwd, 'statusLine', { type: 'command', command: 'node /x/launcher.mjs' });
    expect(result.changed).toBe(false);
    expect(result.state).toBe('nested-claude-dir');
    expect(result.path).toBe(path.resolve(cwd));
    expect(fs.existsSync(path.join(cwd, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, 'settings.json'))).toBe(false);
  });

  it('patches an arbitrary top-level key, not only statusLine, and it reads back', () => {
    const cwd = path.join(root, 'p7'); fs.mkdirSync(cwd, { recursive: true });
    const result = patchSettings(cwd, 'outputStyle', 'Signal');
    expect(result.changed).toBe(true);
    const j = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(j.outputStyle).toBe('Signal');
  });

  it('options.settingsDir targets <settingsDir>/settings.json directly, bypassing the .claude join', () => {
    const cfgRoot = path.join(root, 'p8-cfg'); fs.mkdirSync(cfgRoot, { recursive: true });
    const result = patchSettings(null, 'outputStyle', 'Signal', { settingsDir: cfgRoot });
    expect(result.changed).toBe(true);
    expect(result.path).toBe(path.join(cfgRoot, 'settings.json'));
    const j = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(j.outputStyle).toBe('Signal');
  });

  it('options.settingsDir with a directory literally named .claude is not refused as nested', () => {
    // A user-global config root commonly IS named .claude (e.g. ~/.claude).
    // The nested-claude-dir guard exists to stop a project-root call from
    // acquiring a second .claude beneath it; settingsDir mode never joins
    // another .claude, so that guard must not fire here.
    const cfgRoot = path.join(root, 'p9', '.claude'); fs.mkdirSync(cfgRoot, { recursive: true });
    const result = patchSettings(null, 'outputStyle', 'Signal', { settingsDir: cfgRoot });
    expect(result.changed).toBe(true);
    expect(result.state).toBeUndefined();
    expect(result.path).toBe(path.join(cfgRoot, 'settings.json'));
  });

  it('options.filename targets settings.local.json alongside the default .claude join', () => {
    const cwd = path.join(root, 'p10'); fs.mkdirSync(cwd, { recursive: true });
    const result = patchSettings(cwd, 'outputStyle', 'Signal', { filename: 'settings.local.json' });
    expect(result.changed).toBe(true);
    expect(result.path).toBe(path.join(cwd, '.claude', 'settings.local.json'));
    expect(fs.existsSync(path.join(cwd, '.claude', 'settings.json'))).toBe(false);
    const j = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(j.outputStyle).toBe('Signal');
  });

  it('options.filename still reports "unparseable" without touching the malformed file', () => {
    const cwd = path.join(root, 'p11');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    const file = path.join(cwd, '.claude', 'settings.local.json');
    const before = '{ not json';
    fs.writeFileSync(file, before);
    const result = patchSettings(cwd, 'outputStyle', 'Signal', { filename: 'settings.local.json' });
    expect(result).toEqual({ changed: false, path: file, state: 'unparseable' });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('ensureGitignored', () => {
  function initRepo(name) {
    const cwd = path.join(root, name);
    fs.mkdirSync(cwd, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd });
    execFileSync('git', ['config', 'user.name', 't'], { cwd });
    return cwd;
  }

  it('reports "already" when a rule exists', () => {
    const cwd = initRepo('g1');
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.claude/\n');
    expect(ensureGitignored(cwd).state).toBe('already');
  });

  it('reports "added" and writes the rule when untracked and unignored', () => {
    const cwd = initRepo('g2');
    expect(ensureGitignored(cwd).state).toBe('added');
    expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toMatch(/^\.claude\/$/m);
  });

  it('reports "tracked" and writes NO rule when .claude is already tracked', () => {
    // A gitignore rule never untracks. Writing one here and reporting success
    // would tell the user the job is done when nothing changed.
    const cwd = initRepo('g3');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), '{}');
    execFileSync('git', ['add', '.claude/settings.json'], { cwd });
    expect(ensureGitignored(cwd).state).toBe('tracked');
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
  });

  it('treats a non-git directory as "added" rather than failing', () => {
    const cwd = path.join(root, 'g4'); fs.mkdirSync(cwd, { recursive: true });
    expect(ensureGitignored(cwd).state).toBe('added');
  });

  it('reports "unknown" and writes NO rule when the repo exists but the probe fails', () => {
    // A .git directory that exists but is not a valid repository makes any
    // git command inside it fail — standing in for lock contention,
    // permission errors, or a timeout against a genuinely tracked repo. The
    // probe cannot tell whether .claude/ is tracked here, so folding this
    // into "added" would risk writing a no-op rule and reporting success
    // against a repo that may have .claude/ tracked.
    const cwd = path.join(root, 'g5');
    fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
    expect(ensureGitignored(cwd).state).toBe('unknown');
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
  });
});

describe('loadConfig fallback to the config dir', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  let cwd, cfgDir;

  beforeEach(() => {
    cwd = path.join(root, 'lc-cwd'); fs.mkdirSync(cwd, { recursive: true });
    cfgDir = path.join(root, 'lc-cfg'); fs.mkdirSync(cfgDir, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });
  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  });

  function writeProjectConfig(obj) {
    fs.mkdirSync(path.join(cwd, '.superpowers'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.superpowers', 'statusline.json'), JSON.stringify(obj));
  }
  function writeConfigDirConfig(obj) {
    fs.mkdirSync(path.join(cfgDir, 'superpowers'), { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'superpowers', 'statusline.json'), JSON.stringify(obj));
  }

  it('prefers the project path when both exist', () => {
    writeProjectConfig({ separator: '|' });
    writeConfigDirConfig({ separator: '#' });
    const cfg = loadConfig(cwd);
    expect(cfg.separator).toBe('|');
    expect(cfg.path).toBe(path.join(cwd, '.superpowers', 'statusline.json'));
  });

  it('falls back to the config dir when the project path is absent', () => {
    writeConfigDirConfig({ separator: '#' });
    const cfg = loadConfig(cwd);
    expect(cfg.separator).toBe('#');
    expect(cfg.path).toBe(path.join(cfgDir, 'superpowers', 'statusline.json'));
  });

  it('reports which path it used', () => {
    writeProjectConfig({ separator: '|' });
    expect(loadConfig(cwd).path).toBe(path.join(cwd, '.superpowers', 'statusline.json'));

    fs.rmSync(path.join(cwd, '.superpowers', 'statusline.json'));
    writeConfigDirConfig({ separator: '#' });
    expect(loadConfig(cwd).path).toBe(path.join(cfgDir, 'superpowers', 'statusline.json'));

    fs.rmSync(path.join(cfgDir, 'superpowers', 'statusline.json'));
    expect(loadConfig(cwd).path).toBeNull();
  });
});
