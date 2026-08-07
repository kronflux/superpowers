import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD_HOOK = path.resolve(__dirname, '../hooks/subagent-guard.js');
const STOP_HOOK = path.resolve(__dirname, '../hooks/stop-reminders.js');

function runGuard(lastMessage) {
  const res = spawnSync('node', [GUARD_HOOK], {
    input: JSON.stringify({ last_assistant_message: lastMessage, agent_id: 'a', agent_type: 't' }),
    encoding: 'utf8',
  });
  return JSON.parse(res.stdout || '{}');
}

function runStop(sessionId) {
  const res = spawnSync('node', [STOP_HOOK], {
    input: JSON.stringify({ session_id: sessionId, cwd: spTmpDir() }),
    encoding: 'utf8',
  });
  return { json: JSON.parse(res.stdout || '{}'), status: res.status };
}

describe('subagent-guard (namespace-scoped)', () => {
  it('BLOCKS a superpowers: skill invocation by a subagent', () => {
    const out = runGuard('I am invoking the brainstorming skill now via Skill(superpowers:brainstorming).');
    expect(out.decision).toBe('block');
  });

  it('BLOCKS a Plan 2-3 skill (checking-gates) via Skill(superpowers:...)', () => {
    const out = runGuard('Now using checking-gates via Skill(superpowers:checking-gates).');
    expect(out.decision).toBe('block');
  });

  it('BLOCKS a bare Skill(test-driven-development) without the superpowers: prefix', () => {
    const out = runGuard('Let me run Skill(test-driven-development) to do this properly.');
    expect(out.decision).toBe('block');
  });

  it('does NOT flag a bare Skill() for an unknown/other-plugin name', () => {
    const out = runGuard('I will call Skill(some-other-plugin-thing) to deploy.');
    expect(out).toEqual({});
  });

  it('does NOT flag a context-mode tool reference', () => {
    const out = runGuard('I called ctx_search and used context-mode to analyze the logs.');
    expect(out).toEqual({});
  });

  it('does NOT flag a non-superpowers skill reference', () => {
    const out = runGuard('I used the some-other-plugin:deploy skill to ship it.');
    expect(out).toEqual({});
  });

  it('does NOT flag a bare prose mention without an action verb', () => {
    const out = runGuard('The brainstorming document lists three options.');
    expect(out).toEqual({});
  });

  it('allows a clean stop', () => {
    const out = runGuard('Task complete. Edited two files and ran the tests.');
    expect(out).toEqual({});
  });
});

describe('stop-reminders (per-session lock)', () => {
  it('uses a per-session lock filename under the sp/ tmp root, keyed by sessionId', async () => {
    const { guardFile } = await import('../hooks/stop-reminders.js');
    const gf = guardFile('abc123');
    expect(path.dirname(gf)).toBe(spTmpDir());
    expect(path.basename(gf)).toBe('stop-abc123.lock');
  });

  it('two different sessions do not share the lock', async () => {
    const { guardFile } = await import('../hooks/stop-reminders.js');
    expect(guardFile('sessA')).not.toBe(guardFile('sessB'));
  });

  it('same session within TTL does not re-fire (shouldFire false after setGuard)', async () => {
    const { guardFile, setGuard, shouldFire } = await import('../hooks/stop-reminders.js');
    const sid = `vitest-${Date.now()}`;
    const gf = guardFile(sid);
    try { fs.unlinkSync(gf); } catch {}
    expect(shouldFire(sid)).toBe(true);
    setGuard(sid);
    expect(shouldFire(sid)).toBe(false);
    expect(shouldFire(`${sid}-other`)).toBe(true);
    try { fs.unlinkSync(gf); } catch {}
  });

  it('runs end-to-end without crashing and emits valid JSON', () => {
    const sid = `stp-e2e-${Date.now()}`;
    const gf = path.join(spTmpDir(), `stop-${sid}.lock`);
    try { fs.unlinkSync(gf); } catch {}
    const r = runStop(sid);
    expect(r.status).toBe(0);
    expect(typeof r.json).toBe('object');
    try { fs.unlinkSync(gf); } catch {}
  });
});
