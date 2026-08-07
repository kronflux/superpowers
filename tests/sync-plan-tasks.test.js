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

  it('writes to the NEWEST snapshot when several plans exist', () => {
    const old = seed('2026-01-01-old', [{ id: '5', status: 'pending' }]);
    const cur = seed('2026-09-09-current', [{ id: '5', status: 'pending' }]);
    run({ tool_name: 'TaskUpdate', tool_input: { taskId: '5', status: 'completed' } });
    expect(read(cur).tasks[0].status).toBe('completed');
    expect(read(old).tasks[0].status).toBe('pending');
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
