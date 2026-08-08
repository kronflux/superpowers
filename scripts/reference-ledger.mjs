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
  try {
    if (c.ref) {
      const n = git(repo, ['rev-list', '--count', `${c.ref}..HEAD`]);
      return { label: `${c.ref} (${c.date})`, count: Number(n) };
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

function main(argv) {
  const dir = referenceDir();
  if (!fs.existsSync(dir)) {
    process.stderr.write(`reference-ledger: no reference directory at ${dir}\n`);
    process.exit(1);
  }
  const [cmd = 'scan'] = argv;
  if (cmd === 'scan') {
    let ledger;
    try {
      ledger = scan(dir);
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    const n = Object.values(ledger.repos).filter((e) => e.status === 'active').length;
    process.stdout.write(`scanned ${n} reference repositories\n`);
    return;
  }
  if (cmd === 'report') {
    process.stdout.write(report(dir));
    return;
  }
  process.stderr.write(`reference-ledger: unknown command '${cmd}'\n`);
  process.exit(2);
}

const isEntry = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) main(process.argv.slice(2));

export { referenceDir, ledgerPath, discover, load, save, scan, gap, report, today, git };
