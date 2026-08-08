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

  it('resumes an entry hand-marked archived once its directory is found present again, clearing archivedAt/reason', () => {
    // This fixture's 'alpha' directory lives at dir/alpha throughout the
    // describe block (see beforeAll above) - so an entry marked 'archived'
    // here is exactly the revival case (directory present under its
    // original name), not the properly-archived case (directory moved under
    // _archive/, so discover() never lists it and this loop never reaches
    // it). See the 'archive' suite for the full archive()-then-`mv`-back
    // round trip and the sibling "stays archived while the directory is
    // still absent" case.
    save(root, {
      schema: 1,
      updatedAt: null,
      repos: { alpha: { status: 'archived', archivedAt: '2026-01-01', reason: 'dormant' } },
    });
    scan(root);
    const after = readLedger(root).repos.alpha;
    expect(after.status).toBe('active');
    expect('archivedAt' in after).toBe(false);
    expect('reason' in after).toBe(false);
    expect(after.head).toMatch(/^[0-9a-f]{7,}$/);
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

describe('scan — reported counts', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reports what it actually scanned this run, not a stale count of every active ledger entry', () => {
    // Reproduced against the unfixed code: beta's ledger entry stays
    // 'active' from the first scan even after its directory is gone, so
    // `Object.values(ledger.repos).filter(active).length` counted it again
    // on the second scan even though this run never touched it.
    mkRepo(root, 'alpha');
    mkRepo(root, 'beta');
    expect(runCli(root, ['scan']).stdout).toMatch(/^scanned 2 reference repositories\n$/);
    fs.rmSync(path.join(root, 'beta'), { recursive: true, force: true });
    const second = runCli(root, ['scan']);
    expect(second.stdout).toMatch(/^scanned 1 reference repositories\n$/);
    expect(second.stdout).not.toMatch(/scanned 2/);
  });

  it('does not count a repo skipped on a git-log failure (no commits yet) as scanned', () => {
    mkRepo(root, 'alpha');
    const emptyRepo = path.join(root, 'empty');
    fs.mkdirSync(emptyRepo, { recursive: true });
    execFileSync('git', ['-C', emptyRepo, 'init', '-q'], { stdio: 'pipe' });
    const result = runCli(root, ['scan']);
    expect(result.stdout).toMatch(/^scanned 1 reference repositories, skipped 1\n$/);
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

/** Builds on readLedger/writeLedger above rather than re-implementing the write. */
function setConsumed(refDir, name, consumed) {
  const l = readLedger(refDir);
  l.repos[name].consumed = consumed;
  writeLedger(refDir, l);
}

describe('report', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('counts commits from a consumed ref to HEAD', () => {
    const repo = mkRepo(root, 'alpha', 3);
    const first = execFileSync('git', ['-C', repo, 'rev-list', '--max-parents=0', 'HEAD'],
      { encoding: 'utf8' }).trim();
    expect(runCli(root, ['scan']).status).toBe(0);
    setConsumed(root, 'alpha', { ref: first, date: '2026-01-01', workstream: 'upstream-sync' });
    expect(runCli(root, ['report']).stdout).toMatch(/alpha.*2 commits/);
  });

  it('counts commits since a date-only consumed entry', () => {
    mkRepo(root, 'alpha', 2);
    expect(runCli(root, ['scan']).status).toBe(0);
    setConsumed(root, 'alpha', { date: '2000-01-01', workstream: 'upstream-sync' });
    const out = runCli(root, ['report']).stdout;
    expect(out).toMatch(/2000-01-01 \(date\)/);
    expect(out).toMatch(/2 commits/);
  });

  it('prints never for a repo that has not been consumed', () => {
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['report']).stdout).toMatch(/alpha\s+\S+\s+never/);
  });

  it('prints unresolvable instead of throwing on a bad ref', () => {
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
    // Hex-shaped so it passes gap()'s resolved-ref check and reaches git,
    // which is the path this test exercises; a non-hex string like the
    // literal 'nosuchref' is now refused earlier, before ever calling git
    // (see 'gap — defensive validation of a hand-edited ledger').
    setConsumed(root, 'alpha', { ref: 'deadbeef', date: '2026-01-01', workstream: 'x' });
    expect(runCli(root, ['report']).stdout).toMatch(/unresolvable/);
  });

  it('writes nothing', () => {
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    expect(runCli(root, ['report']).status).toBe(0);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('keeps archived repos out of the main table but lists them in a trailing archived section', () => {
    mkRepo(root, 'alpha');
    mkRepo(root, 'beta');
    expect(runCli(root, ['scan']).status).toBe(0);
    const l = readLedger(root);
    l.repos.beta = { status: 'archived', archivedAt: '2026-01-01', reason: 'dormant' };
    writeLedger(root, l);
    const out = runCli(root, ['report']).stdout;
    const [mainTable, archivedSection] = out.split(/\narchived:\n/);
    expect(mainTable).not.toMatch(/beta/);
    expect(archivedSection).toBeDefined();
    expect(archivedSection).toMatch(/beta\s+2026-01-01\s+dormant/);
  });

  it('omits the archived section entirely when nothing is archived', () => {
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['report']).stdout).not.toMatch(/archived:/);
  });

  it('falls back to a readable label instead of "undefined" for a ref with no date', () => {
    const repo = mkRepo(root, 'alpha', 2);
    const first = execFileSync('git', ['-C', repo, 'rev-list', '--max-parents=0', 'HEAD'],
      { encoding: 'utf8' }).trim();
    expect(runCli(root, ['scan']).status).toBe(0);
    setConsumed(root, 'alpha', { ref: first, workstream: 'upstream-sync' });
    const out = runCli(root, ['report']).stdout;
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
    expect(readLedger(root).repos.alpha.consumed).toEqual(recorded);
  });

  it('defaults ref to live HEAD, not the stale head field', () => {
    const repo = mkRepo(root, 'alpha');
    scan(root);
    const staleHead = readLedger(root).repos.alpha.head;
    // A commit lands after the scan; consume must see it, not the scan-time head.
    addCommit(repo, 'later');
    const liveHead = git(repo, ['log', '-1', '--format=%h']);
    const recorded = consume(root, 'alpha', 'upstream-sync');
    expect(recorded.ref).not.toBe(staleHead);
    expect(recorded.ref).toBe(liveHead);
  });

  it('resolves an explicit symbolic ref to a concrete short sha, honouring the explicit date', () => {
    // Not stored verbatim: an earlier version wrote opts.ref straight through,
    // so 'HEAD' (or any moving ref) never resolved differently on a later
    // report - a permanent 0 gap. See the dedicated regression test below.
    const repo = mkRepo(root, 'alpha', 2);
    scan(root);
    const resolved = git(repo, ['rev-parse', '--short', 'HEAD~1']);
    const recorded = consume(root, 'alpha', 'upstream-sync', { ref: 'HEAD~1', date: '2026-07-10' });
    expect(recorded).toEqual({ ref: resolved, date: '2026-07-10', workstream: 'upstream-sync' });
  });

  it('normalises a pasted 40-character sha to short form', () => {
    const repo = mkRepo(root, 'alpha');
    scan(root);
    const full = git(repo, ['rev-parse', 'HEAD']);
    const recorded = consume(root, 'alpha', 'upstream-sync', { ref: full });
    expect(recorded.ref).toMatch(/^[0-9a-f]{7,12}$/);
    expect(recorded.ref.length).toBeLessThan(full.length);
  });

  it('rejects an unresolvable --ref with a prefixed error and leaves the ledger untouched', () => {
    mkRepo(root, 'alpha');
    scan(root);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    expect(() => consume(root, 'alpha', 'upstream-sync', { ref: 'nosuchref' }))
      .toThrow(/^reference-ledger: 'nosuchref' does not resolve to a commit in 'alpha'/);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('resolving --ref HEAD to a concrete sha keeps the gap accurate as commits land (regression: a stored symbolic ref used to freeze the gap at 0 forever)', () => {
    const repo = mkRepo(root, 'alpha', 3);
    scan(root);
    consume(root, 'alpha', 'upstream-sync', { ref: 'HEAD' });
    addCommit(repo, 'c3');
    addCommit(repo, 'c4');
    scan(root);
    const g = gap(root, 'alpha', readLedger(root).repos.alpha);
    expect(g.count).toBe(2);
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

  it('rejects invalid or ambiguous --date values instead of letting git approxidate silently misinterpret them', () => {
    // Reproduced against the unfixed code: --no-ref --date 2026-13-45 recorded
    // a consumed block that reported 0 commits - git's approxidate accepts
    // almost any string with exit 0. garbage, yesterday, and 07-10-2026 all
    // resolve to *something*; 2026-02-30 parses by silently rolling over to
    // March 2 rather than failing.
    mkRepo(root, 'alpha');
    scan(root);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    for (const bad of ['2026-13-45', '2026-02-30', 'garbage', 'yesterday', '07-10-2026']) {
      expect(() => consume(root, 'alpha', 'upstream-sync', { noRef: true, date: bad }))
        .toThrow(/^reference-ledger: --date /);
    }
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('refuses to consume an archived repo instead of silently succeeding on a directory that has moved', () => {
    // Reproduced against the unfixed code: an archived entry still exists in
    // ledger.repos, so the membership guard alone passed, and --no-ref needs
    // no git call, so consume() wrote a consumed block that report() (which
    // filters archived entries) never displays.
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['archive', 'alpha', '--reason', 'dormant']).status).toBe(0);
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    const result = runCli(root, ['consume', 'alpha', 'upstream-sync', '--no-ref']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(/^reference-ledger: 'alpha' is archived/);
    expect(result.stderr).not.toMatch(/^\s*at /m);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('refuses when the directory is missing from disk even though the ledger still lists it', () => {
    mkRepo(root, 'alpha');
    scan(root);
    fs.rmSync(path.join(root, 'alpha'), { recursive: true, force: true });
    const before = fs.readFileSync(ledgerPath(root), 'utf8');
    expect(() => consume(root, 'alpha', 'upstream-sync', { noRef: true }))
      .toThrow(/^reference-ledger: no such reference 'alpha'/);
    expect(fs.readFileSync(ledgerPath(root), 'utf8')).toBe(before);
  });

  it('refuses a name containing a path separator outright (matches archive()\'s guard)', () => {
    mkRepo(root, 'alpha');
    scan(root);
    expect(() => consume(root, 'sub/evil', 'upstream-sync', { noRef: true }))
      .toThrow(/^reference-ledger: invalid reference name/);
  });

  it('CLI: an unknown repo exits non-zero with a one-line prefixed message, no stack trace, and leaves the ledger byte-identical', () => {
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
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
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['consume', 'alpha']).status).not.toBe(0);
  });
});

describe('gap — defensive validation of a hand-edited ledger', () => {
  // consume() rejects an invalid --date or a symbolic --ref at write time,
  // but gap() reads straight from load(), which accepts anything shape-valid
  // enough to parse as JSON, and the ledger is operator-editable JSON by
  // design. Neither guard may be reachable only through consume(); a
  // hand-edit must trip the same defenses.
  it('treats a hand-edited invalid consumed date as unresolvable, never as a git-approxidate guess', () => {
    const root = newRoot();
    try {
      mkRepo(root, 'alpha');
      const result = gap(root, 'alpha', { consumed: { date: 'garbage', workstream: 'x' } });
      expect(result.count).toBeNull();
      expect(result.label).toMatch(/invalid date/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a hand-edited consumed.ref of a symbolic ref like HEAD instead of re-resolving it fresh, which would report a permanent 0 gap', () => {
    // Reproduced against the unfixed code: consume() already resolves --ref
    // to a sha at write time, but nothing stopped a hand-edited
    // `ref: 'HEAD'` from reaching gap() unchecked. `HEAD..HEAD` is always 0,
    // no matter how many commits land, and the row looks completely healthy
    // - the exact symptom the write-side fix was supposed to eliminate,
    // reachable through the other door.
    const root = newRoot();
    try {
      const repo = mkRepo(root, 'alpha', 3);
      expect(runCli(root, ['scan']).status).toBe(0);
      const l = readLedger(root);
      l.repos.alpha.consumed = { ref: 'HEAD', date: '2026-08-01', workstream: 'upstream-sync' };
      writeLedger(root, l);
      addCommit(repo, 'c3');
      addCommit(repo, 'c4');
      expect(runCli(root, ['scan']).status).toBe(0);
      const result = gap(root, 'alpha', readLedger(root).repos.alpha);
      expect(result.count).toBeNull();
      expect(result.label).toMatch(/invalid ref/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('discover — junction mirrors (Windows)', () => {
  // A directory junction is the standard no-admin way to park a large clone
  // on another drive. Node reports it as isDirectory()=false,
  // isSymbolicLink()=true, so a plain isDirectory() filter drops it with no
  // warning and no "skipped" count. Feature-detected once at collection
  // time so a machine without junction-creation rights skips cleanly
  // instead of failing the suite.
  const junctionsSupported = (() => {
    const probeTarget = fs.mkdtempSync(path.join(spTmpDir(), 'refledger-junction-probe-'));
    const probeLink = `${probeTarget}-link`;
    try {
      fs.symlinkSync(probeTarget, probeLink, 'junction');
      return true;
    } catch {
      return false;
    } finally {
      fs.rmSync(probeLink, { recursive: true, force: true });
      fs.rmSync(probeTarget, { recursive: true, force: true });
    }
  })();
  const itIfJunctions = junctionsSupported ? it : it.skip;

  itIfJunctions('discovers, scans, and reports a mirror parked behind a directory junction', () => {
    const root = newRoot();
    const targetParent = fs.mkdtempSync(path.join(spTmpDir(), 'refledger-target-'));
    try {
      const target = mkRepo(targetParent, 'realrepo');
      fs.symlinkSync(target, path.join(root, 'linked'), 'junction');
      expect(discover(root)).toEqual(['linked']);
      expect(runCli(root, ['scan']).status).toBe(0);
      expect(readLedger(root).repos.linked.head).toMatch(/^[0-9a-f]{7,}$/);
      expect(runCli(root, ['report']).stdout).toMatch(/linked/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(targetParent, { recursive: true, force: true });
    }
  });
});

describe('archive', () => {
  let root;
  beforeEach(() => { root = newRoot(); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('moves the directory and marks the entry', () => {
    mkRepo(root, 'alpha');
    mkRepo(root, 'stale');
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['archive', 'stale', '--reason', 'no commits in 5.4 months']).status).toBe(0);
    expect(fs.existsSync(path.join(root, 'stale'))).toBe(false);
    expect(fs.existsSync(path.join(root, '_archive', 'stale', '.git'))).toBe(true);
    const e = readLedger(root).repos.stale;
    expect(e.status).toBe('archived');
    expect(e.reason).toBe('no commits in 5.4 months');
    expect(e.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stays archived across a later scan when the directory is still absent (the ordinary case)', () => {
    mkRepo(root, 'alpha');
    mkRepo(root, 'stale');
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['archive', 'stale', '--reason', 'dormant']).status).toBe(0);
    const archivedEntry = readLedger(root).repos.stale;
    expect(runCli(root, ['scan']).status).toBe(0);
    const after = readLedger(root).repos.stale;
    expect(after.status).toBe('archived');
    // A scan that never even sees this directory again must not touch the
    // entry it already recorded - not just the status field.
    expect(after).toEqual(archivedEntry);
    expect(fs.existsSync(path.join(root, 'stale'))).toBe(false);
  });

  it('resumes tracking an archived entry whose directory reappears under its original name, per the documented `mv` recovery step', () => {
    // docs/superpowers/upstream-sync.md's archive convention frames the move
    // as reversible with `mv`. Before this fix, scan() skipped any entry
    // whose status was already 'archived' before ever consulting the disk,
    // so `mv _archive/stale stale` left the entry archived forever with a
    // stale head - recovery needed a hand-edit of the JSON, the one
    // operation this design exists to make unnecessary.
    mkRepo(root, 'stale');
    expect(runCli(root, ['scan']).status).toBe(0);
    const recorded = consume(root, 'stale', 'upstream-sync', { by: 'abc1234' });
    expect(runCli(root, ['archive', 'stale', '--reason', 'dormant']).status).toBe(0);

    addCommit(path.join(root, '_archive', 'stale'), 'revival-commit');
    const liveHead = git(path.join(root, '_archive', 'stale'), ['log', '-1', '--format=%h']);
    fs.renameSync(path.join(root, '_archive', 'stale'), path.join(root, 'stale'));

    expect(runCli(root, ['scan']).status).toBe(0);
    const revived = readLedger(root).repos.stale;
    expect(revived.status).toBe('active');
    expect('archivedAt' in revived).toBe(false);
    expect('reason' in revived).toBe(false);
    expect(revived.head).toBe(liveHead);
    // consumed is a fact about review history, not about where the mirror
    // currently lives - it must survive the archive/revive round trip untouched.
    expect(revived.consumed).toEqual(recorded);
    expect(fs.existsSync(path.join(root, '_archive', 'stale'))).toBe(false);
  });

  it('refuses when the archive destination already exists', () => {
    mkRepo(root, 'stale');
    expect(runCli(root, ['scan']).status).toBe(0);
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
    expect(runCli(root, ['scan']).status).toBe(0);
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
    expect(runCli(root, ['scan']).status).toBe(0);
    fs.mkdirSync(path.join(root, 'stray'), { recursive: true });
    expect(() => archive(root, 'stray', 'dormant'))
      .toThrow(/^reference-ledger: unknown repository 'stray'/);
    expect(fs.existsSync(path.join(root, 'stray'))).toBe(true);
  });

  it('refuses when the ledger has the entry but the source directory is already gone from disk', () => {
    // The other half of the pair above: ledger says yes, disk says no.
    mkRepo(root, 'stale');
    expect(runCli(root, ['scan']).status).toBe(0);
    fs.rmSync(path.join(root, 'stale'), { recursive: true, force: true });
    expect(() => archive(root, 'stale', 'dormant'))
      .toThrow(/^reference-ledger: no such reference 'stale'/);
  });

  it('refuses a name that escapes dir via path traversal, leaving the outside directory untouched', () => {
    // path.join(dir, '_archive', '..', name) for name === '../<outside>'
    // collapses back to a path outside _reference/ entirely - the
    // destination-exists check alone guards nothing against this.
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
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
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(() => archive(root, 'sub/evil', 'dormant'))
      .toThrow(/^reference-ledger: invalid reference name/);
  });

  it('refuses to archive the _archive directory itself, with a prefixed message and no stack trace', () => {
    mkRepo(root, 'alpha');
    expect(runCli(root, ['scan']).status).toBe(0);
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
    expect(runCli(root, ['scan']).status).toBe(0);
    fs.writeFileSync(ledgerPath(root), '{"schema":1,"updated');
    expect(() => archive(root, 'stale', 'dormant')).toThrow();
    expect(fs.existsSync(path.join(root, 'stale', '.git'))).toBe(true);
    expect(fs.existsSync(path.join(root, '_archive', 'stale'))).toBe(false);
  });

  it('refuses a missing reason', () => {
    mkRepo(root, 'stale');
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['archive', 'stale']).status).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'stale', '.git'))).toBe(true);
  });

  it('never deletes: the archived tree is intact', () => {
    const repo = mkRepo(root, 'stale', 2);
    const before = fs.readdirSync(repo).sort();
    expect(runCli(root, ['scan']).status).toBe(0);
    expect(runCli(root, ['archive', 'stale', '--reason', 'dormant']).status).toBe(0);
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

describe('upstream-sync playbook wiring', () => {
  const DOC = path.join(__dirname, '..', 'docs', 'superpowers', 'upstream-sync.md');
  const doc = fs.readFileSync(DOC, 'utf8');

  it('opens the procedure by reading the ledger, and closes it by consuming', () => {
    expect(doc).toMatch(/scripts\/reference-ledger\.mjs/);
    expect(doc).toMatch(/reference-ledger\.mjs report/);
    expect(doc).toMatch(/reference-ledger\.mjs consume/);

    // Step 1 must actually be the report command, not merely mentioned
    // anywhere in the file.
    const step1 = /^### 1\..*$([\s\S]*?)(?=^### )/m.exec(doc);
    expect(step1).not.toBeNull();
    expect(step1[0]).toMatch(/reference-ledger\.mjs report/);

    // The mirror-refresh step must be immediately followed by a scan, not
    // merely mention "scan" somewhere later in the document.
    const mirrorStep = /^### \d+\.\s*Refresh the upstream mirror\s*$([\s\S]*?)(?=^### )/m.exec(doc);
    expect(mirrorStep).not.toBeNull();
    expect(mirrorStep[0]).toMatch(/reference-ledger\.mjs scan/);

    // consume must be the last ledger-mutating command in the file, after
    // both the full-suite gate and the RELEASE-NOTES entry - not merely
    // present somewhere. A rewrite that keeps the command but moves it
    // earlier (e.g. before the gate) must fail this.
    const gateIdx = doc.indexOf('### 6. Full suite gate');
    const releaseNotesIdx = doc.indexOf('### 7. Update RELEASE-NOTES and record the new synced ref');
    const consumeIdx = doc.lastIndexOf('reference-ledger.mjs consume');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(releaseNotesIdx).toBeGreaterThan(gateIdx);
    expect(consumeIdx).toBeGreaterThan(releaseNotesIdx);
  });

  it('documents the archive convention with the dormancy window', () => {
    expect(doc).toMatch(/reference-ledger\.mjs archive/);
    expect(doc.toLowerCase()).toMatch(/dormant/);
    // The specific window, not just the word "dormant" - a rewrite that
    // drops the five-to-six-month rule but keeps the word must still fail.
    expect(doc).toMatch(/five to six months/i);
  });

  it('numbers procedure sections sequentially with no duplicates or gaps', () => {
    const headings = [...doc.matchAll(/^### (\d+)\./gm)].map((m) => Number(m[1]));
    expect(headings.length).toBeGreaterThan(0);
    expect(headings).toEqual(headings.map((_, i) => i + 1));
  });
});
