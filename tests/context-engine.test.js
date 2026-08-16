import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
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
