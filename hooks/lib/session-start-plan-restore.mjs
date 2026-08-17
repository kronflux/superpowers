// hooks/lib/session-start-plan-restore.mjs — SessionStart plan-restore probe, invoked as a
// Node subprocess from the bash `session-start` hook (which cannot import ESM directly).
// Scans <cwd>/.superpowers/plans/*.tasks.json for a plan carrying a pending or in_progress
// task and prints one line naming the most recently modified such plan and its open task
// count. Prints nothing when the directory is absent or empty, no plan has open tasks, or a
// snapshot is unreadable or fails to parse — those files are skipped, not treated as fatal.
// Never recreates tasks; this is a pointer only. Best-effort: any internal fault falls
// through to no output, matching the caller's `|| true` fallback.
import fs from 'fs';
import path from 'path';

function planNameFor(data, fileName) {
  const planField = typeof data?.plan === 'string' ? data.plan : '';
  const base = path.basename(planField || fileName);
  return base.replace(/\.md\.tasks\.json$/, '').replace(/\.tasks\.json$/, '').replace(/\.md$/, '');
}

function openTaskCount(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) return -1;
  return data.tasks.filter((t) => t && (t.status === 'pending' || t.status === 'in_progress')).length;
}

try {
  const plansDir = path.join(process.cwd(), '.superpowers', 'plans');
  const entries = fs.readdirSync(plansDir).filter((f) => f.endsWith('.tasks.json'));

  let mostRecent = null;
  for (const fileName of entries) {
    const fullPath = path.join(plansDir, fileName);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch {
      continue; // unreadable or unparseable: skip this snapshot, not fatal
    }
    const count = openTaskCount(data);
    if (count <= 0) continue;
    const mtimeMs = fs.statSync(fullPath).mtimeMs;
    if (!mostRecent || mtimeMs > mostRecent.mtimeMs) {
      mostRecent = { name: planNameFor(data, fileName), count, mtimeMs };
    }
  }

  if (mostRecent) {
    process.stdout.write(`[plan] ${mostRecent.name}: ${mostRecent.count} open`);
  }
} catch {
  // Absent .superpowers/plans/, permission errors, etc. — no line, no fault.
}
