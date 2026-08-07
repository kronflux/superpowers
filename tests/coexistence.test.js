import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// hooks/stop-reminders.js, hooks/bash-compress-hook.js, and hooks/track-edits.js
// land in the next task's commit; import/read defensively so this file loads
// and the rest of the suite still runs on this branch.
const hasStopReminders = existsSync(path.join(ROOT, 'hooks/stop-reminders.js'));
const hasBashCompress = existsSync(path.join(ROOT, 'hooks/bash-compress-hook.js'));
const hasTrackEdits = existsSync(path.join(ROOT, 'hooks/track-edits.js'));
const { guardFile, setGuard, shouldFire } = hasStopReminders
  ? await import('../hooks/stop-reminders.js')
  : {};

function runHook(hookPath, event, env = {}) {
  const res = spawnSync('node', [path.join(ROOT, hookPath)], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  try { return JSON.parse(res.stdout || '{}'); } catch { return {}; }
}

function bashEvent(command) {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    session_id: 'coexist-' + Math.random().toString(36).slice(2),
  };
}

describe('coexistence with context-mode', () => {
  it.skipIf(!hasBashCompress || !hasStopReminders)(
    'plugin tmpfiles live under the sp/ root (no context-mode-/cm- collision)', () => {
    const hookFiles = [
      'hooks/bash-compress-hook.js',
      'hooks/stop-reminders.js',
      'hooks/lib/ctx-detect.js',
    ].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const src of hookFiles) {
      // none reference context-mode's prefixes
      expect(src.includes('context-mode-')).toBe(false);
      expect(/`cm-wt-/.test(src)).toBe(false);
    }
  });

  it.skipIf(!hasStopReminders)('stop lock is per-session, under the sp/ tmp root', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hooks/stop-reminders.js'), 'utf8');
    expect(src).toMatch(/spTmp\(`stop-\$\{/);
    expect(src.includes('stop-hook-fired.lock')).toBe(false);
  });

  it.skipIf(!hasStopReminders)('stop guard is per-session (distinct tmpdir locks, no global lock)', () => {
    const mk = () => 'co-' + Math.random().toString(36).slice(2);
    const s1 = mk(), s2 = mk();

    // The real guardFile() must produce a per-session tmpdir path, not a global one.
    const gf1 = guardFile(s1);
    const gf2 = guardFile(s2);
    expect(gf1).toBe(path.join(os.tmpdir(), 'sp', `stop-${s1}.lock`));
    expect(gf2).toBe(path.join(os.tmpdir(), 'sp', `stop-${s2}.lock`));
    expect(gf1).not.toBe(gf2);

    // Setting the guard for s1 must create exactly that session's lock,
    // never a shared/global one.
    setGuard(s1);
    try {
      expect(fs.existsSync(gf1)).toBe(true);
      expect(fs.existsSync(path.join(os.tmpdir(), 'sp', 'stop-default.lock'))).toBe(false);

      // Within the TTL, the guarded session must not re-fire, while a different
      // session is unaffected — proving the lock is keyed per session.
      expect(shouldFire(s1)).toBe(false);
      expect(shouldFire(s2)).toBe(true);
    } finally {
      fs.rmSync(gf1, { force: true });
    }
  });

  it.skipIf(!hasTrackEdits)('gitignore "# AI assistant artifacts" header is written idempotently', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-'));
    // Pre-seed a .gitignore already containing the header once.
    const gi = path.join(tmp, '.gitignore');
    fs.writeFileSync(gi, '# AI assistant artifacts\ncontext-snapshot.json\n');
    // Run track-edits which writes an AI artifact and may touch .gitignore.
    spawnSync('node', [path.join(ROOT, 'hooks/track-edits.js')], {
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: path.join(tmp, 'session-log.md') },
        cwd: tmp, session_id: 's',
      }),
      encoding: 'utf8',
    });
    const after = fs.readFileSync(gi, 'utf8');
    const headerCount = (after.match(/# AI assistant artifacts/g) || []).length;
    expect(headerCount).toBe(1);
  });

  it('no hook references PreCompact', () => {
    const hj = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
    expect(hj.hooks.PreCompact).toBeUndefined();
  });

  it('every script referenced in hooks.json exists on disk', () => {
    const hj = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
    const referenced = [];
    for (const event of Object.values(hj.hooks)) {
      for (const group of event) {
        for (const h of group.hooks || []) {
          if (h.type !== 'command' || !h.command) continue;
          // Extract the script path: strip the leading runner (node / run-hook.cmd)
          // and resolve ${CLAUDE_PLUGIN_ROOT} to ROOT.
          const matches = h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?)(?="|\s|$)/g) || [];
          for (const m of matches) {
            const rel = m.replace('${CLAUDE_PLUGIN_ROOT}/', '');
            referenced.push(rel);
          }
        }
      }
    }
    expect(referenced.length).toBeGreaterThan(0);
    for (const rel of referenced) {
      // run-hook.cmd is invoked with a subcommand arg (session-start); both the
      // .cmd dispatcher and its target must exist.
      const abs = path.join(ROOT, rel);
      expect(fs.existsSync(abs), `missing referenced hook: ${rel}`).toBe(true);
    }
    // The session-start subcommand dispatched by run-hook.cmd must also exist.
    expect(fs.existsSync(path.join(ROOT, 'hooks/session-start'))).toBe(true);
  });

  it.skipIf(!hasBashCompress)(
    'bash-compress emits no updatedInput when ctx-detect is active', async () => {
      process.env.SP_TEST_FORCE_CTX = '1';
      const out = await runHook('hooks/bash-compress-hook.js', bashEvent('npm test'));
      expect(out?.hookSpecificOutput?.updatedInput).toBeUndefined();
    });
});
