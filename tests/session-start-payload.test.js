import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spTmp, spTmpDir } from '../hooks/lib/sp-tmp.js';

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

// Directory that resolves `bin` on the real PATH, so the sandboxed PATH below
// keeps bash/coreutils/node runnable without leaking any other PATH entries
// (e.g. a machine-local `codegraph`/`obsidian-cli` install) into the probe.
function dirOf(bin) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && exts.some((ext) => fs.existsSync(path.join(dir, bin + ext)))) return dir;
  }
  return null;
}
const SANDBOX_PATH = [dirOf('bash'), dirOf('node')]
  .filter(Boolean)
  .filter((d, i, arr) => arr.indexOf(d) === i)
  .join(path.delimiter);

function runHook(cwd) {
  const raw = execSync(`bash "${HOOK}"`, {
    cwd,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      HOME: cwd,
      CLAUDE_CONFIG_DIR: cwd,
      PATH: SANDBOX_PATH,
      COPILOT_CLI: '',
      CURSOR_PLUGIN_ROOT: '',
    },
  }).toString();
  const parsed = JSON.parse(raw);
  return parsed?.hookSpecificOutput?.additionalContext ?? raw;
}

function withScratch(fn) {
  const scratch = fs.mkdtempSync(path.join(spTmpDir(), 'sp-payload-'));
  try { return fn(scratch); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

// Runs the hook with an explicit stdin payload (or none, when `input` is
// undefined) and returns the raw stdout string, unparsed — callers decide
// whether they need the JSON-wrapped context or a bare `{}`.
function runHookStdin(cwd, input) {
  const opts = {
    cwd,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      HOME: cwd,
      CLAUDE_CONFIG_DIR: cwd,
      PATH: SANDBOX_PATH,
      COPILOT_CLI: '',
      CURSOR_PLUGIN_ROOT: '',
    },
  };
  if (input !== undefined) opts.input = input;
  return execSync(`bash "${HOOK}"`, opts).toString();
}

function ctxOf(raw) {
  const parsed = JSON.parse(raw);
  return parsed?.hookSpecificOutput?.additionalContext ?? raw;
}

function guardPath(sessionId, source) {
  return spTmp(`session-start-${sessionId}-${source}.guard`);
}

function cleanupGuard(sessionId, source) {
  try { fs.rmSync(guardPath(sessionId, source), { force: true }); } catch {}
}

const ROUTING_JSON = JSON.stringify({ schema: 2, mechanical: 'haiku', standard: 'sonnet', advanced: 'opus', frontier: 'off' });

function writeRouting(scratch, relDir) {
  const dir = path.join(scratch, ...relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'model-routing.json'), ROUTING_JSON);
}

function writePlanTasks(scratch, fileName, tasksJson) {
  const dir = path.join(scratch, '.superpowers', 'plans');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(tasksJson));
}

