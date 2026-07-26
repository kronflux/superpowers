// hooks/lib/session-start-probe.mjs — conductor probe runner invoked as a
// Node subprocess from the bash `session-start` hook (which cannot import
// ESM directly). Prints the summary line to stdout only; best-effort.
import fs from 'fs';
import path from 'path';
import { probe, summaryLine } from './capability-registry.js';

try {
  const cwd = process.cwd();
  const caps = probe(cwd);
  const snapPath = path.join(cwd, 'context-snapshot.json');
  if (fs.existsSync(snapPath)) {
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    snap.capabilities = { ...caps, probedAt: new Date().toISOString() };
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2) + '\n');
  }
  process.stdout.write(summaryLine(caps));
} catch {
  // capability probe is best-effort; failures must never break session-start
}
