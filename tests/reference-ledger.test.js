import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { discover, load, save, scan, gap, ledgerPath, consume, archive, parseFlags, today, git } from '../scripts/reference-ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'scripts', 'reference-ledger.mjs');

/**
 * A real git repo with `count` commits, in `count + 1` spawns instead of
 * `count * 3`: `--allow-empty` plus inline `-c` config skips separate `git
 * config` calls, and no working-tree content is needed here - only commits
 * that produce a sha and a date. Subprocess spawns on this machine cost
 * roughly 1s each (antivirus scanning), so this file's runtime is dominated
 * by spawn count, not by anything vitest or Node itself does.
 */
function mkRepo(dir, name, count = 1) {
  const repo = path.join(dir, name);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'pipe' });
  for (let i = 0; i < count; i++) addCommit(repo, `c${i}`);
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

  it('scan() refuses a shape-invalid ledger through the same load-then-save pipeline proven above for a parse failure', () => {
    // load() rejecting a bad shape is necessary but not sufficient: the actual
    // hazard lives in scan()'s load() -> save() pipeline, and only the CLI
    // truncated-JSON test proves that path is safe - and only for a
    // JSON.parse SyntaxError. A later `try/catch` inside scan() that treats a
    // parse failure as fatal but falls back to a fresh ledger for a *shape*
    // failure would pass every load()-only test below while reintroducing the
    // original bug for six of seven corrupt shapes, undetected.
    const p = ledgerPath(root);
    const noRepos = '{}';
    fs.writeFileSync(p, noRepos);
    expect(() => scan(root)).toThrow();
    expect(fs.readFileSync(p, 'utf8')).toBe(noRepos);
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
    // More realistic than the synthetic shapes above: what a bad merge or a
    // hand-edit produces when schema/updatedAt survive but repos gets clobbered.
    'repos as an array': '{"schema":1,"updatedAt":null,"repos":[]}',
    'repos as a string': '{"schema":1,"updatedAt":null,"repos":"notanobject"}',
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

/** Aliases matching report tests' call shape: parsed ledger object, stdout-only CLI result. */
function ledger(refDir) {
  return readLedger(refDir);
}
function run(refDir, args) {
  return runCli(refDir, args).stdout;
}

function setConsumed(refDir, name, consumed) {
  const l = ledger(refDir);
  l.repos[name].consumed = consumed;
  fs.writeFileSync(path.join(refDir, '.sync-ledger.json'), JSON.stringify(l, null, 2) + '\n');
}

describe('report', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('counts commits from a consumed ref to HEAD', () => {
    const repo = mkRepo(root, 'alpha', 3);
    const first = execFileSync('git', ['-C', repo, 'rev-list', '--max-parents=0', 'HEAD'],
      { encoding: 'utf8' }).trim();
    run(root, ['scan']);
    setConsumed(root, 'alpha', { ref: first, date: '2026-01-01', workstream: 'upstream-sync' });
    expect(run(root, ['report'])).toMatch(/alpha.*2 commits/);
  });

  it('counts commits since a date-only consumed entry', () => {
    mkRepo(root, 'alpha', 2);
    run(root, ['scan']);
    setConsumed(root, 'alpha', { date: '2000-01-01', workstream: 'upstream-sync' });
    const out = run(root, ['report']);
    expect(out).toMatch(/2000-01-01 \(date\)/);
    expect(out).toMatch(/2 commits/);
  });

  it('prints never for a repo that has not been consumed', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    expect(run(root, ['report'])).toMatch(/alpha\s+\S+\s+never/);
  });

  it('prints unresolvable instead of throwing on a bad ref', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    setConsumed(root, 'alpha', { ref: 'nosuchref', date: '2026-01-01', workstream: 'x' });
    expect(run(root, ['report'])).toMatch(/unresolvable/);
  });

  it('writes nothing', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    const before = fs.readFileSync(path.join(root, '.sync-ledger.json'), 'utf8');
    run(root, ['report']);
    expect(fs.readFileSync(path.join(root, '.sync-ledger.json'), 'utf8')).toBe(before);
  });

  it('omits archived repos', () => {
    mkRepo(root, 'alpha');
    mkRepo(root, 'beta');
    run(root, ['scan']);
    const l = ledger(root);
    l.repos.beta = { status: 'archived', archivedAt: '2026-01-01', reason: 'dormant' };
    fs.writeFileSync(path.join(root, '.sync-ledger.json'), JSON.stringify(l, null, 2) + '\n');
    expect(run(root, ['report'])).not.toMatch(/beta/);
  });

  it('falls back to a readable label instead of "undefined" for a ref with no date', () => {
    const repo = mkRepo(root, 'alpha', 2);
    const first = execFileSync('git', ['-C', repo, 'rev-list', '--max-parents=0', 'HEAD'],
      { encoding: 'utf8' }).trim();
    run(root, ['scan']);
    setConsumed(root, 'alpha', { ref: first, workstream: 'upstream-sync' });
    const out = run(root, ['report']);
    expect(out).not.toMatch(/undefined/);
    expect(out).toMatch(new RegExp(`${first} \\(no date\\)`));
  });

  it('gap() treats a consumed entry with neither ref nor date as malformed, never as a 0 gap', () => {
    // Direct against gap(), not through report(): with neither field, the
    // date-only branch would otherwise run `git rev-list --since=undefined`,
    // which git accepts and answers with a real, misleading 0 - the exact
    // lie the function's own doc comment says count must never tell.
    mkRepo(root, 'alpha');
    const result = gap(root, 'alpha', { consumed: { workstream: 'upstream-sync' } });
    expect(result.count).toBeNull();
    expect(result.label).not.toMatch(/undefined/);
  });
});

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

  it('a thrown load through report becomes a non-zero exit, a one-line stderr message, and no stack trace', () => {
    const p = ledgerPath(root);
    const truncated = '{"schema":1,"updated';
    fs.writeFileSync(p, truncated);
    const result = runCli(root, ['report']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).not.toMatch(/^\s*at /m);
    expect(fs.readFileSync(p, 'utf8')).toBe(truncated);
  });

  it('an unprefixed error (a real bug, not a known operational failure) propagates with its full stack instead of being flattened', () => {
    // A shape-valid ledger load() happily accepts (repos is an object) but
    // with a null repo entry, which report()'s own status filter dereferences
    // without a null check - a stand-in for the future consume()/archive()
    // bug the discriminating catch exists to not swallow.
    const p = ledgerPath(root);
    fs.writeFileSync(p, JSON.stringify({ schema: 1, updatedAt: null, repos: { alpha: null } }));
    const result = runCli(root, ['report']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/^\s*at /m);
    expect(result.stderr.trim().split('\n').length).toBeGreaterThan(1);
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

describe('parseFlags', () => {
  it('treats --no-ref as a boolean, not a value-taking flag', () => {
    // If --no-ref ever fell into the generic `--k v` branch, it would swallow
    // the next token as its own value and shift every flag after it - the
    // parser bug that would make "--no-ref --date X" silently drop the date.
    const f = parseFlags(['alpha', 'obsidian-sync', '--no-ref', '--date', '2026-07-26']);
    expect(f._).toEqual(['alpha', 'obsidian-sync']);
    expect(f.noRef).toBe(true);
    expect(f.date).toBe('2026-07-26');
  });

  it('rejects an unrecognized flag instead of swallowing the next token as its value', () => {
    // Without this, --evil would consume '--by' as its own value, then 'x'
    // would fall through as the workstream positional - a recorded review
    // attributed to something the operator never typed.
    expect(() => parseFlags(['alpha', '--evil', '--by', 'x']))
      .toThrow(/^reference-ledger: unknown flag '--evil'/);
  });

  it('rejects --ref combined with --no-ref rather than letting one silently win', () => {
    expect(() => parseFlags(['alpha', '--ref', 'abc1234', '--no-ref']))
      .toThrow(/^reference-ledger: --ref and --no-ref are mutually exclusive/);
  });

  it('rejects a trailing flag with no value instead of resolving it to undefined', () => {
    expect(() => parseFlags(['alpha', '--by']))
      .toThrow(/^reference-ledger: flag '--by' requires a value/);
  });
});

describe('consume', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('records ref, date, workstream and by', () => {
    mkRepo(root, 'alpha');
    scan(root);
    const recorded = consume(root, 'alpha', 'upstream-sync', { by: 'abc1234' });
    expect(recorded.workstream).toBe('upstream-sync');
    expect(recorded.by).toBe('abc1234');
    expect(recorded.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(recorded.ref).toMatch(/^[0-9a-f]{7,}$/);
    expect(ledger(root).repos.alpha.consumed).toEqual(recorded);
  });

  it('defaults ref to live HEAD, not the stale head field', () => {
    const repo = mkRepo(root, 'alpha');
    scan(root);
    const staleHead = ledger(root).repos.alpha.head;
    // A commit lands after the scan; consume must see it, not the scan-time head.
    addCommit(repo, 'later');
    const liveHead = git(repo, ['log', '-1', '--format=%h']);
    const recorded = consume(root, 'alpha', 'upstream-sync');
    expect(recorded.ref).not.toBe(staleHead);
    expect(recorded.ref).toBe(liveHead);
  });

  it('honours an explicit ref and date', () => {
    mkRepo(root, 'alpha');
    scan(root);
    const recorded = consume(root, 'alpha', 'upstream-sync', { ref: 'd884ae0', date: '2026-07-10' });
    expect(recorded).toEqual({ ref: 'd884ae0', date: '2026-07-10', workstream: 'upstream-sync' });
  });

  it('records a date-only entry under --no-ref with an explicit date', () => {
    mkRepo(root, 'alpha');
    scan(root);
    const recorded = consume(root, 'alpha', 'obsidian-sync', { noRef: true, date: '2026-07-26' });
    expect(recorded).toEqual({ date: '2026-07-26', workstream: 'obsidian-sync' });
    expect('ref' in recorded).toBe(false);
  });

  it('never writes a consumed block lacking both ref and date: --no-ref with no --date still records today', () => {
    // The exact failure mode this tool exists to prevent: a consumed entry
    // with neither field makes gap() run `rev-list --since=undefined`, which
    // git answers with a real, misleading 0 - "up to date" for a repo never
    // reviewed. --no-ref alone must not be able to produce that shape.
    mkRepo(root, 'alpha');
    scan(root);
    const recorded = consume(root, 'alpha', 'obsidian-sync', { noRef: true });
    expect('ref' in recorded).toBe(false);
    expect(recorded.date).toBe(today());
  });

  it('refuses an unknown repo with a prefixed message and leaves the ledger byte-identical', () => {
    // Asserting the message shape, not just `.toThrow()`, is what pins the
    // guard: delete it and `ledger.repos['typo'].consumed = ...` still throws
    // a bare, unprefixed TypeError before any write - non-zero exit and an
    // untouched file would survive by accident, not because the guard works.
    mkRepo(root, 'alpha');
    scan(root);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    expect(() => consume(root, 'typo', 'upstream-sync'))
      .toThrow(/^reference-ledger: unknown repository 'typo'/);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('rejects a missing workstream and leaves the ledger untouched', () => {
    // consume() must validate this itself, not rely on main()'s CLI-only
    // usage check: Task 5 and other in-process callers bypass main() entirely,
    // and JSON.stringify would otherwise silently drop an undefined workstream,
    // persisting a consumed entry that doesn't say which review consumed it.
    mkRepo(root, 'alpha');
    scan(root);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    expect(() => consume(root, 'alpha', undefined))
      .toThrow(/^reference-ledger: workstream is required/);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('rejects an empty-string workstream and leaves the ledger untouched', () => {
    mkRepo(root, 'alpha');
    scan(root);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    expect(() => consume(root, 'alpha', ''))
      .toThrow(/^reference-ledger: workstream is required/);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('CLI: an unknown repo exits non-zero with a one-line prefixed message, no stack trace, and leaves the ledger byte-identical', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    const result = runCli(root, ['consume', 'typo', 'upstream-sync']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(/^reference-ledger: /);
    expect(result.stderr).not.toMatch(/^\s*at /m);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('CLI: a missing workstream argument exits non-zero', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    expect(runCli(root, ['consume', 'alpha']).status).not.toBe(0);
  });
});

describe('archive', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('moves the directory and marks the entry', () => {
    mkRepo(root, 'alpha');
    mkRepo(root, 'stale');
    run(root, ['scan']);
    run(root, ['archive', 'stale', '--reason', 'no commits in 5.4 months']);
    expect(fs.existsSync(path.join(root, 'stale'))).toBe(false);
    expect(fs.existsSync(path.join(root, '_archive', 'stale', '.git'))).toBe(true);
    const e = ledger(root).repos.stale;
    expect(e.status).toBe('archived');
    expect(e.reason).toBe('no commits in 5.4 months');
    expect(e.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stays archived across a later scan', () => {
    mkRepo(root, 'alpha');
    mkRepo(root, 'stale');
    run(root, ['scan']);
    run(root, ['archive', 'stale', '--reason', 'dormant']);
    run(root, ['scan']);
    expect(ledger(root).repos.stale.status).toBe('archived');
    expect(fs.existsSync(path.join(root, 'stale'))).toBe(false);
  });

  it('refuses when the archive destination already exists', () => {
    mkRepo(root, 'stale');
    run(root, ['scan']);
    mkRepo(path.join(root, '_archive'), 'stale');
    expect(runCli(root, ['archive', 'stale', '--reason', 'dormant']).status).not.toBe(0);
    // The source must survive a refused archive.
    expect(fs.existsSync(path.join(root, 'stale', '.git'))).toBe(true);
  });

  it('refuses an unknown reference name, with a prefixed one-line message and no stack trace', () => {
    // Message-shape assertion, not just a non-zero exit: a bare `.toThrow()`
    // or `.status !== 0` check would still pass if the ledger-membership
    // guard were deleted entirely, because renameSync's raw ENOENT on a
    // nonexistent source also exits non-zero.
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    const result = runCli(root, ['archive', 'nosuch', '--reason', 'dormant']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(/^reference-ledger: unknown repository 'nosuch'/);
    expect(result.stderr).not.toMatch(/^\s*at /m);
  });

  it('refuses a name the ledger never scanned even though a same-named stray directory exists on disk', () => {
    // Distinct failure from the ledger-has-it-but-disk-doesn't case below:
    // this is disk-has-it-but-the-ledger-never-scanned-it. Without the
    // ledger-membership check, archiving 'stray' would invent a fresh
    // 'archived' entry for something no scan ever observed.
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    fs.mkdirSync(path.join(root, 'stray'), { recursive: true });
    expect(() => archive(root, 'stray', 'dormant'))
      .toThrow(/^reference-ledger: unknown repository 'stray'/);
    expect(fs.existsSync(path.join(root, 'stray'))).toBe(true);
  });

  it('refuses when the ledger has the entry but the source directory is already gone from disk', () => {
    // The other half of the pair above: ledger says yes, disk says no.
    mkRepo(root, 'stale');
    run(root, ['scan']);
    fs.rmSync(path.join(root, 'stale'), { recursive: true, force: true });
    expect(() => archive(root, 'stale', 'dormant'))
      .toThrow(/^reference-ledger: no such reference 'stale'/);
  });

  it('refuses a name that escapes dir via path traversal, leaving the outside directory untouched', () => {
    // path.join(dir, '_archive', '..', name) for name === '../<outside>'
    // collapses back to a path outside _reference/ entirely - the
    // destination-exists check alone guards nothing against this.
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    const outsideName = `evil-${path.basename(root)}`;
    const outside = path.join(path.dirname(root), outsideName);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'marker.txt'), 'do-not-move');
    try {
      expect(() => archive(root, `../${outsideName}`, 'dormant'))
        .toThrow(/^reference-ledger: invalid reference name/);
      expect(fs.existsSync(path.join(outside, 'marker.txt'))).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a name containing a path separator outright', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    expect(() => archive(root, 'sub/evil', 'dormant'))
      .toThrow(/^reference-ledger: invalid reference name/);
  });

  it('refuses to archive the _archive directory itself, with a prefixed message and no stack trace', () => {
    mkRepo(root, 'alpha');
    run(root, ['scan']);
    fs.mkdirSync(path.join(root, '_archive'), { recursive: true });
    const result = runCli(root, ['archive', '_archive', '--reason', 'dormant']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(/^reference-ledger: '_archive' is not a reference/);
    expect(result.stderr).not.toMatch(/^\s*at /m);
  });

  it('refuses via a corrupt ledger without moving the directory first', () => {
    // The move must never happen before the ledger is confirmed readable and
    // writable: otherwise a load() failure strands a relocated directory
    // that nothing records as archived.
    mkRepo(root, 'stale');
    run(root, ['scan']);
    fs.writeFileSync(ledgerPath(root), '{"schema":1,"updated');
    expect(() => archive(root, 'stale', 'dormant')).toThrow();
    expect(fs.existsSync(path.join(root, 'stale', '.git'))).toBe(true);
    expect(fs.existsSync(path.join(root, '_archive', 'stale'))).toBe(false);
  });

  it('refuses a missing reason', () => {
    mkRepo(root, 'stale');
    run(root, ['scan']);
    expect(runCli(root, ['archive', 'stale']).status).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'stale', '.git'))).toBe(true);
  });

  it('never deletes: the archived tree is intact', () => {
    const repo = mkRepo(root, 'stale', 2);
    const before = fs.readdirSync(repo).sort();
    run(root, ['scan']);
    run(root, ['archive', 'stale', '--reason', 'dormant']);
    expect(fs.readdirSync(path.join(root, '_archive', 'stale')).sort()).toEqual(before);
  });

  it('rejects a missing reason in-process, not only through the CLI usage check', () => {
    // archive() must validate reason itself: Task 5 calls this export
    // directly, bypassing main()'s `!f.reason` usage check entirely. Deleting
    // the in-function guard would only fail here, not in any CLI-level test.
    mkRepo(root, 'stale');
    scan(root);
    expect(() => archive(root, 'stale', undefined))
      .toThrow(/^reference-ledger: reason is required/);
    expect(fs.existsSync(path.join(root, 'stale', '.git'))).toBe(true);
  });
});
