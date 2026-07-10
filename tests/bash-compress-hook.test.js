import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, '../hooks/bash-compress-hook.js');

function ctxCacheFile(sid) {
  return path.join(os.tmpdir(), `sp-ctx-${sid}.json`);
}
function seedCtx(sid, active) {
  fs.writeFileSync(ctxCacheFile(sid), JSON.stringify({ active, ts: Date.now() }));
}
function runHook(payload, env = {}) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return JSON.parse(res.stdout || '{}');
}

describe('bash-compress-hook', () => {
  let sid;
  beforeEach(() => { sid = 'cmp-' + Math.random().toString(36).slice(2); });

  it('YIELDS when context-mode active: no updatedInput', () => {
    seedCtx(sid, true);
    const out = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      session_id: sid,
    });
    expect(out).toEqual({});
    // an explicit SP_NO_COMPRESS=1 env must short-circuit to {}
    const out2 = runHook(
      { tool_name: 'Bash', tool_input: { command: 'npm test' }, session_id: sid },
      { SP_NO_COMPRESS: '1' }
    );
    expect(out2).toEqual({});
  });

  it('COMPRESSES when context-mode inactive and a rule matches', () => {
    seedCtx(sid, false);
    const out = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      session_id: sid,
    });
    expect(out.hookSpecificOutput).toBeTruthy();
    expect(out.hookSpecificOutput.updatedInput.command).toMatch(/bash-optimizer\.js/);
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('passes through non-Bash tools', () => {
    seedCtx(sid, false);
    const out = runHook({ tool_name: 'Read', tool_input: { file_path: 'x' }, session_id: sid });
    expect(out).toEqual({});
  });
});
