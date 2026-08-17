import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmp } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'session-end-cleanup.js');

let sid;
const KINDS = (id) => [
  `conductor-${id}`, `conductor-${id}-codegraph`,
  `stop-${id}.lock`, `ctx-${id}.json`, `compress-${id}.json`, `usage-${id}`,
];

beforeEach(() => {
  sid = `sec-${process.pid}-${Math.random().toString(36).slice(2)}`;
  for (const n of KINDS(sid)) fs.writeFileSync(spTmp(n), 'x');
});
afterEach(() => {
  for (const n of KINDS(sid)) { try { fs.rmSync(spTmp(n), { force: true }); } catch {} }
});

function run(payload) {
  return JSON.parse(execFileSync('node', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
  }) || '{}');
}

describe('session-end-cleanup', () => {
  it('removes this session ephemeral state', () => {
    run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(fs.existsSync(spTmp(`conductor-${sid}`))).toBe(false);
    expect(fs.existsSync(spTmp(`conductor-${sid}-codegraph`))).toBe(false);
    expect(fs.existsSync(spTmp(`stop-${sid}.lock`))).toBe(false);
    expect(fs.existsSync(spTmp(`ctx-${sid}.json`))).toBe(false);
    expect(fs.existsSync(spTmp(`compress-${sid}.json`))).toBe(false);
  });

  it('NEVER deletes the usage offset', () => {
    // claude-usage.jsonl is append-only. Losing the offset makes the next run
    // re-scan from zero and re-count usage already recorded.
    //
    // Also assert an ephemeral file WAS removed in this same run: proving only
    // that usage- survives doesn't distinguish this hook from a no-op — a
    // no-op passes that assertion trivially. Checking both proves the hook
    // ran (deleted ephemeral state) AND specifically spared usage-.
    run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(fs.existsSync(spTmp(`usage-${sid}`))).toBe(true);
    expect(fs.existsSync(spTmp(`ctx-${sid}.json`))).toBe(false);
  });

  it('does nothing on reason=resume', () => {
    run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'resume' });
    for (const n of KINDS(sid)) expect(fs.existsSync(spTmp(n))).toBe(true);
  });

  it('does nothing without a session_id', () => {
    run({ hook_event_name: 'SessionEnd', reason: 'clear' });
    for (const n of KINDS(sid)) expect(fs.existsSync(spTmp(n))).toBe(true);
  });

  it('fails open on malformed stdin', () => {
    const out = execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual({});
  });

  it('leaves another session untouched', () => {
    const other = `${sid}-other-session`;
    fs.writeFileSync(spTmp(`ctx-${other}.json`), 'x');
    try {
      run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'clear' });
      expect(fs.existsSync(spTmp(`ctx-${other}.json`))).toBe(true);
    } finally {
      fs.rmSync(spTmp(`ctx-${other}.json`), { force: true });
    }
  });

  it('removes the ask-allowlist marker for this session', () => {
    fs.writeFileSync(spTmp(`askallow-${sid}`), 'x');
    run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(fs.existsSync(spTmp(`askallow-${sid}`))).toBe(false);
  });

  it('removes the routing-notice marker for this session', () => {
    fs.writeFileSync(spTmp(`routing-notice-${sid}`), '1');
    run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(fs.existsSync(spTmp(`routing-notice-${sid}`))).toBe(false);
  });

  it('removes every rejection marker for this session, regardless of hook or rule', () => {
    const markerA = spTmp(`reject-${sid}-taskcreate-missing-fence`);
    const markerB = spTmp(`reject-${sid}-comment-gate-narration`);
    fs.writeFileSync(markerA, '1');
    fs.writeFileSync(markerB, '1');
    try {
      run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'clear' });
      expect(fs.existsSync(markerA)).toBe(false);
      expect(fs.existsSync(markerB)).toBe(false);
    } finally {
      fs.rmSync(markerA, { force: true });
      fs.rmSync(markerB, { force: true });
    }
  });

  it('leaves a rejection marker belonging to a different session untouched', () => {
    const other = `other-session-${sid}`;
    const otherMarker = spTmp(`reject-${other}-taskcreate-missing-fence`);
    fs.writeFileSync(otherMarker, '1');
    try {
      run({ session_id: sid, hook_event_name: 'SessionEnd', reason: 'clear' });
      expect(fs.existsSync(otherMarker)).toBe(true);
    } finally {
      fs.rmSync(otherMarker, { force: true });
    }
  });
});
