import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { capInjection, INJECTION_CAP_BYTES, LABEL_MIN_SCORE, renderMatch } from '../hooks/skill-activator.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'skill-activator.js');

// Isolated home so hook telemetry never touches the real ~/.claude/hooks-logs
const tmpHome = fs.mkdtempSync(path.join(spTmpDir(), 'sp-activator-'));
afterAll(() => { fs.rmSync(tmpHome, { recursive: true, force: true }); });

function run(payload, env = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.CLAUDE_CONFIG_DIR;
  const fullEnv = { ...baseEnv, HOME: tmpHome, USERPROFILE: tmpHome, ...env };
  return execFileSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: fullEnv,
  });
}

describe('skill-activator', () => {
  it('routes a debugging prompt to superpowers:systematic-debugging', () => {
    const out = run({
      prompt: 'there is a bug, the app crashes with an exception',
      cwd: '/tmp',
    });
    const json = JSON.parse(out);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.additionalContext).toContain('superpowers:systematic-debugging');
  });

  it('emits {} for a micro-task prompt (no injection)', () => {
    const out = run({ prompt: 'fix the typo', cwd: '/tmp' });
    expect(out.trim()).toBe('{}');
  });

  it('never emits the superpowers-optimized: namespace', () => {
    const debugOut = run({
      prompt: 'there is a bug, the app crashes with an exception',
      cwd: '/tmp',
    });
    const microOut = run({ prompt: 'fix the typo', cwd: '/tmp' });
    expect(debugOut).not.toContain('superpowers-optimized:');
    expect(microOut).not.toContain('superpowers-optimized:');
  });

  it('fails open to {} on invalid input', () => {
    const fullEnv = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    delete fullEnv.CLAUDE_CONFIG_DIR;
    const out = execFileSync('node', [HOOK], {
      input: 'not json',
      encoding: 'utf8',
      env: fullEnv,
    });
    expect(out.trim()).toBe('{}');
  });
});

describe('skill-activator config root isolation', () => {
  it('writes telemetry under CLAUDE_CONFIG_DIR, not HOME/.claude, when both are set', () => {
    const profileDir = fs.mkdtempSync(path.join(spTmpDir(), 'sp-activator-profile-'));
    const otherHome = fs.mkdtempSync(path.join(spTmpDir(), 'sp-activator-otherhome-'));
    try {
      const out = run(
        { prompt: 'there is a bug, the app crashes with an exception', cwd: '/tmp' },
        { CLAUDE_CONFIG_DIR: profileDir, HOME: otherHome, USERPROFILE: otherHome },
      );
      expect(JSON.parse(out).hookSpecificOutput).toBeDefined();

      const statsInProfile = path.join(profileDir, 'hooks-logs', 'session-stats.json');
      const statsInOtherHome = path.join(otherHome, '.claude', 'hooks-logs', 'session-stats.json');
      expect(fs.existsSync(statsInProfile)).toBe(true);
      expect(fs.existsSync(statsInOtherHome)).toBe(false);
    } finally {
      fs.rmSync(profileDir, { recursive: true, force: true });
      fs.rmSync(otherHome, { recursive: true, force: true });
    }
  });
});

describe('capInjection', () => {
  it('keeps Infinity-scored hints and drops lowest-scored blocks until <= cap', () => {
    const hint = { text: 'H'.repeat(500), score: Infinity };
    const mem = { text: 'M'.repeat(2000), score: 0.9 };
    const ki = { text: 'K'.repeat(2000), score: 0.3 };
    // Total 4500 bytes + 4 separator bytes > 4000 cap; lowest-scored block (ki) dropped.
    const blocks = [hint, mem, ki].sort((a, b) => b.score - a.score);
    const kept = capInjection(blocks);
    const total = kept.reduce((n, b) => n + Buffer.byteLength(b.text), 0);
    expect(total).toBeLessThanOrEqual(INJECTION_CAP_BYTES);
    expect(kept).toContain(hint); // hints never dropped
    expect(kept).not.toContain(ki); // lowest-scored dropped first
    expect(kept).toContain(mem);
  });

  it('never drops below one block even when it exceeds the cap', () => {
    const only = { text: 'H'.repeat(9000), score: Infinity };
    const kept = capInjection([only]);
    expect(kept).toEqual([only]);
  });

  it('drops nothing when blocks plus separators sum to exactly the cap', () => {
    // 1998 + 2000 text bytes + 2 separator bytes = 4000 exactly
    const hint = { text: 'H'.repeat(1998), score: Infinity };
    const mem = { text: 'M'.repeat(2000), score: 0.5 };
    const kept = capInjection([hint, mem]);
    expect(kept).toEqual([hint, mem]);
  });
});

describe('renderMatch severity calibration', () => {
  it('omits the label when a critical match is weak', () => {
    expect(renderMatch({ skill: 'systematic-debugging', priority: 'critical', score: 2 }))
      .toBe('  - superpowers:systematic-debugging');
  });

  it('keeps the label when a critical match is strong', () => {
    expect(renderMatch({ skill: 'systematic-debugging', priority: 'critical', score: 4 }))
      .toBe('  - superpowers:systematic-debugging (critical)');
  });

  it('keeps a medium label at its own threshold', () => {
    expect(renderMatch({ skill: 'claude-md-creator', priority: 'medium', score: LABEL_MIN_SCORE.medium }))
      .toBe('  - superpowers:claude-md-creator (medium)');
  });

  it('omits the label for an unknown priority', () => {
    expect(renderMatch({ skill: 'x', priority: 'bogus', score: 99 }))
      .toBe('  - superpowers:x');
  });
});
