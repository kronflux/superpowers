#!/usr/bin/env node
/**
 * SessionEnd — remove this session's ephemeral tmp state.
 *
 * Deliberately narrow. Two things it must NOT do:
 *
 *   1. Delete `usage-<sid>`. That file is the byte offset into the transcript,
 *      and hooks-logs/claude-usage.jsonl is append-only and unrotated. Dropping
 *      the offset makes the next run re-scan from zero and re-count usage that
 *      was already recorded — a corrupted report, not merely wasted work. It
 *      ages out through the sweep instead, by which point the session is dead.
 *
 *   2. Run at all when reason === 'resume'. That reason fires when a session is
 *      switched away, which is exactly when it is most likely to come back.
 *
 * Fail-open like every other hook: any fault writes {} and exits 0.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spTmp, spTmpDir } from './lib/sp-tmp.js';

// Ephemeral kinds only. `usage-` is conspicuously absent, and must stay so.
const EPHEMERAL = [
  (id) => `stop-${id}.lock`,
  (id) => `ctx-${id}.json`,
  (id) => `compress-${id}.json`,
];

function removeForSession(sessionId) {
  for (const name of EPHEMERAL) {
    try { fs.rmSync(spTmp(name(sessionId)), { force: true }); } catch {}
  }
  // conductor state is one base file plus one claim file per nudge class, and
  // the class list can grow — match by prefix rather than enumerating classes.
  try {
    const base = `conductor-${sessionId}`;
    for (const entry of fs.readdirSync(spTmpDir())) {
      if (entry === base || entry.startsWith(`${base}-`)) {
        try { fs.rmSync(path.join(spTmpDir(), entry), { force: true }); } catch {}
      }
    }
  } catch {}
}

async function main() {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const { session_id, reason } = JSON.parse(input);
    if (session_id && reason !== 'resume') removeForSession(String(session_id));
  } catch {}
  process.stdout.write('{}');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(() => { process.stdout.write('{}'); });

export { removeForSession, EPHEMERAL };
