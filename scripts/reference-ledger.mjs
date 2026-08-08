#!/usr/bin/env node
/**
 * scripts/reference-ledger.mjs — what each reference mirror is at, and what we
 * have actually consumed.
 *
 * Those are two different facts and this project has conflated them once
 * already. On 2026-07-26 the fork landed an upstream review-and-apply playbook
 * whose own worked example documented a 51-commit gap, and closed without
 * applying any of it. Nothing recorded that the gap was still open, so twelve
 * days later the operator reasonably believed a sync had happened.
 *
 * Hence the split: `scan` refreshes `head` (observed, cheap, safe to re-run)
 * and is FORBIDDEN from touching `consumed` (asserted once, by whoever
 * finished a review). `consume` is the only writer of that field.
 *
 * The ledger lives outside the repo tree, so it is untracked by construction
 * rather than by a .gitignore rule that could be edited away, and it survives a
 * re-clone - which is exactly when a gate ref is most likely to be lost.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const SCHEMA = 1;

/** `_reference/` beside the repo root, unless overridden. */
function referenceDir() {
  const override = process.env.SUPERPOWERS_REFERENCE_DIR;
  if (override) return path.resolve(override);
  const here = path.dirname(fileURLToPath(import.meta.url)); // <repo>/scripts
  return path.resolve(here, '..', '..', '_reference');
}

