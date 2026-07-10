import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capInjection, INJECTION_CAP_BYTES } from '../hooks/skill-activator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'skill-activator.js');

// Isolated home so hook telemetry never touches the real ~/.claude/hooks-logs
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-activator-'));
afterAll(() => { fs.rmSync(tmpHome, { recursive: true, force: true }); });

function run(payload) {
  return execFileSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
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
    const out = execFileSync('node', [HOOK], {
      input: 'not json',
      encoding: 'utf8',
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
    });
    expect(out.trim()).toBe('{}');
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
