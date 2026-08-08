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

/**
 * Shape AND calendar validity: `/^\d{4}-\d{2}-\d{2}$/` alone still accepts
 * `2026-13-45` (two digits is two digits), and git's approxidate accepts
 * almost anything with exit 0 - `garbage`, `yesterday`, `07-10-2026` all
 * silently resolve to *something*. A round trip through `Date` is the
 * cheapest check that rejects all of those alongside a real calendar
 * impossibility like `2026-02-30`, which parses but quietly rolls over to
 * March 2.
 */
function isValidDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  try {
    return new Date(d).toISOString().slice(0, 10) === d;
  } catch {
    return false;
  }
}

/**
 * Refresh observed state. Never writes `consumed`.
 *
 * `discover(dir)` only ever lists names that currently exist as a git repo
 * directly under `dir` - an archived entry's directory normally lives under
 * `_archive/`, so it simply never reaches this loop. The one time a
 * previously-archived name DOES show up here is a revival: `mv _archive/<name>
 * <name>` per the documented recovery step, or a dormant upstream re-cloned
 * under its original name. Skipping that case (as an earlier version did)
 * left the entry permanently archived with a stale `head` - the doc's claim
 * that the move is "reversible with `mv`" was false. An archived entry whose
 * directory is still absent is untouched by this loop either way, so it
 * stays archived without any special-case check.
 */
function scan(dir) {
  const ledger = load(dir);
  let scanned = 0;
  let skipped = 0;
  for (const name of discover(dir)) {
    const prev = ledger.repos[name] || {};
    let head, headDate;
    try {
      head = git(path.join(dir, name), ['log', '-1', '--format=%h']);
      headDate = git(path.join(dir, name), ['log', '-1', '--format=%ad', '--date=short']);
    } catch {
      // Swallows an empty repo (no commits yet), a missing `git` binary, and
      // permission errors reading the repo's object store alike. Leaving the
      // entry alone beats recording a half-entry that later reads as fact.
      skipped++;
      continue;
    }
    // `archivedAt`/`reason` describe a state that just ended on revival and
    // must not leak into the resumed entry; `consumed` is a fact about
    // review history and must survive untouched, so it stays in `rest`.
    const { archivedAt, reason, ...rest } = prev;
    // `rest` spreads FIRST, then `status`/`head`/`headDate` override it.
    // Reversed, stale `prev.head`/`prev.headDate` would win over the values
    // just observed above, freezing `head` at its first-ever value on every
    // later scan - silent, and unrelated to whether `consumed` is dropped.
    // Guarded by "updates head on a subsequent scan while preserving a
    // pre-existing consumed block", which commits again between two scans
    // and checks both facts at once.
    ledger.repos[name] = { ...rest, status: 'active', head, headDate };
    scanned++;
  }
  save(dir, ledger);
  return { ledger, scanned, skipped };
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
    // consume() validates --date itself, but a hand-edited ledger file
    // reaches gap() straight from load(), skipping that gate entirely.
    // `--since=<garbage>` is the same 0-that-lies failure mode the
    // both-fields-absent check above exists to prevent, reachable through a
    // different door.
    if (!isValidDate(c.date)) return { label: `${c.date} (invalid date)`, count: null };
    const n = git(repo, ['rev-list', '--count', `--since=${c.date}`, 'HEAD']);
    return { label: `${c.date} (date)`, count: Number(n) };
  } catch {
    return { label: `${c.ref || c.date} (unresolvable)`, count: null };
  }
}

/**
 * The main table never renders an archived row - but archiving has no
 * dormancy check, no gap check, and a free-text reason, so with nothing
 * anywhere printing an archived entry, retiring a repo with an open gap was
 * an invisible escape hatch from this tool's own purpose. The trailing
 * section below keeps a retired repo and its stated justification on screen
 * without changing what the main table shows.
 */
