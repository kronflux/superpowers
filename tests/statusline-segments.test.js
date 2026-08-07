import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir, spTmp } from '../hooks/lib/sp-tmp.js';
import { segCapabilities, segDelegation, segPlan, segUsage } from '../hooks/lib/statusline-segments.js';

let root, cwd, logDir, sid;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(spTmpDir(), 'slseg-'));
  cwd = path.join(root, 'proj'); fs.mkdirSync(cwd, { recursive: true });
  logDir = path.join(root, 'hooks-logs'); fs.mkdirSync(logDir, { recursive: true });
  sid = `slseg-${process.pid}-${Math.random().toString(36).slice(2)}`;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.rmSync(spTmp(`statusline-caps-${sid}.json`), { force: true }); } catch {}
});

// A sandboxed env so the probe cannot see the developer's real plugins.
// capability-registry reads the config root, not cwd, so without this the
// "nothing present" assertion passes or fails depending on the machine.
// HOME/USERPROFILE are sandboxed too: capability-registry's probe() resolves
// `home = opts.home || os.homedir()` independent of CLAUDE_CONFIG_DIR, and
// mcpConfigured() checks a global ~/.claude.json under that home. Without
// this, a developer machine with a real ~/.claude.json (e.g. an MCP server
// entry for codegraph) leaks into the "nothing present" assertion below.
const sandboxEnv = () => ({
  PATH: '', CLAUDE_CONFIG_DIR: path.join(root, 'emptycfg'),
  HOME: path.join(root, 'emptyhome'), USERPROFILE: path.join(root, 'emptyhome'),
});

const ctx = (over = {}) => ({
  stdin: { session_id: sid },
  cwd, logDir, now: Date.now(), env: sandboxEnv(), ...over,
});

function writeDispatch(lines) {
  fs.writeFileSync(path.join(logDir, 'routing-dispatch.log'), lines.join('\n') + '\n');
}
function writeUsage(records) {
  fs.writeFileSync(path.join(logDir, 'claude-usage.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
function writeTasks(name, tasks) {
  const dir = path.join(cwd, '.superpowers', 'plans');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md.tasks.json`), JSON.stringify({ tasks }));
}

describe('segDelegation', () => {
  it('reports the most recent dispatch for this session', () => {
    writeDispatch([
      `2026-08-07T01:00:00.000Z ALLOW session=${sid} model=haiku allowed=- tasks=-`,
      `2026-08-07T02:00:00.000Z ALLOW session=${sid} model=sonnet allowed=- tasks=-`,
    ]);
    expect(segDelegation(ctx())).toMatch(/sonnet/);
  });

  it('returns null when every record belongs to another session', () => {
    writeDispatch([`2026-08-07T02:00:00.000Z ALLOW session=other model=sonnet allowed=- tasks=-`]);
    expect(segDelegation(ctx())).toBeNull();
  });

  it('ignores legacy records with no session field', () => {
    // Pre-7.10 records carry no session=; attributing them to the current
    // session is exactly the misleading behaviour the stamping exists to stop.
    writeDispatch([`2026-08-07T02:00:00.000Z ALLOW model=sonnet allowed=- tasks=-`]);
    expect(segDelegation(ctx())).toBeNull();
  });

  it('returns null when the log is absent', () => {
    expect(segDelegation(ctx())).toBeNull();
  });
});

describe('segPlan', () => {
  it('reports done/total from the newest tasks file', () => {
    writeTasks('2026-01-01-old', [{ status: 'completed' }, { status: 'pending' }]);
    writeTasks('2026-02-02-new', [
      { status: 'completed' }, { status: 'completed' }, { status: 'pending' },
    ]);
    expect(segPlan(ctx())).toBe('plan 2/3');
  });

  it('returns null when no tasks file exists', () => {
    expect(segPlan(ctx())).toBeNull();
  });

  it('returns null on malformed json', () => {
    const dir = path.join(cwd, '.superpowers', 'plans');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'x.md.tasks.json'), '{bad');
    expect(segPlan(ctx())).toBeNull();
  });
});

describe('segUsage', () => {
  it('sums this session records only', () => {
    writeUsage([
      { ts: '2026-08-07T01:00:00Z', sessionId: sid, input: 1, output: 2000, cacheRead: 1_000_000, cacheCreation: 0 },
      { ts: '2026-08-07T01:01:00Z', sessionId: 'other', input: 9, output: 999999, cacheRead: 5_000_000, cacheCreation: 0 },
      { ts: '2026-08-07T01:02:00Z', sessionId: sid, input: 1, output: 500, cacheRead: 500_000, cacheCreation: 0 },
    ]);
    const out = segUsage(ctx());
    expect(out).toMatch(/1\.5M/);   // cacheRead 1.5M
    expect(out).toMatch(/2\.5k/);   // output 2500
    expect(out).not.toMatch(/999/);
  });

  it('returns null when no record matches this session', () => {
    writeUsage([{ ts: '2026-08-07T01:00:00Z', sessionId: 'other', output: 5, cacheRead: 5 }]);
    expect(segUsage(ctx())).toBeNull();
  });

  it('returns null when the log is absent', () => {
    expect(segUsage(ctx())).toBeNull();
  });
});

describe('segCapabilities', () => {
  it('returns null when nothing is present and caches the result', () => {
    const c = ctx({ probeCwd: cwd });
    expect(segCapabilities(c)).toBeNull();
    expect(fs.existsSync(spTmp(`statusline-caps-${sid}.json`))).toBe(true);
    // Second call must hit the cache. Prove it by making a fresh probe
    // impossible to distinguish otherwise: the cached value is what returns.
    expect(segCapabilities(c)).toBeNull();
  });

  it('renders short codes from a cached probe result', () => {
    // Seed the cache directly: probing for real would depend on the machine.
    fs.writeFileSync(spTmp(`statusline-caps-${sid}.json`),
      JSON.stringify({ present: ['codegraph', 'context7', 'lsp'] }));
    expect(segCapabilities(ctx())).toBe('cg·c7·lsp');
  });
});
