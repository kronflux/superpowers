import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'conductor-nudges.js');

let home; let sid = 0; let sessionId;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-nudge-home-'));
  sessionId = `nudge-test-${process.pid}-${sid++}`;
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), `sp-conductor-${sessionId}`), { force: true });
});

function seedState(caps, spent = {}) {
  const base = { codegraph: false, serena: false, middleware: false };
  fs.writeFileSync(path.join(os.tmpdir(), `sp-conductor-${sessionId}`), JSON.stringify({
    caps: { ...base, ...caps },
    spent: { ...base, ...spent },
  }));
}

function run(payload) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ session_id: sessionId, cwd: home, ...payload }),
    encoding: 'utf8', env,
  });
  return JSON.parse(out);
}

const ctx = (out) => out?.hookSpecificOutput?.additionalContext ?? null;

describe('conductor-nudges', () => {
  it('nudges codegraph on Grep once, then goes silent', () => {
    seedState({ codegraph: true });
    const first = run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } });
    expect(ctx(first)).toMatch(/codegraph explore/);
    const second = run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'y' } });
    expect(second).toEqual({});
  });

  it('nudges serena on first Edit only', () => {
    seedState({ serena: true });
    expect(ctx(run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} }))).toMatch(/[Ss]erena/);
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} })).toEqual({});
  });

  it('nudges middleware only on large failing Bash output', () => {
    seedState({ middleware: true });
    const big = 'FAIL tests/x.test.js\n' + 'assertion detail line\n'.repeat(200);
    const small = 'FAIL quick';
    const bigPass = 'all tests passed\n' + 'ok line\n'.repeat(200);
    expect(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: small, stderr: '' } })).toEqual({});
    expect(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: bigPass, stderr: '' } })).toEqual({});
    expect(ctx(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: big, stderr: '' } }))).toMatch(/summarize-test-failure/);
    expect(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: big, stderr: '' } })).toEqual({});
  });

  it('does not nudge a class whose capability is absent', () => {
    seedState({ serena: true }); // codegraph false
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} })).toEqual({});
  });

  it('creates a state file on first run with no capabilities in an empty home', () => {
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} })).toEqual({});
    expect(fs.existsSync(path.join(os.tmpdir(), `sp-conductor-${sessionId}`))).toBe(true);
  });

  it('fails open on malformed stdin', () => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const out = execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8', env });
    expect(JSON.parse(out)).toEqual({});
  });
});
