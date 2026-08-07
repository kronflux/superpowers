#!/usr/bin/env node
/**
 * PostToolUse (TaskUpdate) — keep the plan's .tasks.json snapshot in sync.
 *
 * `skills/writing-plans` writes `<plan>.md.tasks.json` once, with every task
 * `"pending"`. `skills/subagent-driven-development/references/controller-operations.md`
 * documents a "Task Persistence Sync" step telling the controller to update it
 * after each TaskUpdate — and that step has never been performed: 9 of the 11
 * snapshots in this repo still read 0/N, including plans that were fully
 * executed and merged weeks ago.
 *
 * Prose asking a controller to remember something on every tool call is not a
 * mechanism. This hook is, so the instruction is now automated rather than
 * repeated. Two things depended on it:
 *   - cross-session resume, which reads the snapshot to find remaining work and
 *     would otherwise re-dispatch tasks that are already done;
 *   - the statusline's plan segment, which rendered a permanent `plan 0/N`.
 *
 * Fail-open like every hook: any fault writes {} and exits 0. Never blocks a
 * TaskUpdate — a bookkeeping miss must not cost the user their task edit.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** Newest plan snapshot under cwd, or null. Sorted by name: plans are date-prefixed. */
function newestSnapshot(cwd) {
  const dir = path.join(cwd, '.superpowers', 'plans');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md.tasks.json')).sort();
  } catch {
    return null;
  }
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

/**
 * Apply a status change to the matching task id.
 * Returns true only when a task actually matched and its status changed —
 * callers use that to avoid rewriting a file they did not alter.
 */
function applyStatus(snapshot, taskId, status) {
  const raw = fs.readFileSync(snapshot, 'utf8');
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.tasks)) return false;
  const task = data.tasks.find((t) => t && String(t.id) === String(taskId));
  // A TaskUpdate for an id this plan does not contain is normal — the session
  // may be running native tasks unrelated to any plan. Leave the file alone.
  if (!task || task.status === status) return false;
  task.status = status;
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(snapshot, JSON.stringify(data, null, 2) + '\n');
  return true;
}

async function main() {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const data = JSON.parse(input);
    const status = data?.tool_input?.status;
    const taskId = data?.tool_input?.taskId;
    // Only statuses the snapshot models. `deleted` is deliberately excluded:
    // removing an entry would change the denominator and make a resumed plan
    // look shorter than it is.
    if (taskId && ['pending', 'in_progress', 'completed'].includes(status)) {
      const snapshot = newestSnapshot(data?.cwd || process.cwd());
      if (snapshot) applyStatus(snapshot, taskId, status);
    }
  } catch { /* bookkeeping is best-effort; never block a TaskUpdate */ }
  process.stdout.write('{}');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(() => { process.stdout.write('{}'); });

export { newestSnapshot, applyStatus };
