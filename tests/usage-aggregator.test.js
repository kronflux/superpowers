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
const SESSION_IDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
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

describe('health record', () => {
  const healthPath = () => path.join(home, '.claude', 'hooks-logs', 'usage-aggregator-health.json');

  it('records a successful run with no error', () => {
    const t = path.join(home, 'h.jsonl');
    fs.writeFileSync(t, asst(3, 3));
    run('s1', t);
    const h = JSON.parse(fs.readFileSync(healthPath(), 'utf8'));
    expect(h.lastError).toBeNull();
    expect(h.transcriptSize).toBe(fs.statSync(t).size);
    expect(h.offset).toBe(h.transcriptSize);
    expect(h.sessionId).toBe('s1');
  });

  it('records the error when aggregation throws (invalid read position)', () => {
    // Seed the offset-state file with a negative offset to cause fs.readSync to throw EINVAL.
    // readState() accepts negative offsets (Number.isFinite(-5) is true), both early guards
    // fall through, and fs.readSync(fd, buf, 0, want, -5) throws — genuine aggregate() error.
    const sessionId = 's-throw-test';
    const statePath = path.join(os.tmpdir(), `sp-usage-${sessionId}`);
    fs.writeFileSync(statePath, JSON.stringify({ offset: -5, pending: {} }));

    try {
      const t = path.join(home, 'test.jsonl');
      fs.writeFileSync(t, asst(10, 5));

      const env = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.CLAUDE_CONFIG_DIR;
      const out = execFileSync('node', [HOOK], {
        input: JSON.stringify({ session_id: sessionId, transcript_path: t }),
        encoding: 'utf8', env,
      });
      expect(JSON.parse(out)).toEqual({});

      const h = JSON.parse(fs.readFileSync(healthPath(), 'utf8'));
      expect(h.lastError).not.toBeNull();
      expect(String(h.lastError.message).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(statePath, { force: true });
    }
  });

  it('records a health file when transcript is missing, and a later success does not carry the note forward', () => {
    // Run with a transcript path that does not exist; health should record no error but note absence.
    const missingPath = path.join(home, 'does-not-exist.jsonl');
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CONFIG_DIR;
    const out = execFileSync('node', [HOOK], {
      input: JSON.stringify({ session_id: 's-missing', transcript_path: missingPath }),
      encoding: 'utf8', env,
    });
    expect(JSON.parse(out)).toEqual({});

    let h = JSON.parse(fs.readFileSync(healthPath(), 'utf8'));
    expect(h.lastError).toBeNull();
    expect(h.note).toBe('no transcript_path');
    expect(h.sessionId).toBe('s-missing');
    expect(h.offset).toBeNull();
    expect(h.transcriptSize).toBeNull();

    // A later, fully successful run (same session) must write a complete record,
    // not merge over the earlier note: writeHealth no longer reads the previous file.
    const t = path.join(home, 'ok.jsonl');
    fs.writeFileSync(t, asst(3, 3));
    run('s-missing', t);
    h = JSON.parse(fs.readFileSync(healthPath(), 'utf8'));
    expect(h.note).toBeNull();
    expect(h.lastError).toBeNull();
    expect(h.offset).toBe(fs.statSync(t).size);
    expect(h.transcriptSize).toBe(fs.statSync(t).size);
    expect(h.sessionId).toBe('s-missing');
  });

  it('records the error when a hook error occurs (malformed stdin), and a later success clears it with no stale fields', () => {
    // Trigger an error by passing malformed stdin (JSON parsing fails, so no session id is known).
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CONFIG_DIR;
    const out = execFileSync('node', [HOOK], {
      input: 'not json at all',
      encoding: 'utf8', env,
    });
    expect(JSON.parse(out)).toEqual({});

    let h = JSON.parse(fs.readFileSync(healthPath(), 'utf8'));
    expect(h.lastError).not.toBeNull();
    expect(String(h.lastError.message).length).toBeGreaterThan(0);
    expect(h.sessionId).toBeNull();
    expect(h.offset).toBeNull();
    expect(h.transcriptSize).toBeNull();

    // A later, unrelated successful run must not report next to the stale error,
    // offset, or transcriptSize from the failed run: the record is global (one file)
    // but every write is a complete record, so nothing survives across runs.
    const t = path.join(home, 'after-error.jsonl');
    fs.writeFileSync(t, asst(4, 4));
    run('s1', t);
    h = JSON.parse(fs.readFileSync(healthPath(), 'utf8'));
    expect(h.lastError).toBeNull();
    expect(h.offset).toBe(fs.statSync(t).size);
    expect(h.transcriptSize).toBe(fs.statSync(t).size);
    expect(h.sessionId).toBe('s1');
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

  it('clamps the post-backfill read to maxChunk', () => {
    const t = path.join(home, 'backfill-chunk.jsonl');
    let body = '';
    for (let i = 0; i < 100; i++) body += asst(1, 1);
    fs.writeFileSync(t, body);
    const size = fs.statSync(t).size;
    const backfillCap = Math.floor(size / 4);
    const maxChunk = Math.floor(backfillCap / 3); // smaller than what backfill alone would leave

    // Mirror aggregate()'s own line-boundary alignment: the actual backfill
    // start is the first line start at or after size - backfillCap, not that
    // raw arithmetic offset (which may land mid-line).
    const rawStart = size - backfillCap;
    const nl = body.indexOf('\n', rawStart);
    const backfillStart = nl === -1 ? rawStart : nl + 1;

    const r = aggregate(t, 0, { backfillCap, maxChunk });
    expect(r.truncatedBackfill).toBe(true);
    expect(r.nextOffset).toBeLessThan(size); // maxChunk actually capped the read, not just backfill
    expect(r.nextOffset - backfillStart).toBeLessThanOrEqual(maxChunk);
  });
});

describe('conductor attribution', () => {
  const sessionId = 's7';
  const use = (id, name, input = {}) => JSON.stringify({
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  }) + '\n';
  const res = (id, content) => JSON.stringify({
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  }) + '\n';

  it('rolls MCP tools up per capability with call counts and bytes', () => {
    const t = path.join(home, 'cap.jsonl');
    fs.writeFileSync(t,
      use('a1', 'mcp__plugin_serena_serena__find_symbol') + res('a1', 'x'.repeat(100)) +
      use('a2', 'codegraph_explore') + res('a2', 'y'.repeat(50)) +
      use('a3', 'Read') + res('a3', 'z'.repeat(999)));
    const r = aggregate(t, 0, { maxChunk: 1 << 20 });
    expect(r.conductor.serena.calls).toBe(1);
    expect(r.conductor.serena.bytes).toBeGreaterThan(90);
    expect(r.conductor.codegraph.calls).toBe(1);
    expect(r.conductor.Read).toBeUndefined();
  });

  it('counts middleware-exec Bash calls as the middleware capability', () => {
    const t = path.join(home, 'mw.jsonl');
    fs.writeFileSync(t,
      use('b1', 'Bash', { command: 'node scripts/middleware-exec.mjs --task summarize-test-failure' }) +
      res('b1', 'digest'));
    const r = aggregate(t, 0, { maxChunk: 1 << 20 });
    expect(r.conductor.middleware.calls).toBe(1);
  });

  it('attributes a tool_result that lands in a later chunk', () => {
    const t = path.join(home, 'split.jsonl');
    const a = use('c1', 'codegraph_explore');
    const b = res('c1', 'w'.repeat(40));
    fs.writeFileSync(t, a + b);
    const first = aggregate(t, 0, { maxChunk: a.length }); // chunk 1: the tool_use only
    expect(first.pending.c1).toBe('codegraph');
    const second = aggregate(t, first.nextOffset, { maxChunk: 1 << 20, pending: first.pending });
    expect(second.conductor.codegraph.bytes).toBeGreaterThan(35);
  });

  it('reads a legacy bare-integer offset file', () => {
    const t = path.join(home, 'legacy.jsonl');
    fs.writeFileSync(t, asst(5, 5));
    fs.writeFileSync(path.join(os.tmpdir(), `sp-usage-${sessionId}`), '0');
    run(sessionId, t);
    expect(readStats().tokens.input).toBe(5);
  });

  it('recognizes the context7 capability', () => {
    const t = path.join(home, 'ctx7.jsonl');
    fs.writeFileSync(t,
      use('d1', 'mcp__plugin_context7_context7__query-docs') + res('d1', 'docs'.repeat(10)));
    const r = aggregate(t, 0, { maxChunk: 1 << 20 });
    expect(r.conductor.context7.calls).toBe(1);
    expect(r.conductor.context7.bytes).toBeGreaterThan(0);
  });

  it('recognizes the obsidian capability', () => {
    const t = path.join(home, 'obsidian.jsonl');
    fs.writeFileSync(t,
      use('e1', 'mcp__plugin_obsidian_obsidian__list_notes') + res('e1', 'notes'.repeat(10)));
    const r = aggregate(t, 0, { maxChunk: 1 << 20 });
    expect(r.conductor.obsidian.calls).toBe(1);
    expect(r.conductor.obsidian.bytes).toBeGreaterThan(0);
  });

  it('recognizes the basic-memory alternate for the obsidian capability', () => {
    const t = path.join(home, 'basic-memory.jsonl');
    fs.writeFileSync(t,
      use('f1', 'mcp__plugin_basic_memory_basic-memory__write_note') + res('f1', 'note') +
      use('f2', 'mcp__plugin_basic-memory_basic-memory__read_note') + res('f2', 'note'));
    const r = aggregate(t, 0, { maxChunk: 1 << 20 });
    expect(r.conductor.obsidian.calls).toBe(2);
  });

  it('caps the pending map at opts.maxPending, evicting the oldest unmatched calls', () => {
    const t = path.join(home, 'pending-cap.jsonl');
    let body = '';
    for (let i = 0; i < 10; i++) body += use(`p${i}`, 'codegraph_explore'); // no matching tool_result
    fs.writeFileSync(t, body);
    const r = aggregate(t, 0, { maxChunk: 1 << 20, maxPending: 3 });
    expect(Object.keys(r.pending)).toHaveLength(3);
    // Oldest entries evicted first; the most recent calls survive.
    expect(r.pending.p9).toBe('codegraph');
    expect(r.pending.p7).toBe('codegraph');
    expect(r.pending.p0).toBeUndefined();
  });
});