function ledgerPath(dir) {
  return path.join(dir, '.sync-ledger.json');
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Immediate subdirectories that are git repos. `_archive` is not a reference. */
function discover(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_archive')
    .filter((e) => fs.existsSync(path.join(dir, e.name, '.git')))
    .map((e) => e.name)
    .sort();
}

/**
 * Absent (`ENOENT`) is the only case that returns a fresh ledger. Anything
 * else present-but-bad — unreadable, unparseable, or valid JSON that isn't a
 * ledger shape — throws instead of being treated the same as absent. `scan`
 * would otherwise happily `save()` an empty ledger over a truncated or
 * malformed file, erasing every `consumed` block it recorded with exit code 0
 * and a success message. A file that exists is either trustworthy or an
 * error; it is never quietly replaced.
 */
function load(dir) {
  const file = ledgerPath(dir);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { schema: SCHEMA, updatedAt: null, repos: {} };
    throw new Error(`reference-ledger: cannot read ledger at ${file}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`reference-ledger: ledger at ${file} is not valid JSON: ${err.message}`);
  }
  const validShape = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && parsed.repos && typeof parsed.repos === 'object' && !Array.isArray(parsed.repos);
  if (!validShape) {
    throw new Error(`reference-ledger: ledger at ${file} is not a valid ledger (expected an object with a 'repos' object)`);
  }
  return parsed;
}

function save(dir, ledger) {
  ledger.schema = SCHEMA;
  ledger.updatedAt = new Date().toISOString();
  fs.writeFileSync(ledgerPath(dir), JSON.stringify(ledger, null, 2) + '\n');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Refresh observed state. Never writes `consumed`. */
function scan(dir) {
  const ledger = load(dir);
  for (const name of discover(dir)) {
    const prev = ledger.repos[name] || {};
    if (prev.status === 'archived') continue;
    let head, headDate;
    try {
      head = git(path.join(dir, name), ['log', '-1', '--format=%h']);
      headDate = git(path.join(dir, name), ['log', '-1', '--format=%ad', '--date=short']);
    } catch {
      // Swallows an empty repo (no commits yet), a missing `git` binary, and
      // permission errors reading the repo's object store alike. Leaving the
      // entry alone beats recording a half-entry that later reads as fact.
      continue;
    }
    // `prev` spreads FIRST, then `status`/`head`/`headDate` override it.
    // Reversed, stale `prev.head`/`prev.headDate` would win over the values
    // just observed above, freezing `head` at its first-ever value on every
    // later scan - silent, and unrelated to whether `consumed` is dropped.
    // Guarded by "updates head on a subsequent scan while preserving a
    // pre-existing consumed block", which commits again between two scans
    // and checks both facts at once.
    ledger.repos[name] = { ...prev, status: 'active', head, headDate };
  }
  save(dir, ledger);
  return ledger;
}

/**
 * Commits between what we consumed and where the mirror now is.
 * `count: null` means there is nothing honest to count - never consumed, or a
 * ref that no longer resolves. It is never rendered as 0, which would read as
 * "up to date".
 */
function gap(dir, name, entry) {
  const repo = path.join(dir, name);
  const c = entry.consumed;
  if (!c) return { label: 'never', count: null };
  // Neither field set is malformed, not a zero-commit gap. Left to the branches
  // below, a date-only lookup with `c.date` undefined runs `--since=undefined`,
  // which git accepts and answers with a real, misleading 0.
  if (!c.ref && !c.date) return { label: 'malformed (no ref or date)', count: null };
  try {
    if (c.ref) {
      const n = git(repo, ['rev-list', '--count', `${c.ref}..HEAD`]);
      return { label: `${c.ref} (${c.date || 'no date'})`, count: Number(n) };
    }
    const n = git(repo, ['rev-list', '--count', `--since=${c.date}`, 'HEAD']);
    return { label: `${c.date} (date)`, count: Number(n) };
  } catch {
    return { label: `${c.ref || c.date} (unresolvable)`, count: null };
  }
}

function report(dir) {
  const ledger = load(dir);
  const names = Object.keys(ledger.repos)
    .filter((n) => ledger.repos[n].status !== 'archived')
    .sort();
  const rows = names.map((name) => {
    const entry = ledger.repos[name];
    const g = gap(dir, name, entry);
    return [name, entry.head || '-', g.label, g.count === null ? '-' : `${g.count} commits`];
  });
  const head = ['repo', 'head', 'consumed', 'gap'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  return [line(head), ...rows.map(line)].join('\n') + '\n';
}

const KNOWN_FLAGS = new Set(['ref', 'date', 'by', 'reason']);

/**
 * Minimal flag parser: `--k v` pairs, the boolean `--no-ref`, positionals in
 * `_`. Rejects anything it can't confidently attribute rather than guessing:
 * an unrecognized `--flag` would otherwise swallow the next token as its
 * value and silently misassign it (e.g. to `workstream`), recording a review
 * attributed to something the operator never typed.
 */
function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-ref') {
      out.noRef = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (!KNOWN_FLAGS.has(key)) {
        throw new Error(`reference-ledger: unknown flag '${a}' (expected --ref, --date, --by, --reason, or --no-ref)`);
      }
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`reference-ledger: flag '${a}' requires a value`);
      }
      out[key] = value;
      continue;
    }
    out._.push(a);
  }
  if (out.ref !== undefined && out.noRef) {
    throw new Error('reference-ledger: --ref and --no-ref are mutually exclusive');
  }
  return out;
}

/**
 * The ONLY writer of `consumed`. Refuses an unknown repo rather than creating
 * one, so a typo cannot invent a consumed repository that no one ever reviewed.
 * Validated here, not only in the CLI: Task 5 and other in-process callers
 * bypass main()'s usage check entirely, and an entry with no `workstream`
 * asserts a review happened without saying which one.
 */
function consume(dir, name, workstream, opts = {}) {
  const ledger = load(dir);
  if (!ledger.repos[name]) {
    // Self-prefixing, matching load()'s thrown messages: main()'s shared
    // try/catch prints err.message verbatim and adds nothing.
    throw new Error(`reference-ledger: unknown repository '${name}' - run scan first`);
  }
  if (typeof workstream !== 'string' || workstream.length === 0) {
    throw new Error('reference-ledger: workstream is required and must be a non-empty string');
  }
  const ref = opts.noRef
    ? null
    // Live HEAD, not ledger.repos[name].head: a pull since the last scan would
    // make the stored field stale, and a stale ref understates the gap.
    : (opts.ref || git(path.join(dir, name), ['log', '-1', '--format=%h']));
  ledger.repos[name].consumed = {
    ...(ref ? { ref } : {}),
    date: opts.date || today(),
    workstream,
    ...(opts.by ? { by: opts.by } : {}),
  };
  save(dir, ledger);
  return ledger.repos[name].consumed;
}

/**
 * Retire a dormant mirror. Moves, never deletes: the operator asked to keep
 * the bytes and remove them by hand later, and a move is reversible with
 * `mv`. Refuses an occupied destination rather than merging two trees.
 * Validated here, not only in the CLI dispatch below: Task 5 calls this
 * export directly, bypassing main()'s usage check, and an unreasoned archive
 * would silently drop the one field the operator asked this command to record.
 */
function archive(dir, name, reason) {
  const src = path.join(dir, name);
  const dest = path.join(dir, '_archive', name);
  // Self-prefixing, matching load() and consume(): main()'s shared try/catch
  // prints err.message verbatim. Both checks run before any mutation, so a
  // refusal always leaves the source exactly where it was.
  if (!fs.existsSync(src)) throw new Error(`reference-ledger: no such reference '${name}'`);
  if (fs.existsSync(dest)) throw new Error(`reference-ledger: already archived: ${dest}`);
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error('reference-ledger: reason is required and must be a non-empty string');
  }
  fs.mkdirSync(path.join(dir, '_archive'), { recursive: true });
  fs.renameSync(src, dest);
  const ledger = load(dir);
  ledger.repos[name] = {
    ...(ledger.repos[name] || {}),
    status: 'archived',
    archivedAt: today(),
    reason,
  };
  save(dir, ledger);
}

function main(argv) {
  const dir = referenceDir();
  if (!fs.existsSync(dir)) {
    process.stderr.write(`reference-ledger: no reference directory at ${dir}\n`);
    process.exit(1);
  }
  const [cmd = 'scan'] = argv;
  // One try/catch around every known command, not one per command: a thrown
  // load() must never surface as a raw stack trace, and a wrapper here holds
  // that for every subcommand this file gains later without relying on each
  // one to remember its own catch block.
  try {
    if (cmd === 'scan') {
      const ledger = scan(dir);
      const n = Object.values(ledger.repos).filter((e) => e.status === 'active').length;
      process.stdout.write(`scanned ${n} reference repositories\n`);
      return;
    }
    if (cmd === 'report') {
      process.stdout.write(report(dir));
      return;
    }
    if (cmd === 'consume') {
      const f = parseFlags(argv.slice(1));
      const [name, workstream] = f._;
      if (!name || !workstream) {
        process.stderr.write('usage: reference-ledger consume <repo> <workstream> '
          + '[--ref <sha>] [--date <YYYY-MM-DD>] [--by <sha>] [--no-ref]\n');
        process.exit(2);
      }
      // No inner try/catch: Task 2 added one shared try/catch around the whole
      // dispatch, so a thrown error already prints as one clean line and exits 1.
      const recorded = consume(dir, name, workstream, f);
      process.stdout.write(`${name}: consumed ${recorded.ref || recorded.date} for ${workstream}\n`);
      return;
    }
    if (cmd === 'archive') {
      const f = parseFlags(argv.slice(1));
      const [name] = f._;
      if (!name || !f.reason) {
        process.stderr.write('usage: reference-ledger archive <repo> --reason "<text>"\n');
        process.exit(2);
      }
      // No inner try/catch: the shared dispatch wrapper below handles it.
      archive(dir, name, f.reason);
      process.stdout.write(`${name}: archived to _archive/${name}\n`);
      return;
    }
  } catch (err) {
    // The 'reference-ledger: ' prefix is the contract that separates a known
    // operational failure (load(), and per plan consume()/archive()) from a
    // genuine bug - nothing enforces it mechanically. An unprefixed error is
    // rethrown with its full stack rather than flattened to one line, because
    // a bare `Cannot read properties of undefined` is indistinguishable from
    // a known-bad ledger otherwise, which is exactly the ambiguity this whole
    // file exists to eliminate.
    if (!err.message?.startsWith('reference-ledger: ')) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`reference-ledger: unknown command '${cmd}'\n`);
  process.exit(2);
}

const isEntry = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) main(process.argv.slice(2));

export {
  referenceDir, ledgerPath, discover, load, save,
  scan, gap, report, consume, archive, parseFlags, today, git,
};
