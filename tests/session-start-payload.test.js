import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Context economy: the SessionStart hook injects the full using-superpowers
// SKILL.md into EVERY session. That payload is an always-on context cost and
// must stay under budget. The hook resolves the skill path from its own
// location (SCRIPT_DIR/..), so it is invoked by absolute path from a scratch
// cwd that has no docs/superpowers/model-routing.json — and HOME is pointed
// at the same scratch dir — so the opt-in <model-routing-active> block stays
// absent, exactly like a production session without the routing opt-in.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'session-start').replace(/\\/g, '/');

describe('session-start context economy', () => {
  it('assembled payload <= 5200 bytes', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-payload-'));
    let raw;
    try {
      raw = execSync(`bash "${HOOK}"`, {
        cwd: scratch,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: ROOT,
          HOME: scratch,
          COPILOT_CLI: '',
          CURSOR_PLUGIN_ROOT: '',
        },
      }).toString();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    const parsed = JSON.parse(raw);
    const ctx = parsed?.hookSpecificOutput?.additionalContext ?? raw;
    // Claude Code shape must be selected (CLAUDE_PLUGIN_ROOT set, no COPILOT_CLI).
    expect(parsed?.hookSpecificOutput?.hookEventName).toBe('SessionStart');
    // Routing must be absent: this measures the always-on core payload only.
    expect(ctx).not.toContain('<model-routing-active>');
    // Conductor capability summary line is injected best-effort at session start.
    // Cap raised from 5200 to 5232: measured payload with the line is 5212 B
    // (+20 B headroom for minor capability-list variance across machines).
    expect(ctx).toMatch(/^\[conductor\] /m);
    expect(Buffer.byteLength(ctx)).toBeLessThanOrEqual(5232);
  });
});