function report(dir) {
  const ledger = load(dir);
  const names = Object.keys(ledger.repos).sort();
  const active = names.filter((n) => ledger.repos[n].status !== 'archived');
  const archived = names.filter((n) => ledger.repos[n].status === 'archived');

  const rows = active.map((name) => {
    const entry = ledger.repos[name];
    const g = gap(dir, name, entry);
    return [name, entry.head || '-', g.label, g.count === null ? '-' : `${g.count} commits`];
  });
  const head = ['repo', 'head', 'consumed', 'gap'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  let out = [line(head), ...rows.map(line)].join('\n') + '\n';

  if (archived.length > 0) {
    const aRows = archived.map((name) => {
      const entry = ledger.repos[name];
      return [name, entry.archivedAt || '-', entry.reason || '-'];
    });
    const aHead = ['repo', 'archivedAt', 'reason'];
    const aWidths = aHead.map((h, i) => Math.max(h.length, ...aRows.map((r) => r[i].length)));
    const aLine = (r) => r.map((cell, i) => cell.padEnd(aWidths[i])).join('  ').trimEnd();
    out += `\narchived:\n${[aLine(aHead), ...aRows.map(aLine)].join('\n')}\n`;
  }
  return out;
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
  // Mirrors archive()'s guard: only reachable through a hand-edited ledger
  // key (a real scan() never writes a name containing a separator), but an
  // unchecked name would otherwise reach `git -C` with an attacker-controlled
  // path.
  const resolved = path.resolve(dir, name);
  if (name.includes('/') || name.includes(path.sep)
    || !resolved.startsWith(`${path.resolve(dir)}${path.sep}`)) {
    throw new Error(`reference-ledger: invalid reference name '${name}'`);
  }
  const ledger = load(dir);
  if (!ledger.repos[name]) {
    // Self-prefixing, matching load()'s thrown messages: main()'s shared
    // try/catch prints err.message verbatim and adds nothing.
    throw new Error(`reference-ledger: unknown repository '${name}' - run scan first`);
  }
  // An archived entry still exists in the ledger, but its directory has
  // moved under _archive/, so a git call against dir/name would throw an
  // unprefixed ENOENT - and worse, --no-ref needs no git call at all, so it
  // would silently succeed and write a consumed block that report() (which
  // filters archived entries out) never shows.
  if (ledger.repos[name].status === 'archived') {
    throw new Error(`reference-ledger: '${name}' is archived - not a live reference`);
  }
  if (!fs.existsSync(path.join(dir, name))) {
    throw new Error(`reference-ledger: no such reference '${name}'`);
  }
  if (typeof workstream !== 'string' || workstream.length === 0) {
    throw new Error('reference-ledger: workstream is required and must be a non-empty string');
  }
  if (opts.date !== undefined && !isValidDate(opts.date)) {
    throw new Error(`reference-ledger: --date '${opts.date}' is not a valid YYYY-MM-DD date`);
  }
  let ref;
  if (opts.noRef) {
    ref = null;
  } else if (opts.ref) {
    try {
      // Resolved to a concrete sha at record time, never stored verbatim:
      // `--ref HEAD` stored as the literal string 'HEAD' would freeze the gap
      // at 0 forever, since gap() re-evaluates `HEAD..HEAD` fresh on every
      // later report. Omitting --ref was already safe (it resolves live HEAD
      // to a sha below); passing it explicitly was the one path that wasn't.
      // `--verify` also rejects a typo now, while the operator can still fix
      // it, instead of it silently becoming "(unresolvable)" at the next
      // report - and normalises a pasted 40-char sha to short form.
      ref = git(path.join(dir, name), ['rev-parse', '--short', '--verify', `${opts.ref}^{commit}`]);
    } catch {
      throw new Error(`reference-ledger: '${opts.ref}' does not resolve to a commit in '${name}'`);
    }
  } else {
    // Live HEAD, not ledger.repos[name].head: a pull since the last scan would
    // make the stored field stale, and a stale ref understates the gap.
    ref = git(path.join(dir, name), ['log', '-1', '--format=%h']);
  }
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
 *
 * Every check below - name shape, `_archive` itself, `reason`, ledger
 * membership, source presence, destination absence - runs before the single
 * `renameSync`. This is the one command that mutates the filesystem, so a
 * refusal must always leave the source exactly where it was; reading the
 * ledger only after the move would strand a relocated directory the ledger
 * never learns about if `load()` then throws.
 */
function archive(dir, name, reason) {
  // Reject any name that can escape `dir`. `path.join(dir, '_archive', '..',
  // name)` for name === '../evilName' collapses back to `dir/evilName`
  // outside `_reference/` entirely, so the destination-exists check below
  // would be guarding the wrong path - it never sees the real target.
  const resolved = path.resolve(dir, name);
  if (name.includes('/') || name.includes(path.sep)
    || !resolved.startsWith(`${path.resolve(dir)}${path.sep}`)) {
    throw new Error(`reference-ledger: invalid reference name '${name}'`);
  }
  // `_archive` is the destination directory itself, not a reference (discover()
  // already excludes it). Archiving it renames it into itself
  // (`_archive/_archive`), which Node reports as a raw, unprefixed EINVAL -
  // a stack trace for what should be an ordinary refusal.
  if (name === '_archive') {
    throw new Error(`reference-ledger: '_archive' is not a reference`);
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error('reference-ledger: reason is required and must be a non-empty string');
  }
  const ledger = load(dir);
  // Matches consume()'s guard: a name the ledger has never heard of (never
  // scanned) is refused even if a same-named, never-tracked directory
  // happens to sit on disk - archiving it would invent a fresh ledger entry
  // for something no scan ever observed.
  if (!ledger.repos[name]) {
    throw new Error(`reference-ledger: unknown repository '${name}' - run scan first`);
  }
  const src = path.join(dir, name);
  const dest = path.join(dir, '_archive', name);
  // Distinct from the ledger check above: this covers the opposite mismatch,
  // where the ledger still lists the entry but the directory is already gone
  // from disk (removed by hand, moved manually, etc).
  if (!fs.existsSync(src)) throw new Error(`reference-ledger: no such reference '${name}'`);
  if (fs.existsSync(dest)) throw new Error(`reference-ledger: already archived: ${dest}`);
  fs.mkdirSync(path.join(dir, '_archive'), { recursive: true });
  // `_archive` always lives inside `dir`, so this never crosses a filesystem
  // boundary in normal use. If `_reference/` were ever mounted across
  // volumes, renameSync would throw an unprefixed EXDEV instead of a
  // `reference-ledger: ` message - a considered, not missed, gap.
  fs.renameSync(src, dest);
  ledger.repos[name] = {
    ...ledger.repos[name],
    status: 'archived',
    archivedAt: today(),
    reason,
  };
  // A save() failure here (e.g. disk full) leaves the move done but
  // unrecorded. The bytes are still never deleted, only the same residual
  // window every rename-then-record command has; not worth a journal here.
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
      // Counts what this run actually did, not `ledger.repos` at large: that
      // would also count stale 'active' entries whose directory vanished
      // without going through archive(), and entries this run skipped on a
      // git failure - both observed inflating the printed count above the
      // number of repos really scanned.
      const { scanned, skipped } = scan(dir);
      const skippedMsg = skipped > 0 ? `, skipped ${skipped}` : '';
      process.stdout.write(`scanned ${scanned} reference repositories${skippedMsg}\n`);
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
