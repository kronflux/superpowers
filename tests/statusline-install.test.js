import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { installLauncher, patchSettings, ensureGitignored } from '../hooks/lib/statusline-install.js';

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
  it('creates the file and adds the block', () => {
    const cwd = path.join(root, 'p1'); fs.mkdirSync(cwd, { recursive: true });
    expect(patchSettings(cwd, 'node /x/launcher.mjs').changed).toBe(true);
    const j = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(j.statusLine.type).toBe('command');
    expect(j.statusLine.command).toBe('node /x/launcher.mjs');
  });

  it('preserves unrelated keys', () => {
    const cwd = path.join(root, 'p2');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash'] } }));
    patchSettings(cwd, 'node /x/launcher.mjs');
    const j = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(j.permissions.allow).toEqual(['Bash']);
    expect(j.statusLine).toBeTruthy();
  });

  it('is idempotent', () => {
    const cwd = path.join(root, 'p3'); fs.mkdirSync(cwd, { recursive: true });
    expect(patchSettings(cwd, 'node /x/launcher.mjs').changed).toBe(true);
    expect(patchSettings(cwd, 'node /x/launcher.mjs').changed).toBe(false);
  });

  it('reports "unparseable" and leaves a malformed settings file byte-for-byte untouched', () => {
    // Real settings files carry permissions, hooks, model, API keys. A single
    // typo (trailing comma below) must never be treated as "no file" and
    // silently replaced with a fresh {statusLine: ...} object.
    const cwd = path.join(root, 'p4');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    const file = path.join(cwd, '.claude', 'settings.json');
    const before = '{\n  "permissions": {"allow": ["Bash"]},\n  "model": "opus",\n  "hooks": {},\n}\n';
    fs.writeFileSync(file, before);
    const result = patchSettings(cwd, 'node /x/launcher.mjs');
    expect(result).toEqual({ changed: false, state: 'unparseable' });
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
