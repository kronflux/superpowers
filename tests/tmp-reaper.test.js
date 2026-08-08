import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sweep, LEGACY_PREFIXES, sweepWorkspaces, isPlanInFlight } from '../hooks/lib/tmp-reaper.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const DAY = 86400000;
let fake; // a fake temp root so tests never touch the real one

// Symlink creation needs developer mode or elevation on Windows. Probe once so
// the symlink case reports as SKIPPED rather than silently passing without
// asserting anything — a green test that tested nothing is worse than a red one.
const canSymlink = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-symprobe-'));
  try {
    fs.symlinkSync(path.join(probe, 'x'), path.join(probe, 'l'));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

beforeEach(() => { fake = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-reaper-')); });
afterEach(() => { fs.rmSync(fake, { recursive: true, force: true }); });

function seed(rel, ageDays, now) {
  const p = path.join(fake, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
  const t = new Date(now - ageDays * DAY);
  fs.utimesSync(p, t, t);
  return p;
}

describe('tmp-reaper sweep', () => {
  const NOW = 1_800_000_000_000;

  it('removes entries older than the retention window', () => {
    const old = seed('sp/usage-old', 10, NOW);
    const r = sweep({ tmpRoot: fake, now: NOW, env: {}, force: true });
    expect(fs.existsSync(old)).toBe(false);
    expect(r.removed).toBe(1);
  });

  it('leaves entries inside the window', () => {
    const fresh = seed('sp/usage-fresh', 1, NOW);
    sweep({ tmpRoot: fake, now: NOW, env: {}, force: true });
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('never removes the live session regardless of age', () => {
    const live = seed('sp/usage-LIVE-abc', 99, NOW);
    const dead = seed('sp/usage-dead', 99, NOW);
    sweep({ tmpRoot: fake, now: NOW, env: {}, force: true, sessionId: 'LIVE-abc' });
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(dead)).toBe(false);
  });

  it('honours SUPERPOWERS_TMP_RETENTION_DAYS', () => {
    const p = seed('sp/usage-x', 3, NOW);
    sweep({ tmpRoot: fake, now: NOW, env: { SUPERPOWERS_TMP_RETENTION_DAYS: '2' }, force: true });
    expect(fs.existsSync(p)).toBe(false);
  });

  it('removes nothing when retention is 0 (disabled)', () => {
    const p = seed('sp/usage-x', 999, NOW);
    const r = sweep({ tmpRoot: fake, now: NOW, env: { SUPERPOWERS_TMP_RETENTION_DAYS: '0' }, force: true });
    expect(fs.existsSync(p)).toBe(true);
    expect(r.skipped).toBe('disabled');
  });

  it('throttles a second sweep within 24h, and force overrides', () => {
    seed('sp/usage-a', 10, NOW);
    expect(sweep({ tmpRoot: fake, now: NOW, env: {}, force: true }).removed).toBe(1);
    seed('sp/usage-b', 10, NOW);
    expect(sweep({ tmpRoot: fake, now: NOW, env: {} }).skipped).toBe('throttled');
    expect(sweep({ tmpRoot: fake, now: NOW, env: {}, force: true }).removed).toBe(1);
  });

  it('never removes its own marker', () => {
    sweep({ tmpRoot: fake, now: NOW, env: {}, force: true });
    const marker = path.join(fake, 'sp', '.last-sweep');
    const t = new Date(NOW - 99 * DAY);
    fs.utimesSync(marker, t, t);
    sweep({ tmpRoot: fake, now: NOW, env: {}, force: true });
    expect(fs.existsSync(marker)).toBe(true);
  });

  it.skipIf(!canSymlink)('skips symlinks', () => {
    const target = seed('outside-target', 0, NOW);
    const link = path.join(fake, 'sp', 'usage-link');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    const t = new Date(NOW - 99 * DAY);
    try { fs.lutimesSync(link, t, t); } catch {}
    sweep({ tmpRoot: fake, now: NOW, env: {}, force: true });
    expect(fs.existsSync(target)).toBe(true);
  });

  it.skipIf(!canSymlink)('refuses to enumerate through a symlinked root, not just a symlinked entry', () => {
    // The per-entry isSymbolicLink() check above says nothing about the root
    // itself. If an attacker pre-creates the root as a symlink to a directory
    // the victim can write to, readdirSync follows it and the recursive
    // rmSync would delete through it. Symlink the root — not an entry under
    // it — and assert the sweep refuses to touch the target at all.
    const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-victim-'));
    const victimFile = path.join(victimDir, 'precious.txt');
    fs.writeFileSync(victimFile, 'precious');
    const t = new Date(NOW - 99 * DAY);
    fs.utimesSync(victimFile, t, t);
    const root = path.join(fake, 'sp'); // not yet created by beforeEach/seed
    fs.symlinkSync(victimDir, root, 'dir');
    try {
      const r = sweep({ tmpRoot: fake, now: NOW, env: {}, force: true });
      expect(fs.existsSync(victimFile)).toBe(true);
      expect(r.removed).toBe(0);
    } finally {
      fs.rmSync(victimDir, { recursive: true, force: true });
    }
  });

  it('cleans aged legacy flat entries by exact prefix only', () => {
    const aged = seed('sp-conductor-old', 10, NOW);
    const recent = seed('sp-conductor-new', 1, NOW);
    const foreign = seed('context-mode-thing', 10, NOW);
    const r = sweep({ tmpRoot: fake, now: NOW, env: {}, force: true });
    expect(fs.existsSync(aged)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
    expect(r.legacy).toBe(1);
    expect(LEGACY_PREFIXES).toContain('sp-conductor-');
  });

  it('returns without throwing when the root is unreadable', () => {
    let r;
    expect(() => { r = sweep({ tmpRoot: path.join(fake, 'nope'), now: NOW, env: {}, force: true }); }).not.toThrow();
    expect(r.removed).toBe(0);
  });
});

describe('tmp-reaper sweepWorkspaces', () => {
  const NOW2 = 1_800_000_000_000;
  const DAY2 = 86400000;
  const created = []; // fixture roots to remove after each test

  afterEach(() => {
    while (created.length) {
      const p = created.pop();
      fs.rmSync(p, { recursive: true, force: true });
    }
  });

  function daysAgo(n) { return NOW2 - n * DAY2; }

  // A fresh fake repo root with the .superpowers/{sdd,plans} dirs a real repo
  // would have. Lives under spTmpDir(), never the bare os.tmpdir() root.
  function mkRepo() {
    const root = fs.mkdtempSync(path.join(spTmpDir(), 'reaper-repo-'));
    fs.mkdirSync(path.join(root, '.superpowers', 'sdd'), { recursive: true });
    fs.mkdirSync(path.join(root, '.superpowers', 'plans'), { recursive: true });
    created.push(root);
    return root;
  }

  function mkWorkspace(root, slug, mtime) {
    const dir = path.join(root, '.superpowers', 'sdd', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'progress.md'), 'x');
    const t = new Date(mtime);
    fs.utimesSync(dir, t, t);
    return dir;
  }

  function mkPlanTasks(root, slug, task) {
    const file = path.join(root, '.superpowers', 'plans', `${slug}.md.tasks.json`);
    fs.writeFileSync(file, JSON.stringify({ tasks: [task] }));
  }

  // Writes whatever raw string is handed in, unparsed — for torn/truncated
  // files and for valid-JSON-but-wrong-shape payloads alike.
  function mkPlanTasksRaw(root, slug, raw) {
    const file = path.join(root, '.superpowers', 'plans', `${slug}.md.tasks.json`);
    fs.writeFileSync(file, raw);
  }

  function mkVictimDir() {
    const dir = fs.mkdtempSync(path.join(spTmpDir(), 'reaper-victim-'));
    fs.writeFileSync(path.join(dir, 'precious.txt'), 'precious');
    created.push(dir);
    return dir;
  }

  it('reaps a stale plan workspace', () => {
    const root = mkRepo();
    const old = mkWorkspace(root, 'old-plan', daysAgo(30));
    sweepWorkspaces(root, { now: NOW2 });
    expect(fs.existsSync(old)).toBe(false);
  });

  it('keeps a fresh plan workspace', () => {
    const root = mkRepo();
    const fresh = mkWorkspace(root, 'fresh-plan', NOW2);
    sweepWorkspaces(root, { now: NOW2 });
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('NEVER reaps a workspace whose plan is in flight', () => {
    // A long-running plan that goes quiet for eight days would otherwise have
    // its ledger deleted mid-execution. Liveness beats age.
    const root = mkRepo();
    const live = mkWorkspace(root, 'live-plan', daysAgo(30));
    mkPlanTasks(root, 'live-plan', { status: 'in_progress' });
    sweepWorkspaces(root, { now: NOW2 });
    expect(fs.existsSync(live)).toBe(true);
  });

  it('treats a torn/truncated snapshot as in-flight and survives, not deletes', () => {
    // A crash or full disk mid-write (sync-plan-tasks.js's writeFileSync is not
    // atomic) leaves exactly this shape: present, old, unreadable as JSON. We
    // cannot tell whether the plan is live, so refusing to reap is the safe
    // failure direction — the cost is a stale directory, not a lost ledger.
    const root = mkRepo();
    const torn = mkWorkspace(root, 'torn-plan', daysAgo(90));
    mkPlanTasksRaw(root, 'torn-plan', '{"tasks": [{"status": "in_progress"'); // truncated
    sweepWorkspaces(root, { now: NOW2 });
    expect(fs.existsSync(torn)).toBe(true);
  });

  it.each([
    ['[]', '[]'],
    ['null', 'null'],
    ['a bare string', '"str"'],
    ['a bare number', '42'],
    ['an object with no tasks array', '{}'],
  ])('treats valid JSON that is not a ledger shape (%s) as in-flight and survives', (_label, raw) => {
    const root = mkRepo();
    const slug = `bad-shape-${Math.random().toString(36).slice(2)}`;
    const dir = mkWorkspace(root, slug, daysAgo(90));
    mkPlanTasksRaw(root, slug, raw);
    sweepWorkspaces(root, { now: NOW2 });
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('still reaps when the snapshot file is genuinely absent (ENOENT) — guards against over-correction', () => {
    // Absence must remain reapable: nothing claims the plan is live. If this
    // regresses to "survive", the reaper never reaps anything again.
    const root = mkRepo();
    const old = mkWorkspace(root, 'no-snapshot-plan', daysAgo(90));
    sweepWorkspaces(root, { now: NOW2 });
    expect(fs.existsSync(old)).toBe(false);
  });

  it('honours retention 0 as disabled', () => {
    const root = mkRepo();
    const old = mkWorkspace(root, 'old-plan', daysAgo(90));
    sweepWorkspaces(root, { now: NOW2, env: { SUPERPOWERS_TMP_RETENTION_DAYS: '0' } });
    expect(fs.existsSync(old)).toBe(true);
  });

  it('refuses a symlinked sdd root instead of following it', () => {
    // The same hazard the tmpdir reaper already guards: readdirSync follows a
    // symlinked root, so an attacker-placed link would aim deletion elsewhere.
    const root = mkRepo();
    const victim = mkVictimDir();
    fs.rmSync(path.join(root, '.superpowers', 'sdd'), { recursive: true, force: true });
    fs.symlinkSync(victim, path.join(root, '.superpowers', 'sdd'), 'junction');
    sweepWorkspaces(root, { now: NOW2 });
    expect(fs.existsSync(path.join(victim, 'precious.txt'))).toBe(true);
  });
});
