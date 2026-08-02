import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregate } from '../hooks/usage-aggregator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'usage-aggregator.js');

// The hook's byte-offset state lives at os.tmpdir()/sp-usage-<session_id> — outside
// each test's per-case `home`, by design (production resumes offsets across Stop
// events for the same real session). That means a stale offset left by a previous
// run of this suite (same literal session ids) would corrupt the next run's "first
// run sums everything" assumption. Clear known offset files before each case so
// every test starts from a true first run, regardless of prior invocations.
const SESSION_IDS = ['s1', 's2', 's3', 's4', 's5', 's6'];
function clearOffsets() {
  for (const id of SESSION_IDS) {
    fs.rmSync(path.join(os.tmpdir(), `sp-usage-${id}`), { force: true });
  }
}

let home;
beforeEach(() => { clearOffsets(); home = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-usage-home-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); clearOffsets(); });

const asst = (input, output, extra = {}) => JSON.stringify({
  message: { role: 'assistant', usage: { input_tokens: input, output_tokens: output, ...extra } },
}) + '\n';

function run(sessionId, transcriptPath) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath }),
    encoding: 'utf8', env,
  });
  expect(JSON.parse(out)).toEqual({});
}

const statsPath = () => path.join(home, '.claude', 'hooks-logs', 'session-stats.json');
const usageLog = () => path.join(home, '.claude', 'hooks-logs', 'claude-usage.jsonl');
const readStats = () => JSON.parse(fs.readFileSync(statsPath(), 'utf8'));

describe('usage-aggregator', () => {
  it('sums usage on the first run, then adds only the delta on the next', () => {
    const t = path.join(home, 't.jsonl');
    fs.writeFileSync(t, asst(100, 20, { cache_creation_input_tokens: 200 }) + asst(50, 10, { cache_read_input_tokens: 500 }));
    run('s1', t);
    expect(readStats().tokens).toEqual({ input: 150, output: 30, cacheRead: 500, cacheCreation: 200 });

    fs.appendFileSync(t, asst(5, 5));
    run('s1', t);
    expect(readStats().tokens).toEqual({ input: 155, output: 35, cacheRead: 500, cacheCreation: 200 });
    expect(fs.readFileSync(usageLog(), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('defers a partial trailing line until it is complete', () => {
    const t = path.join(home, 't.jsonl');
    fs.writeFileSync(t, asst(10, 1) + asst(999, 999).trimEnd()); // second line unterminated
    run('s2', t);
    expect(readStats().tokens.input).toBe(10);

    fs.appendFileSync(t, '\n');
    run('s2', t);
    expect(readStats().tokens.input).toBe(1009);
  });

  it('counts only assistant messages that carry usage', () => {
    const t = path.join(home, 't.jsonl');
    fs.writeFileSync(t, [
      JSON.stringify({ message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 7, output_tokens: 3 } } }),
      'not json at all',
      JSON.stringify({ message: { role: 'user', usage: { input_tokens: 999, output_tokens: 999 } } }),
    ].join('\n') + '\n');
    run('s3', t);
    expect(readStats().tokens).toEqual({ input: 7, output: 3, cacheRead: 0, cacheCreation: 0 });
  });

  it('writes no usage record when the transcript has no usage at all', () => {
    const t = path.join(home, 't.jsonl');
    fs.writeFileSync(t, JSON.stringify({ message: { role: 'user', content: 'hi' } }) + '\n');
    run('s4', t);
    expect(fs.existsSync(usageLog())).toBe(false);
  });

  it('re-scans from the start when the transcript shrinks (rotation/regeneration)', () => {
    const t = path.join(home, 't.jsonl');
    fs.writeFileSync(t, asst(100, 20) + asst(50, 10) + asst(25, 5));
    run('s6', t);
    expect(readStats().tokens).toEqual({ input: 175, output: 35, cacheRead: 0, cacheCreation: 0 });

    // Same path, rewritten shorter: compaction, rotation, or a resumed
    // session regenerating the transcript. The stored offset is now past
    // EOF; this must be treated as a rescan, not "nothing new".
    fs.writeFileSync(t, asst(7, 3));
    run('s6', t);
    expect(readStats().tokens).toEqual({ input: 182, output: 38, cacheRead: 0, cacheCreation: 0 });
  });

  it('fails open on malformed stdin and on a missing transcript', () => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CONFIG_DIR;
    expect(JSON.parse(execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8', env }))).toEqual({});
    run('s5', path.join(home, 'does-not-exist.jsonl'));
  });
});

describe('aggregate chunking', () => {
  // asst() already exists in this file; it returns one JSONL line.
  it('aggregates a transcript larger than maxChunk across successive calls', () => {
    const t = path.join(home, 'big.jsonl');
    let expected = 0;
    let body = '';
    for (let i = 0; i < 200; i++) { body += asst(10, 5); expected += 10; }
    fs.writeFileSync(t, body);
    const size = fs.statSync(t).size;
    const maxChunk = Math.ceil(size / 7); // force ~7 chunks

    let offset = 0, guard = 0, input = 0;
    while (offset < size && guard++ < 50) {
      const r = aggregate(t, offset, { maxChunk });
      expect(r.nextOffset).toBeGreaterThan(offset); // advance invariant
      offset = r.nextOffset;
      if (r.delta) input += r.delta.input;
    }
    expect(offset).toBe(size);
    expect(input).toBe(expected);
    expect(guard).toBeLessThan(50); // did not spin
  });

  it('does not stall on a single line longer than maxChunk', () => {
    const t = path.join(home, 'longline.jsonl');
    const huge = JSON.stringify({ message: { role: 'user', content: 'x'.repeat(5000) } }) + '\n';
    fs.writeFileSync(t, huge + asst(7, 3));
    const r = aggregate(t, 0, { maxChunk: 1024 });
    expect(r.nextOffset).toBeGreaterThan(0); // advanced despite no newline in chunk 1
  });

  it('caps first-sight backfill and reports truncation', () => {
    const t = path.join(home, 'backfill.jsonl');
    let body = '';
    for (let i = 0; i < 100; i++) body += asst(1, 1);
    fs.writeFileSync(t, body);
    const size = fs.statSync(t).size;
    const r = aggregate(t, 0, { backfillCap: Math.floor(size / 4), maxChunk: size });
    expect(r.truncatedBackfill).toBe(true);
    expect(r.nextOffset).toBeGreaterThan(Math.floor(size / 2)); // started near EOF, not 0
  });

  it('leaves an unterminated trailing line for the next run', () => {
    const t = path.join(home, 'partial.jsonl');
    fs.writeFileSync(t, asst(4, 2) + asst(9, 9).trimEnd());
    const r = aggregate(t, 0, { maxChunk: 1 << 20 });
    expect(r.delta.input).toBe(4); // second line not consumed
  });
});
