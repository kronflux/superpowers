import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { discover, load, save, scan, ledgerPath } from '../scripts/reference-ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'scripts', 'reference-ledger.mjs');

/**
 * A real git repo with one commit, in 2 spawns instead of 5: `--allow-empty`
 * plus inline `-c` config skips separate `git config` calls, and no working-
 * tree content is needed here - only a commit that produces a sha and a date.
 * Subprocess spawns on this machine cost roughly 1s each (antivirus
 * scanning), so this file's runtime is dominated by spawn count, not by
 * anything vitest or Node itself does.
 */
function mkRepo(dir, name, msg = 'c0') {
  const repo = path.join(dir, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'pipe' });
  addCommit(repo, msg);
  return repo;
}

/** One more commit on an existing repo, in a single spawn. */
function addCommit(repo, msg) {
  execFileSync('git', ['-C', repo,
    '-c', 'user.email=t@example.com', '-c', 'user.name=Test',
    'commit', '-q', '--allow-empty', '-m', msg], { stdio: 'pipe' });
}

function newRoot() {
  return fs.mkdtempSync(path.join(spTmpDir(), 'refledger-'));
}

function readLedger(refDir) {
  return JSON.parse(fs.readFileSync(ledgerPath(refDir), 'utf8'));
}

function writeLedger(refDir, obj) {
  fs.writeFileSync(ledgerPath(refDir), JSON.stringify(obj, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Behavior: exercised in-process against the real exported functions - no
// `node` subprocess per assertion. Tasks 2-5 import these same exports, so
// this is also the more representative test, not just the faster one.
// ---------------------------------------------------------------------------

describe('discover and scan — multi-repo fixture', () => {
  let root;
  beforeAll(() => {
    root = newRoot();
    mkRepo(root, 'alpha');
    mkRepo(root, 'beta');
    fs.mkdirSync(path.join(root, 'notarepo'), { recursive: true });
    mkRepo(path.join(root, '_archive'), 'retired');
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  beforeEach(() => fs.rmSync(ledgerPath(root), { force: true }));

  it('discover returns only immediate git-repo subdirectories, sorted, excluding _archive', () => {
    expect(discover(root)).toEqual(['alpha', 'beta']);
  });

  it('records head and headDate for every discovered repo', () => {
    scan(root);
    const l = readLedger(root);
    expect(Object.keys(l.repos).sort()).toEqual(['alpha', 'beta']);
    expect(l.repos.alpha.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(l.repos.alpha.headDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(l.repos.alpha.status).toBe('active');
    expect(l.repos.beta.status).toBe('active');
  });
});

describe('scan — merge behavior on a single-repo fixture', () => {
  let root;
  beforeAll(() => {
    root = newRoot();
    mkRepo(root, 'alpha');
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  beforeEach(() => fs.rmSync(ledgerPath(root), { force: true }));

  it('preserves an existing consumed block unchanged across a scan', () => {
    // Seeded in-process (no scan needed to establish it) so this test costs
    // exactly one real scan, not two.
    save(root, {
      schema: 1,
      updatedAt: null,
      repos: {
        alpha: {
          status: 'active', head: 'stale12', headDate: '2020-01-01',
          consumed: { ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' },
        },
      },
    });
    scan(root);
    expect(readLedger(root).repos.alpha.consumed)
      .toEqual({ ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' });
  });

  it('NEVER creates a consumed block', () => {
    // The whole point of the ledger. A scan that advances consumed would make an
    // unreviewed backlog look reviewed - exactly the 2026-07-26 failure. Proven
    // by the very first scan of an entry with no prior consumed key: the merge
    // logic that governs it doesn't change on later passes, so one scan settles it.
    scan(root);
    expect(readLedger(root).repos.alpha.consumed).toBeUndefined();
  });

  it('skips repos already marked archived', () => {
    save(root, {
      schema: 1,
      updatedAt: null,
      repos: { alpha: { status: 'archived', archivedAt: '2026-01-01', reason: 'dormant' } },
    });
    scan(root);
    expect(readLedger(root).repos.alpha).toEqual({
      status: 'archived', archivedAt: '2026-01-01', reason: 'dormant',
    });
  });

  it('is idempotent apart from updatedAt', () => {
    scan(root);
    const first = readLedger(root);
    scan(root);
    const second = readLedger(root);
    expect({ ...second, updatedAt: null }).toEqual({ ...first, updatedAt: null });
  });
});

describe('scan — HEAD advances between scans', () => {
  // Isolated from the fixture above because this test mutates the repo's
  // history; sharing it would make sibling tests depend on execution order.
  let root;
  beforeAll(() => {
    root = newRoot();
    mkRepo(root, 'alpha');
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('updates head on a subsequent scan while preserving a pre-existing consumed block', () => {
    // Fails if the `{ ...prev, status, head, headDate }` spread order in scan()
    // is ever reversed: stale prev.head would win and freeze head forever,
    // while a "consumed never appears" style test would stay green regardless.
    scan(root);
    const firstHead = readLedger(root).repos.alpha.head;

    const l = readLedger(root);
    l.repos.alpha.consumed = { ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' };
    writeLedger(root, l);

    addCommit(path.join(root, 'alpha'), 'c1');
    scan(root);
    const after = readLedger(root).repos.alpha;
    expect(after.head).not.toBe(firstHead);
    expect(after.consumed)
      .toEqual({ ref: 'deadbee', date: '2026-01-01', workstream: 'upstream-sync' });
  });
});

describe('load — corrupt or invalid ledger file', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('throws on a truncated ledger and leaves the file byte-identical', () => {
    const p = ledgerPath(root);
    const truncated = '{"schema":1,"updated';
    fs.writeFileSync(p, truncated);
    expect(() => load(root)).toThrow();
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
    it(`throws on ${label} and leaves the file untouched`, () => {
      const p = ledgerPath(root);
      fs.writeFileSync(p, content);
      expect(() => load(root)).toThrow();
      expect(fs.readFileSync(p, 'utf8')).toBe(content);
    });
  }

  it('returns a fresh ledger when the file is absent, without creating one', () => {
    // Guards against over-correcting the corrupt-ledger fix into rejecting the
    // legitimate first-run case.
    expect(load(root)).toEqual({ schema: 1, updatedAt: null, repos: {} });
    expect(fs.existsSync(ledgerPath(root))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI contract: a small number of real subprocess round trips, just enough to
// prove main() maps in-process outcomes to process behavior (exit code,
// stderr, no write). Ledger *content* is covered above, in-process, against
// the same exports Tasks 2-5 will import.
// ---------------------------------------------------------------------------

function runCli(refDir, args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, SUPERPOWERS_REFERENCE_DIR: refDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('CLI contract', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a thrown load becomes a non-zero exit, a one-line stderr message, and no write', () => {
    const p = ledgerPath(root);
    const truncated = '{"schema":1,"updated';
    fs.writeFileSync(p, truncated);
    const result = runCli(root, ['scan']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(fs.readFileSync(p, 'utf8')).toBe(truncated);
  });

  it('an absent reference directory exits non-zero and creates no file', () => {
    const missing = path.join(root, 'nope');
    const result = runCli(missing, ['scan']);
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(path.join(missing, '.sync-ledger.json'))).toBe(false);
  });

  it('a successful scan exits 0', () => {
    mkRepo(root, 'alpha');
    const result = runCli(root, ['scan']);
    expect(result.status).toBe(0);
    expect(fs.existsSync(ledgerPath(root))).toBe(true);
  });
});
