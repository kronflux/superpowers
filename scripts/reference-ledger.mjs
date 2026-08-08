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

function load(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath(dir), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.repos) return parsed;
  } catch { /* absent or unreadable: start fresh below */ }
  return { schema: SCHEMA, updatedAt: null, repos: {} };
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
      // Empty or unreadable repo. Leaving the entry alone beats recording a
      // half-entry that later reads as fact.
      continue;
    }
    // `prev` spreads FIRST so `consumed` survives. Assigning a fresh object
    // here instead would silently drop it - see the NEVER-creates test.
    ledger.repos[name] = { ...prev, status: 'active', head, headDate };
  }
  save(dir, ledger);
  return ledger;
}

function main(argv) {
  const dir = referenceDir();
  if (!fs.existsSync(dir)) {
    process.stderr.write(`reference-ledger: no reference directory at ${dir}\n`);
    process.exit(1);
  }
  const [cmd = 'scan'] = argv;
  if (cmd === 'scan') {
    const ledger = scan(dir);
    const n = Object.values(ledger.repos).filter((e) => e.status === 'active').length;
    process.stdout.write(`scanned ${n} reference repositories\n`);
    return;
  }
  process.stderr.write(`reference-ledger: unknown command '${cmd}'\n`);
  process.exit(2);
}

const isEntry = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntry) main(process.argv.slice(2));

export { referenceDir, ledgerPath, discover, load, save, scan, today, git };
