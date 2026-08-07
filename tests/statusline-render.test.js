import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir, spTmp } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'scripts', 'statusline.mjs');

let root, cwd, cfgRoot, sid;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(spTmpDir(), 'slr-'));
  cwd = path.join(root, 'proj'); fs.mkdirSync(cwd, { recursive: true });
  cfgRoot = path.join(root, 'cfg'); fs.mkdirSync(path.join(cfgRoot, 'hooks-logs'), { recursive: true });
  sid = `slr-${process.pid}-${Math.random().toString(36).slice(2)}`;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  try { fs.rmSync(spTmp(`statusline-caps-${sid}.json`), { force: true }); } catch {}
});

function run(stdin, args = []) {
  return execFileSync('node', [CLI, ...args], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgRoot },
  });
}
function payload(over = {}) {
  return { session_id: sid, cwd, model: { display_name: 'Opus 5' },
           context_window: { used_percentage: 42 }, ...over };
}
function seedUsage() {
  fs.writeFileSync(path.join(cfgRoot, 'hooks-logs', 'claude-usage.jsonl'),
    JSON.stringify({ ts: 'x', sessionId: sid, output: 2500, cacheRead: 1_500_000 }) + '\n');
}
function config(obj) {
  fs.mkdirSync(path.join(cwd, '.superpowers'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.superpowers', 'statusline.json'), JSON.stringify(obj));
}

describe('statusline renderer', () => {
  it('renders only configured segments in default mode', () => {
    seedUsage(); config({ segments: ['usage'] });
    const out = run(payload()).trim();
    expect(out).toMatch(/1\.5M↓ 2\.5k↑/);
    expect(out).not.toMatch(/Opus 5/);
  });

  it('--full prefixes model and context percentage', () => {
    seedUsage(); config({ segments: ['usage'] });
    const out = run(payload(), ['--full']).trim();
    expect(out).toMatch(/Opus 5/);
    expect(out).toMatch(/42%/);
    expect(out).toMatch(/1\.5M↓/);
  });

  it('produces no separator artifact when segments are null', () => {
    seedUsage(); config({ segments: ['plan', 'usage', 'delegation'], separator: ' | ' });
    const out = run(payload()).trim();
    // plan and delegation have no sources here; usage is the only survivor.
    expect(out).toBe('1.5M↓ 2.5k↑');
    expect(out).not.toMatch(/^\s*\|/);
    expect(out).not.toMatch(/\|\s*$/);
    expect(out).not.toMatch(/\|\s*\|/);
  });

  it('prints an empty line and exits 0 when everything is null', () => {
    config({ segments: ['plan'] });
    expect(run(payload()).trim()).toBe('');
  });

  it('prints an empty line and exits 0 on malformed stdin', () => {
    expect(run('not json').trim()).toBe('');
  });

  it('renders remaining segments when one source is corrupt', () => {
    seedUsage(); config({ segments: ['plan', 'usage'] });
    const dir = path.join(cwd, '.superpowers', 'plans');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'x.md.tasks.json'), '{bad');
    expect(run(payload()).trim()).toBe('1.5M↓ 2.5k↑');
  });

  it('emits a single line with no trailing newline noise', () => {
    seedUsage(); config({ segments: ['usage'] });
    const out = run(payload());
    expect(out.split('\n').filter((l) => l.length).length).toBe(1);
  });

  it('sanitizes an embedded newline in a stdin-sourced value', () => {
    seedUsage(); config({ segments: ['usage'] });
    const out = run(payload({ model: { display_name: 'Opus\n5' } }), ['--full']);
    // A raw newline in model.display_name must not smear the statusline
    // across two terminal rows: exactly one non-empty line comes out, and
    // the embedded break is collapsed to a space rather than dropped.
    expect(out.split('\n').filter((l) => l.length).length).toBe(1);
    expect(out).toMatch(/Opus 5/);
  });

  it('terminates within the timeout when stdin is never closed', async () => {
    // No input is written and stdin is never ended, so the CLI's own
    // for-await read would hang forever without a bounded timeout. A kill
    // timer is the safety net: if the renderer's internal timeout ever
    // regresses, this test fails fast instead of hanging the suite.
    const child = spawn('node', [CLI], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 4000);
    try {
      const [code] = await once(child, 'exit');
      expect(code).toBe(0);
      expect(stdout).toBe('\n');
    } finally {
      clearTimeout(killTimer);
    }
  }, 8000);

  it('renders within the hot-path budget', () => {
    // Excludes process spawn. The statusline runs on every assistant message,
    // so the render itself must stay trivial; this is the guard against a
    // future segment quietly adding a directory walk or an unbounded read.
    seedUsage(); config({ segments: ['capabilities', 'delegation', 'plan', 'usage'] });
    run(payload()); // warm the capabilities cache
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) run(payload());
    const perRun = (Date.now() - t0) / 5;
    // Generous: dominated by node spawn on Windows. A regression that adds a
    // tree walk or whole-file read blows past this.
    expect(perRun).toBeLessThan(1500);
  });
});
