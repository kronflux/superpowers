import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'scripts', 'reference-ledger.mjs');

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(spTmpDir(), 'refledger-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

/** A throwaway git repo with `commits` commits. */
function mkRepo(dir, name, commits = 1) {
  const repo = path.join(dir, name);
  fs.mkdirSync(repo, { recursive: true });
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 'Test');
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(repo, `f${i}.txt`), String(i));
    g('add', `f${i}.txt`);
    g('commit', '-q', '-m', `c${i}`);
  }
  return repo;
}

function run(refDir, args) {
  return execFileSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SUPERPOWERS_REFERENCE_DIR: refDir },
  });
}

function ledger(refDir) {
  return JSON.parse(fs.readFileSync(path.join(refDir, '.sync-ledger.json'), 'utf8'));
}

describe('scan', () => {
  it('records head and headDate for every discovered repo', () => {
    mkRepo(root, 'alpha');
    mkRepo(root, 'beta');
    run(root, ['scan']);
    const l = ledger(root);
    expect(Object.keys(l.repos).sort()).toEqual(['alpha', 'beta']);
    expect(l.repos.alpha.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(l.repos.alpha.headDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(l.repos.alpha.status).toBe('active');
  });

  it('ignores directories that are not git repos, and _archive', () => {
    mkRepo(root, 'alpha');
    fs.mkdirSync(path.join(root, 'notarepo'), { recursive: true });
    mkRepo(path.join(root, '_archive'), 'retired');
    run(root, ['scan']);
    expect(Object.keys(ledger(root).repos)).toEqual(['alpha']);
  });

  it('preserves an existing consumed block unchanged', () => {
    mkRepo(root, 'alpha', 2);
    run(root, ['scan']);
    const l = ledger(root);
    l.repos.alpha.consumed = { ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' };
    fs.writeFileSync(path.join(root, '.sync-ledger.json'), JSON.stringify(l, null, 2) + '\n');
    run(root, ['scan']);
    expect(ledger(root).repos.alpha.consumed)
      .toEqual({ ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' });
  });

  it('NEVER creates a consumed block', () => {
    // The whole point of the ledger. A scan that advances consumed would make an
    // unreviewed backlog look reviewed - exactly the 2026-07-26 failure.
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    run(root, ['scan']);
    expect(ledger(root).repos.alpha.consumed).toBeUndefined();
  });

  it('skips repos already marked archived', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    const l = ledger(root);
    l.repos.alpha = { status: 'archived', archivedAt: '2026-01-01', reason: 'dormant' };
    fs.writeFileSync(path.join(root, '.sync-ledger.json'), JSON.stringify(l, null, 2) + '\n');
    run(root, ['scan']);
    expect(ledger(root).repos.alpha).toEqual({
      status: 'archived', archivedAt: '2026-01-01', reason: 'dormant',
    });
  });

  it('is idempotent apart from updatedAt', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    const first = ledger(root);
    run(root, ['scan']);
    const second = ledger(root);
    expect({ ...second, updatedAt: null }).toEqual({ ...first, updatedAt: null });
  });

  it('exits non-zero and writes nothing when the reference directory is absent', () => {
    const missing = path.join(root, 'nope');
    expect(() => run(missing, ['scan'])).toThrow();
    expect(fs.existsSync(path.join(missing, '.sync-ledger.json'))).toBe(false);
  });

  it('updates head on a subsequent scan while preserving a pre-existing consumed block', () => {
    // Fails if the `{ ...prev, status, head, headDate }` spread order in scan()
    // is ever reversed: stale prev.head would win and freeze head forever,
    // while a "consumed never appears" style test would stay green regardless.
    const repo = mkRepo(root, 'alpha');
    run(root, ['scan']);
    const firstHead = ledger(root).repos.alpha.head;

    const l = ledger(root);
    l.repos.alpha.consumed = { ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' };
    fs.writeFileSync(path.join(root, '.sync-ledger.json'), JSON.stringify(l, null, 2) + '\n');

    const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
    fs.writeFileSync(path.join(repo, 'f1.txt'), '1');
    g('add', 'f1.txt');
    g('commit', '-q', '-m', 'c1');

    run(root, ['scan']);
    const after = ledger(root).repos.alpha;
    expect(after.head).not.toBe(firstHead);
    expect(after.consumed)
      .toEqual({ ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' });
  });
});

describe('load — corrupt or invalid ledger file', () => {
  it('scan exits non-zero and leaves a truncated ledger file byte-identical', () => {
    mkRepo(root, 'alpha');
    const p = path.join(root, '.sync-ledger.json');
    const truncated = '{"schema":1,"updated';
    fs.writeFileSync(p, truncated);
    expect(() => run(root, ['scan'])).toThrow();
    expect(fs.readFileSync(p, 'utf8')).toBe(truncated);
  });

  // Valid JSON that isn't a ledger shape is no more safely overwritable than
  // truncated JSON - both must refuse rather than fall back to a fresh ledger.
  const notALedger = {
    'an array': '[]',
    'null': 'null',
    'a string': '"str"',
    'a number': '42',
    'a boolean': 'true',
    'an object with no repos key': '{}',
  };
  for (const [label, content] of Object.entries(notALedger)) {
    it(`scan exits non-zero and leaves ${label} untouched`, () => {
      mkRepo(root, 'alpha');
      const p = path.join(root, '.sync-ledger.json');
      fs.writeFileSync(p, content);
      expect(() => run(root, ['scan'])).toThrow();
      expect(fs.readFileSync(p, 'utf8')).toBe(content);
    });
  }

  it('an absent ledger still creates a fresh one and exits 0', () => {
    mkRepo(root, 'alpha');
    expect(() => run(root, ['scan'])).not.toThrow();
    expect(fs.existsSync(path.join(root, '.sync-ledger.json'))).toBe(true);
  });
});
