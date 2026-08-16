import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { allowlistPath, isAllowed, recordAllowed } from '../hooks/lib/ask-allowlist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRE = path.join(__dirname, '..', 'hooks', 'safety', 'block-dangerous-commands.js');
const POST = path.join(__dirname, '..', 'hooks', 'safety', 'record-ask-approval.js');

const tmpHome = fs.mkdtempSync(path.join(spTmpDir(), 'sp-allow-'));
const written = [];
afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  for (const f of written) fs.rmSync(f, { force: true });
});

function run(hook, payload) {
  return execFileSync('node', [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, CLAUDE_CONFIG_DIR: tmpHome },
  });
}

describe('allowlist storage', () => {
  it('lives under the sp/ temp root', () => {
    const p = allowlistPath('sess-a');
    written.push(p);
    expect(path.dirname(p)).toBe(spTmpDir());
    expect(path.basename(p)).toBe('askallow-sess-a');
  });

  it('is scoped per session', () => {
    written.push(allowlistPath('sess-b'), allowlistPath('sess-c'));
    recordAllowed('sess-b', 'git add --all');
    expect(isAllowed('sess-b', 'git add --all')).toBe(true);
    expect(isAllowed('sess-c', 'git add --all')).toBe(false);
  });

  it('treats a whitespace-different command as a distinct entry', () => {
    written.push(allowlistPath('sess-d'));
    recordAllowed('sess-d', 'git add --all');
    expect(isAllowed('sess-d', 'git   add   --all')).toBe(false);
    expect(isAllowed('sess-d', 'git add -A')).toBe(false);
  });

  it('does not duplicate an entry recorded twice', () => {
    const p = allowlistPath('sess-dup');
    written.push(p);
    recordAllowed('sess-dup', 'git add --all');
    recordAllowed('sess-dup', 'git add --all');
    expect(fs.readFileSync(p, 'utf8').split('\0').filter(Boolean)).toHaveLength(1);
  });

  it('reports not-allowed when no allowlist exists', () => {
    expect(isAllowed('sess-none', 'git add --all')).toBe(false);
  });

  it('does not collide across quoted message content', () => {
    written.push(allowlistPath('sess-msg'));
    recordAllowed('sess-msg', 'git commit -am "fix typo"');
    expect(isAllowed('sess-msg', 'git commit -am "rewrite the auth layer"')).toBe(false);
  });

  it('does not collide across heredoc body content', () => {
    written.push(allowlistPath('sess-heredoc'));
    recordAllowed('sess-heredoc', "git commit -F - <<'EOF'\nmsg one\nEOF");
    expect(isAllowed('sess-heredoc', "git commit -F - <<'EOF'\nmsg two\nEOF")).toBe(false);
  });

  it('treats a tab and a space inside a quoted message as distinct entries', () => {
    written.push(allowlistPath('sess-tab'));
    recordAllowed('sess-tab', 'git commit -m "a\tb"');
    expect(isAllowed('sess-tab', 'git commit -m "a b"')).toBe(false);
  });

  it('treats a heredoc body with a blank line and one without as distinct entries', () => {
    written.push(allowlistPath('sess-blank'));
    recordAllowed('sess-blank', "git commit -F - <<'EOF'\nFix bug\n\nRefs #1\nEOF");
    expect(isAllowed('sess-blank', "git commit -F - <<'EOF'\nFix bug\nRefs #1\nEOF")).toBe(false);
  });

  it('treats two byte-identical commands as the same entry', () => {
    written.push(allowlistPath('sess-same'));
    const cmd = "git commit -F - <<'EOF'\nFix bug\n\nRefs #1\nEOF";
    recordAllowed('sess-same', cmd);
    expect(isAllowed('sess-same', cmd)).toBe(true);
  });
});

describe('end to end', () => {
  it('asks the first time and stays silent after the command runs', () => {
    const session_id = 'sess-e2e';
    written.push(allowlistPath(session_id));
    const payload = {
      tool_name: 'Bash',
      tool_input: { command: 'git add --all' },
      session_id,
      cwd: tmpHome,
    };

    const first = JSON.parse(run(PRE, payload));
    expect(first.hookSpecificOutput.permissionDecision).toBe('ask');

    run(POST, { ...payload, tool_response: { stdout: '' } });

    const second = JSON.parse(run(PRE, payload));
    expect(second).toEqual({});
  });

  it('still asks for a different command in the same session', () => {
    const session_id = 'sess-other';
    written.push(allowlistPath(session_id));
    const base = { tool_name: 'Bash', session_id, cwd: tmpHome };
    run(POST, { ...base, tool_input: { command: 'git add --all' } });
    const out = JSON.parse(run(PRE, { ...base, tool_input: { command: 'git add -A' } }));
    expect(out.hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('records nothing for a command that matches no ask pattern', () => {
    const session_id = 'sess-noop';
    const p = allowlistPath(session_id);
    written.push(p);
    run(POST, {
      tool_name: 'Bash',
      tool_input: { command: 'git status --porcelain' },
      session_id,
      cwd: tmpHome,
    });
    expect(fs.existsSync(p)).toBe(false);
  });

  it('records nothing for a non-Bash tool', () => {
    const session_id = 'sess-nonbash';
    const p = allowlistPath(session_id);
    written.push(p);
    run(POST, { tool_name: 'Edit', tool_input: { command: 'git add --all' }, session_id, cwd: tmpHome });
    expect(fs.existsSync(p)).toBe(false);
  });

  it('emits an empty object on malformed input', () => {
    const out = execFileSync('node', [POST], {
      input: 'not json',
      encoding: 'utf8',
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, CLAUDE_CONFIG_DIR: tmpHome },
    });
    expect(JSON.parse(out)).toEqual({});
  });
});
