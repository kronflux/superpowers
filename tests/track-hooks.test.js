import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureGitignored, SECTION_HEADER } from '../hooks/lib/gitignore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACK_EDITS = path.resolve(__dirname, '../hooks/track-edits.js');
const TRACK_STATS = path.resolve(__dirname, '../hooks/track-session-stats.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sp-track-'));
}

function runHook(hookPath, payload, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  return spawnSync('node', [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
}

describe('track-edits.js', () => {
  let home;
  beforeEach(() => { home = tmpDir(); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it('appends an Edit to the edit log and returns {}', () => {
    const target = path.join(home, 'some-file.txt');
    const res = runHook(TRACK_EDITS, {
      tool_name: 'Edit',
      tool_input: { file_path: target },
      session_id: 's1',
      cwd: home,
    }, home);

    expect(res.stdout).toBe('{}');
    const log = fs.readFileSync(path.join(home, '.claude/hooks-logs/edit-log.txt'), 'utf8');
    expect(log).toContain('Edit');
    expect(log).toContain(target);
    expect(log).toContain('s1');
  });

  it('returns {} for non-Edit/Write tools without logging', () => {
    const res = runHook(TRACK_EDITS, {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/x' },
      cwd: home,
    }, home);
    expect(res.stdout).toBe('{}');
    expect(fs.existsSync(path.join(home, '.claude/hooks-logs/edit-log.txt'))).toBe(false);
  });

  it('gitignores an AI artifact via the shared helper without duplicating the section', () => {
    const project = path.join(home, 'proj');
    fs.mkdirSync(project);
    const artifact = path.join(project, 'session-log.md');

    // Pre-seed the shared section from another producer (context-engine).
    ensureGitignored(project, ['context-snapshot.json']);

    const res = runHook(TRACK_EDITS, {
      tool_name: 'Write',
      tool_input: { file_path: artifact, content: 'hi' },
      session_id: 's2',
      cwd: project,
    }, home);
    expect(res.stdout).toBe('{}');

    const gi = fs.readFileSync(path.join(project, '.gitignore'), 'utf8');
    const headerCount = gi.split('\n').filter(l => l.trim() === SECTION_HEADER).length;
    expect(headerCount).toBe(1);
    expect(gi).toContain('context-snapshot.json');
    expect(gi).toContain('session-log.md');
  });

  it('does not duplicate an artifact entry on repeated writes', () => {
    const project = path.join(home, 'proj2');
    fs.mkdirSync(project);
    const artifact = path.join(project, 'state.md');
    const payload = { tool_name: 'Write', tool_input: { file_path: artifact, content: 'x' }, cwd: project };

    runHook(TRACK_EDITS, payload, home);
    runHook(TRACK_EDITS, payload, home);

    const gi = fs.readFileSync(path.join(project, '.gitignore'), 'utf8');
    const entryCount = gi.split('\n').filter(l => l.trim() === 'state.md').length;
    expect(entryCount).toBe(1);
  });
});

describe('track-edits.js unit (importable helpers)', () => {
  let home, origHome, origUserProfile;
  beforeEach(() => {
    home = tmpDir();
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    fs.rmSync(home, { recursive: true, force: true });
    vi.resetModules();
  });

  it('exports gitignoreArtifact (shared helper wrapper), not a private section writer', async () => {
    const mod = await import('../hooks/track-edits.js?unit');
    expect(typeof mod.gitignoreArtifact).toBe('function');
  });
});

describe('track-session-stats.js', () => {
  let home;
  beforeEach(() => { home = tmpDir(); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it('increments a skill tally and returns {}', () => {
    const payload = {
      tool_name: 'Skill',
      tool_input: { skill: 'superpowers:brainstorming' },
    };

    let res = runHook(TRACK_STATS, payload, home);
    expect(res.stdout).toBe('{}');
    res = runHook(TRACK_STATS, payload, home);
    expect(res.stdout).toBe('{}');

    const stats = JSON.parse(
      fs.readFileSync(path.join(home, '.claude/hooks-logs/session-stats.json'), 'utf8')
    );
    expect(stats.skillInvocations['superpowers:brainstorming']).toBe(2);
    expect(stats.totalSkillCalls).toBe(2);
  });

  it('returns {} and does not tally for non-Skill tools', () => {
    const res = runHook(TRACK_STATS, { tool_name: 'Edit', tool_input: {} }, home);
    expect(res.stdout).toBe('{}');
    expect(fs.existsSync(path.join(home, '.claude/hooks-logs/session-stats.json'))).toBe(false);
  });

  it('expires stats older than 2 hours via loadStats', async () => {
    const origHome = process.env.HOME;
    const origUP = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const { loadStats, saveStats, createFreshStats } = await import('../hooks/track-session-stats.js?stats');
    const stale = createFreshStats();
    stale.startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    stale.totalSkillCalls = 9;
    saveStats(stale);
    const loaded = loadStats();
    expect(loaded.totalSkillCalls).toBe(0);
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUP;
  });
});
