import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureGitignored, SECTION_HEADER } from '../hooks/lib/gitignore.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, '../hooks/context-engine.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(spTmpDir(), 'sp-ce-'));
}

// A real repository, not a stub .git directory: the cleanup tests below
// need `git ls-files` to answer tracked-vs-untracked for real.
function initRepo() {
  const cwd = tmpDir();
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd });
  execFileSync('git', ['config', 'user.name', 't'], { cwd });
  return cwd;
}

function runHook(cwd) {
  return spawnSync('node', [HOOK], { input: JSON.stringify({ cwd }), encoding: 'utf8' });
}

describe('ensureGitignored (shared helper)', () => {
  let dir;
  beforeEach(() => {
    dir = tmpDir();
    // Helper writes only inside a repository, so tests must simulate one
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function gi() {
    return fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  }
  function count(haystack, needle) {
    return haystack.split(needle).length - 1;
  }

  it('is idempotent: calling twice writes one header and no duplicate entries', () => {
    ensureGitignored(dir, ['context-snapshot.json']);
    ensureGitignored(dir, ['context-snapshot.json']);
    const out = gi();
    expect(count(out, SECTION_HEADER)).toBe(1);
    expect(count(out, 'context-snapshot.json')).toBe(1);
  });

  it('reuses the existing section header for new entries (Task 10 reuse path)', () => {
    ensureGitignored(dir, ['context-snapshot.json']);
    ensureGitignored(dir, ['edit-log.jsonl']); // simulates track-edits adding its own entry
    const out = gi();
    expect(count(out, SECTION_HEADER)).toBe(1);
    expect(count(out, 'context-snapshot.json')).toBe(1);
    expect(count(out, 'edit-log.jsonl')).toBe(1);
  });

  it('preserves pre-existing gitignore content', () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    ensureGitignored(dir, ['context-snapshot.json']);
    const out = gi();
    expect(out).toContain('node_modules');
    expect(out).toContain('context-snapshot.json');
    expect(count(out, SECTION_HEADER)).toBe(1);
  });
});

describe('context-engine hook', () => {
  let dir;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('emits {} and writes no snapshot outside a git repo', () => {
    const res = spawnSync('node', [HOOK], {
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout || '{}')).toEqual({});
    expect(fs.existsSync(path.join(dir, 'context-snapshot.json'))).toBe(false);
  });
});

describe('context-engine snapshot relocation', () => {
  let dir;
  beforeEach(() => { dir = initRepo(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function legacySnapshot() {
    return path.join(dir, 'context-snapshot.json');
  }
  function schemaBody() {
    return JSON.stringify({ generated_at: new Date().toISOString(), git_hash: 'deadbeef' });
  }

  it('writes the snapshot under .superpowers/, not the project root', () => {
    const res = runHook(dir);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout || '{}')).toEqual({});
    expect(fs.existsSync(path.join(dir, '.superpowers', 'context-snapshot.json'))).toBe(true);
    expect(fs.existsSync(legacySnapshot())).toBe(false);
  });

  it('creates no .gitignore', () => {
    runHook(dir);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
  });

  it('deletes an untracked root-level snapshot matching the schema', () => {
    fs.writeFileSync(legacySnapshot(), schemaBody());
    runHook(dir);
    expect(fs.existsSync(legacySnapshot())).toBe(false);
  });

  it('leaves a tracked root-level snapshot in place', () => {
    fs.writeFileSync(legacySnapshot(), schemaBody());
    execFileSync('git', ['add', 'context-snapshot.json'], { cwd: dir });
    runHook(dir);
    expect(fs.existsSync(legacySnapshot())).toBe(true);
  });

  it('leaves a root-level file in place when it does not parse as JSON', () => {
    fs.writeFileSync(legacySnapshot(), '{not json');
    runHook(dir);
    expect(fs.readFileSync(legacySnapshot(), 'utf8')).toBe('{not json');
  });

  it('leaves a root-level file in place when it parses but lacks git_hash', () => {
    const body = JSON.stringify({ generated_at: new Date().toISOString() });
    fs.writeFileSync(legacySnapshot(), body);
    runHook(dir);
    expect(fs.readFileSync(legacySnapshot(), 'utf8')).toBe(body);
  });

  it('still emits {} when the cleanup path throws', () => {
    // A bare JSON literal parses cleanly but is not an object, so the
    // `in` check below the parse throws — proving the outer guard in
    // main() protects the {} contract rather than cleanup being unreachable.
    fs.writeFileSync(legacySnapshot(), 'null');
    const res = runHook(dir);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout || '{}')).toEqual({});
  });
});