describe('session-start context economy', () => {
  it('assembled payload <= 5232 bytes', () => {
    const scratch = fs.mkdtempSync(path.join(spTmpDir(), 'sp-payload-'));
    let raw;
    try {
      raw = execSync(`bash "${HOOK}"`, {
        cwd: scratch,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: ROOT,
          HOME: scratch,
          CLAUDE_CONFIG_DIR: scratch,
          PATH: SANDBOX_PATH,
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

describe('using-superpowers compact core', () => {
  const SKILL_MD = path.join(ROOT, 'skills', 'using-superpowers', 'SKILL.md');
  const START_TAG = '<!-- compact-core:start -->';
  const END_TAG = '<!-- compact-core:end -->';

  // Mirrors the frontmatter-stripping awk in hooks/session-start, so this measures
  // the same body the hook injects.
  function bodyOf(src) {
    const lines = src.split(/\r?\n/);
    const out = [];
    let inFrontmatter = false;
    lines.forEach((line, i) => {
      if (i === 0 && /^---\s*$/.test(line)) { inFrontmatter = true; return; }
      if (inFrontmatter) { if (/^---\s*$/.test(line)) inFrontmatter = false; return; }
      out.push(line);
    });
    return out.join('\n');
  }

  const src = fs.readFileSync(SKILL_MD, 'utf8');
  const body = bodyOf(src);

  it('has exactly one start delimiter and one end delimiter, start before end', () => {
    // A moved or duplicated delimiter would silently make the core the whole
    // document or empty while every other assertion here could still pass.
    const starts = body.match(new RegExp(START_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];
    const ends = body.match(new RegExp(END_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];
    expect(starts.length).toBe(1);
    expect(ends.length).toBe(1);
    expect(body.indexOf(START_TAG)).toBeLessThan(body.indexOf(END_TAG));
  });

  function extractCore(text) {
    const s = text.indexOf(START_TAG);
    const e = text.indexOf(END_TAG);
    return text.slice(s + START_TAG.length, e).trim();
  }

  it('the delimited core is <= 2304 bytes', () => {
    expect(Buffer.byteLength(extractCore(body))).toBeLessThanOrEqual(2304);
  });

  it('the core is non-empty', () => {
    expect(extractCore(body).length).toBeGreaterThan(0);
  });

  it('the core contains the override-order line and the Routing Guide table header', () => {
    const core = extractCore(body);
    expect(core).toContain('Override order: user instruction > project context file > skill > default.');
    expect(core).toContain('|Situation|Skill|');
  });

  it('the core contains the skill-invocation mandate', () => {
    // The mandate is why an agent consults the routing table at all; a
    // compacting session that keeps the table but loses the mandate keeps
    // the map and drops the instruction to navigate it.
    const core = extractCore(body);
    expect(core).toContain('**Invoke relevant or requested skills BEFORE any response or action**');
  });

  it('the core is strictly smaller than the full body', () => {
    expect(Buffer.byteLength(extractCore(body))).toBeLessThan(Buffer.byteLength(body));
  });
});

describe('session-start routing candidate chain', () => {
  it('legacy project routing config adds the migration-offer line', () => {
    withScratch((scratch) => {
      writeRouting(scratch, ['docs', 'superpowers']);
      const ctx = runHook(scratch);
      expect(ctx).toContain('<model-routing-active>');
      expect(ctx).toContain('LEGACY CONFIG PATH');
      expect(ctx).toContain('.superpowers/model-routing.json');
    });
  });

  it('canonical project routing config carries no legacy line', () => {
    withScratch((scratch) => {
      writeRouting(scratch, ['.superpowers']);
      const ctx = runHook(scratch);
      expect(ctx).toContain('<model-routing-active>');
      expect(ctx).not.toContain('LEGACY CONFIG PATH');
    });
  });

  it('canonical wins over legacy when both exist, with no legacy line', () => {
    withScratch((scratch) => {
      writeRouting(scratch, ['docs', 'superpowers']);
      writeRouting(scratch, ['.superpowers']);
      const ctx = runHook(scratch);
      expect(ctx).toContain('.superpowers/model-routing.json');
      expect(ctx).not.toContain('docs/superpowers');
      expect(ctx).not.toContain('LEGACY CONFIG PATH');
    });
  });
});

describe('session-start interrupted-plan pointer', () => {
  it('a plan with open tasks produces a line naming the plan and the open count', () => {
    withScratch((scratch) => {
      writePlanTasks(scratch, 'alpha.md.tasks.json', {
        plan: '.superpowers/plans/alpha.md',
        tasks: [{ status: 'completed' }, { status: 'pending' }, { status: 'in_progress' }],
      });
      const ctx = runHook(scratch);
      expect(ctx).toContain('[plan] alpha: 2 open');
    });
  });

  it('a plan with all tasks completed produces no line', () => {
    withScratch((scratch) => {
      writePlanTasks(scratch, 'beta.md.tasks.json', {
        plan: '.superpowers/plans/beta.md',
        tasks: [{ status: 'completed' }, { status: 'completed' }],
      });
      const ctx = runHook(scratch);
      expect(ctx).not.toMatch(/\[plan\] \S+: \d+ open/);
    });
  });

  it('an absent .superpowers/plans/ directory produces no line and no fault', () => {
    withScratch((scratch) => {
      const ctx = runHook(scratch);
      expect(ctx).not.toMatch(/\[plan\] \S+: \d+ open/);
    });
  });

  it('a malformed .tasks.json produces no line and no fault', () => {
    withScratch((scratch) => {
      const dir = path.join(scratch, '.superpowers', 'plans');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'gamma.md.tasks.json'), '{not valid json');
      const ctx = runHook(scratch);
      expect(ctx).not.toMatch(/\[plan\] \S+: \d+ open/);
    });
  });

  // Two plans both carry open tasks: the pointer names one line, so this
  // resolves to the most recently modified snapshot rather than listing both.
  it('multiple plans with open tasks: only the most recently modified snapshot is named', () => {
    withScratch((scratch) => {
      writePlanTasks(scratch, 'older.md.tasks.json', {
        plan: '.superpowers/plans/older.md',
        tasks: [{ status: 'pending' }],
      });
      const dir = path.join(scratch, '.superpowers', 'plans');
      const past = new Date(Date.now() - 60000);
      fs.utimesSync(path.join(dir, 'older.md.tasks.json'), past, past);
      writePlanTasks(scratch, 'newer.md.tasks.json', {
        plan: '.superpowers/plans/newer.md',
        tasks: [{ status: 'in_progress' }],
      });
      const ctx = runHook(scratch);
      expect(ctx).toContain('[plan] newer: 1 open');
      expect(ctx).not.toContain('[plan] older');
    });
  });
});

describe('session-start event tiering', () => {
  it('source: startup emits the full body', () => {
    withScratch((scratch) => {
      const sid = `t-startup-${Date.now()}`;
      try {
        const ctx = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'startup', session_id: sid })));
        expect(ctx).toContain('## Entry Sequence');
      } finally {
        cleanupGuard(sid, 'startup');
      }
    });
  });

  it('source: clear emits the full body', () => {
    withScratch((scratch) => {
      const sid = `t-clear-${Date.now()}`;
      try {
        const ctx = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'clear', session_id: sid })));
        expect(ctx).toContain('## Entry Sequence');
      } finally {
        cleanupGuard(sid, 'clear');
      }
    });
  });

  it('source: compact emits the core and not the Entry Sequence', () => {
    withScratch((scratch) => {
      const sid = `t-compact-${Date.now()}`;
      try {
        const ctx = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'compact', session_id: sid })));
        expect(ctx).toContain('Override order: user instruction > project context file > skill > default.');
        expect(ctx).toContain('|Situation|Skill|');
        expect(ctx).not.toContain('## Entry Sequence');
      } finally {
        cleanupGuard(sid, 'compact');
      }
    });
  });

  it('absent stdin emits the full body', () => {
    withScratch((scratch) => {
      const ctx = ctxOf(runHookStdin(scratch, undefined));
      expect(ctx).toContain('## Entry Sequence');
    });
  });

  it('unparseable stdin emits the full body', () => {
    withScratch((scratch) => {
      const ctx = ctxOf(runHookStdin(scratch, 'not-json{{{'));
      expect(ctx).toContain('## Entry Sequence');
    });
  });

  it('unrecognised source value emits the full body', () => {
    withScratch((scratch) => {
      const sid = `t-unrec-${Date.now()}`;
      // 'resume' is deliberately excluded from the SessionStart matcher, but
      // an unrecognised source reaching the hook must still fail open.
      const ctx = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'resume', session_id: sid })));
      expect(ctx).toContain('## Entry Sequence');
    });
  });

  it('<SUBAGENT-STOP> is absent from the emitted payload but present in SKILL.md', () => {
    withScratch((scratch) => {
      const sid = `t-stop-${Date.now()}`;
      try {
        const ctx = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'startup', session_id: sid })));
        expect(ctx).not.toContain('SUBAGENT-STOP');
      } finally {
        cleanupGuard(sid, 'startup');
      }
    });
    const skillSrc = fs.readFileSync(path.join(ROOT, 'skills', 'using-superpowers', 'SKILL.md'), 'utf8');
    expect(skillSrc).toContain('<SUBAGENT-STOP>');
  });
});

