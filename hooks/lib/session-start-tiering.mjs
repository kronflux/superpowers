// hooks/lib/session-start-tiering.mjs — SessionStart tiering + dedupe guard,
// invoked as a Node subprocess from the bash `session-start` hook (which
// cannot import ESM directly). Reads the hook's stdin JSON, prints exactly
// one of "full", "core", or "suppress" to stdout, and performs the dedupe
// guard file write itself. Any internal fault prints "full" — session-start
// must never fail to emit a payload.
import fs from 'fs';
import { spTmp } from './sp-tmp.js';

const DEDUPE_WINDOW_MS = 60000;
const RECOGNISED_SOURCES = new Set(['startup', 'clear', 'compact']);

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function guardPathFor(sessionId, source) {
  return spTmp(`session-start-${sessionId}-${source}.guard`);
}

function main() {
  const payload = JSON.parse(readStdin());
  const source = payload?.source;
  const sessionId = payload?.session_id;

  if (!RECOGNISED_SOURCES.has(source) || typeof sessionId !== 'string' || sessionId === '') {
    process.stdout.write('full');
    return;
  }

  const tier = source === 'compact' ? 'core' : 'full';

  // A clear wipes the conversation: a second clear inside the window means
  // the first's injection is already gone, so suppressing the second would
  // leave the session with no payload at all. No guard is consulted or
  // written for this source — clear always emits.
  if (source === 'clear') {
    process.stdout.write(tier);
    return;
  }

  const guardPath = guardPathFor(sessionId, source);

  try {
    const stat = fs.statSync(guardPath);
    if (Date.now() - stat.mtimeMs < DEDUPE_WINDOW_MS) {
      process.stdout.write('suppress');
      return;
    }
  } catch { /* no guard yet, or unreadable: proceed to emit */ }

  try { fs.writeFileSync(guardPath, String(Date.now())); } catch { /* best-effort */ }
  process.stdout.write(tier);
}

try {
  main();
} catch {
  process.stdout.write('full');
}
