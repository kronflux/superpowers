import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'conductor-nudges.js');

// Directory that resolves `node` on the real PATH, so a sandboxed PATH keeps
// node runnable without leaking any other PATH entries (e.g. a machine-local
// `codegraph` install) into the probe. Mirrors tests/session-start-payload.test.js.
function dirOf(bin) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && exts.some((ext) => fs.existsSync(path.join(dir, bin + ext)))) return dir;
  }
  return null;
}
const SANDBOX_PATH = [dirOf('node')].filter(Boolean).join(path.delimiter);

let home; let sid = 0; let sessionId;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-nudge-home-'));
  sessionId = `nudge-test-${process.pid}-${sid++}`;
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), `sp-conductor-${sessionId}`), { force: true });
  for (const cls of ['codegraph', 'serena', 'middleware']) {
    fs.rmSync(path.join(os.tmpdir(), `sp-conductor-${sessionId}-${cls}`), { force: true });
  }
});

function seedState(caps, spent = {}) {
  const base = { codegraph: false, serena: false, middleware: false };
  fs.writeFileSync(path.join(os.tmpdir(), `sp-conductor-${sessionId}`), JSON.stringify({
    caps: { ...base, ...caps },
    spent: { ...base, ...spent },
  }));
}

function run(payload, envOverride = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...envOverride };
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

  it('gates the codegraph nudge on capability status, not an indexed dir alone', () => {
    fs.mkdirSync(path.join(home, '.codegraph'));
    const out = run(
      { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } },
      { PATH: SANDBOX_PATH }
    );
    expect(out).toEqual({});
    const state = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `sp-conductor-${sessionId}`), 'utf8'));
    expect(state.caps.codegraph).toBe(false);
  });

  it('emits exactly one nudge across 5 concurrent first-turn invocations', async () => {
    seedState({ codegraph: true });
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CONFIG_DIR;
    const payload = JSON.stringify({
      session_id: sessionId, cwd: home,
      hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' },
    });
    // execFile's (async) options do not support `input` the way the Sync
    // variants do - the child's stdin must be written and closed by hand,
    // or the hook's `for await (const chunk of process.stdin)` blocks forever.
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => {
        const p = execFileAsync('node', [HOOK], { encoding: 'utf8', env });
        p.child.stdin.end(payload);
        return p;
      })
    );
    const outs = runs.map((r) => JSON.parse(r.stdout));
    const withCtx = outs.filter((o) => ctx(o));
    expect(withCtx.length).toBe(1);
    expect(ctx(withCtx[0])).toMatch(/codegraph explore/);
  }, 10000);
});
