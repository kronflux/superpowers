import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sweep, LEGACY_PREFIXES } from '../hooks/lib/tmp-reaper.js';

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
