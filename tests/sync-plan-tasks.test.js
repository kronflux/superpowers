import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'sync-plan-tasks.js');

let cwd;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(spTmpDir(), 'syncplan-')); });
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

function seed(name, tasks) {
  const dir = path.join(cwd, '.superpowers', 'plans');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.md.tasks.json`);
  fs.writeFileSync(p, JSON.stringify({ plan: name, tasks }, null, 2) + '\n');
  return p;
}
function read(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function run(payload) {
  return execFileSync('node', [HOOK], {
    input: JSON.stringify({ cwd, ...payload }), encoding: 'utf8',
  });
}

describe('sync-plan-tasks', () => {
  it('marks the matching task completed in the newest snapshot', () => {
    const p = seed('2026-01-01-plan', [
      { id: '75', status: 'pending' }, { id: '76', status: 'pending' },
    ]);
    run({ tool_name: 'TaskUpdate', tool_input: { taskId: '76', status: 'completed' } });
    const after = read(p);
    expect(after.tasks.find((t) => t.id === '76').status).toBe('completed');
    expect(after.tasks.find((t) => t.id === '75').status).toBe('pending');
    expect(after.lastUpdated).toBeTruthy();
  });

  it('tracks in_progress too, so a resumed plan sees real state', () => {
    const p = seed('2026-01-01-plan', [{ id: '9', status: 'pending' }]);
    run({ tool_name: 'TaskUpdate', tool_input: { taskId: '9', status: 'in_progress' } });
    expect(read(p).tasks[0].status).toBe('in_progress');
  });

  it('updates the snapshot that actually contains the task id, regardless of filename order', () => {
    // The id lives only in the oldest (alphabetically-first) snapshot. A newer
    // snapshot exists too, but selection must be by task identity, not by
    // filename order — an older plan can be resumed while a newer snapshot
    // sits on disk unrelated to it.
    const oldest = seed('2026-01-01-oldest', [{ id: '5', status: 'pending' }]);
    const middleBefore = fs.readFileSync(
      seed('2026-05-05-middle', [{ id: '6', status: 'pending' }]), 'utf8',
    );
    const middle = path.join(cwd, '.superpowers', 'plans', '2026-05-05-middle.md.tasks.json');
    const newestBefore = fs.readFileSync(
      seed('2026-09-09-newest', [{ id: '7', status: 'pending' }]), 'utf8',
    );
    const newest = path.join(cwd, '.superpowers', 'plans', '2026-09-09-newest.md.tasks.json');

    run({ tool_name: 'TaskUpdate', tool_input: { taskId: '5', status: 'completed' } });

    expect(read(oldest).tasks[0].status).toBe('completed');
    expect(fs.readFileSync(middle, 'utf8')).toBe(middleBefore);
    expect(fs.readFileSync(newest, 'utf8')).toBe(newestBefore);
  });

  it('is a byte-identical no-op across all snapshots when the id is in none of them', () => {
    const a = seed('2026-01-01-a', [{ id: '1', status: 'pending' }]);
    const b = seed('2026-02-02-b', [{ id: '2', status: 'pending' }]);
    const aBefore = fs.readFileSync(a, 'utf8');
    const bBefore = fs.readFileSync(b, 'utf8');

    const out = run({ tool_name: 'TaskUpdate', tool_input: { taskId: '999', status: 'completed' } });

    expect(JSON.parse(out)).toEqual({});
    expect(fs.readFileSync(a, 'utf8')).toBe(aBefore);
    expect(fs.readFileSync(b, 'utf8')).toBe(bBefore);
  });

  it('leaves every snapshot untouched when the id is ambiguous across multiple plans', () => {
    // Present in two snapshots at once: refuse to guess. A wrong write is the
    // exact failure this hook exists to prevent, so no file is written.
    const a = seed('2026-01-01-a', [{ id: '42', status: 'pending' }]);
    const b = seed('2026-02-02-b', [{ id: '42', status: 'pending' }]);
    const aBefore = fs.readFileSync(a, 'utf8');
    const bBefore = fs.readFileSync(b, 'utf8');

    const out = run({ tool_name: 'TaskUpdate', tool_input: { taskId: '42', status: 'completed' } });

    expect(JSON.parse(out)).toEqual({});
    expect(fs.readFileSync(a, 'utf8')).toBe(aBefore);
    expect(fs.readFileSync(b, 'utf8')).toBe(bBefore);
  });

  it('leaves the file untouched for an id the plan does not contain', () => {
    // Sessions run native tasks unrelated to any plan; those must not rewrite it.
    const p = seed('2026-01-01-plan', [{ id: '75', status: 'pending' }]);
    const before = fs.readFileSync(p, 'utf8');
    run({ tool_name: 'TaskUpdate', tool_input: { taskId: '999', status: 'completed' } });
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('ignores a deleted status rather than shrinking the denominator', () => {
    const p = seed('2026-01-01-plan', [{ id: '1', status: 'pending' }]);
    const before = fs.readFileSync(p, 'utf8');
    run({ tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'deleted' } });
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('no-ops with no plans directory, and still returns {}', () => {
    expect(JSON.parse(run({ tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' } })))
      .toEqual({});
  });

  it('fails open on a corrupt snapshot instead of blocking the TaskUpdate', () => {
    const dir = path.join(cwd, '.superpowers', 'plans');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'x.md.tasks.json');
    fs.writeFileSync(p, '{bad');
    let out;
    expect(() => {
      out = run({ tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' } });
    }).not.toThrow();
    expect(JSON.parse(out)).toEqual({});
    expect(fs.readFileSync(p, 'utf8')).toBe('{bad');
  });

  it('fails open on malformed stdin', () => {
    const out = execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual({});
  });
});