describe('session-start emission dedupe', () => {
  it('a second invocation with the same session_id and source inside the window emits {}', () => {
    withScratch((scratch) => {
      const sid = `t-dedupe-${Date.now()}`;
      try {
        runHookStdin(scratch, JSON.stringify({ source: 'startup', session_id: sid }));
        const second = JSON.parse(runHookStdin(scratch, JSON.stringify({ source: 'startup', session_id: sid })));
        expect(second).toEqual({});
      } finally {
        cleanupGuard(sid, 'startup');
      }
    });
  });

  it('a different source for the same session still emits', () => {
    withScratch((scratch) => {
      const sid = `t-diffsrc-${Date.now()}`;
      try {
        runHookStdin(scratch, JSON.stringify({ source: 'startup', session_id: sid }));
        const ctx = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'compact', session_id: sid })));
        expect(ctx).toContain('Override order: user instruction > project context file > skill > default.');
      } finally {
        cleanupGuard(sid, 'startup');
        cleanupGuard(sid, 'compact');
      }
    });
  });

  it('two consecutive compact invocations for the same session: the second is suppressed', () => {
    withScratch((scratch) => {
      const sid = `t-compact2x-${Date.now()}`;
      try {
        runHookStdin(scratch, JSON.stringify({ source: 'compact', session_id: sid }));
        const second = JSON.parse(runHookStdin(scratch, JSON.stringify({ source: 'compact', session_id: sid })));
        expect(second).toEqual({});
      } finally {
        cleanupGuard(sid, 'compact');
      }
    });
  });

  it('two consecutive clear invocations for the same session both emit the full body', () => {
    // A clear wipes the conversation: the second clear's injection is the
    // only one still standing, so it must never be suppressed by the first.
    withScratch((scratch) => {
      const sid = `t-clear2x-${Date.now()}`;
      try {
        const first = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'clear', session_id: sid })));
        const second = ctxOf(runHookStdin(scratch, JSON.stringify({ source: 'clear', session_id: sid })));
        expect(first).toContain('## Entry Sequence');
        expect(second).toContain('## Entry Sequence');
      } finally {
        cleanupGuard(sid, 'clear');
      }
    });
  });

  it('a clear invocation following a startup invocation emits the full body, not {}', () => {
    withScratch((scratch) => {
      const sid = `t-clearafter-${Date.now()}`;
      try {
        runHookStdin(scratch, JSON.stringify({ source: 'startup', session_id: sid }));
        const raw = runHookStdin(scratch, JSON.stringify({ source: 'clear', session_id: sid }));
        expect(JSON.parse(raw)).not.toEqual({});
        expect(ctxOf(raw)).toContain('## Entry Sequence');
      } finally {
        cleanupGuard(sid, 'startup');
        cleanupGuard(sid, 'clear');
      }
    });
  });

  it('the guard file path sits under spTmpDir()', () => {
    withScratch((scratch) => {
      const sid = `t-guardpath-${Date.now()}`;
      try {
        runHookStdin(scratch, JSON.stringify({ source: 'startup', session_id: sid }));
        const guard = guardPath(sid, 'startup');
        expect(guard.startsWith(spTmpDir())).toBe(true);
        expect(fs.existsSync(guard)).toBe(true);
      } finally {
        cleanupGuard(sid, 'startup');
      }
    });
  });
});
