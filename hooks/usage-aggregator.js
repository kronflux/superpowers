#!/usr/bin/env node
/**
 * Stop Hook — Claude-Session Usage Aggregator
 *
 * Tails the session transcript from the last processed byte offset, sums the
 * assistant-message `usage` fields, folds cumulative totals into
 * session-stats.json (tokens key), and appends a per-turn delta record to
 * hooks-logs/claude-usage.jsonl. Transcript-derived ESTIMATE: it reflects what
 * the harness recorded, not billing. Fail-open: any error -> {} and exit 0.
 * Offset state: os.tmpdir()/sp-usage-<session_id>.
 *
 * Reads are chunked: a single invocation never materializes more than
 * MAX_CHUNK bytes as a string, so a huge transcript cannot stall the hook.
 * First sight of a transcript larger than BACKFILL_CAP starts near EOF
 * instead of counting the whole history.
 *
 * The same pass also attributes conductor tool usage (codegraph, serena,
 * context7, obsidian/basic-memory, middleware) per capability as call counts
 * and tool_result byte sizes. `bytes` measures context consumed by tool
 * results — it is NOT tokens billed, and is never presented as such.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { configDir } from './lib/config-dir.js';
import { loadStats, saveStats } from './track-session-stats.js';

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');
const HEALTH_FILE = () => path.join(LOG_DIR, 'usage-aggregator-health.json');

// Single overwritten file, never appended: a hook that dies every turn must
// leave exactly one current record, not an unbounded error log.
function writeHealth(fields) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(HEALTH_FILE(), 'utf8')); } catch {}
    fs.writeFileSync(HEALTH_FILE(), JSON.stringify({ ...prev, ...fields }, null, 2));
  } catch { /* health reporting is best-effort */ }
}

// Bounded work per invocation. buf.toString() over the whole unread region is
// what killed this hook in the field: V8 refuses strings past ~512 MB, the
// throw landed before writeOffset, and every later Stop retried from 0 forever.
const MAX_CHUNK = 32 * 1024 * 1024;
const BACKFILL_CAP = 64 * 1024 * 1024;

// Conductor capabilities, matched against the tool_use name. Middleware is not
// an MCP tool - it is a Bash call to scripts/middleware-exec.mjs.
const CAPABILITY_PATTERNS = [
  ['codegraph', /codegraph/i],
  ['serena',    /serena/i],
  ['context7',  /context7/i],
  ['obsidian',  /obsidian|basic.?memory/i],
];
const MAX_PENDING = 500;

function capabilityOf(name, input) {
  if (typeof name !== 'string') return null;
  for (const [cap, re] of CAPABILITY_PATTERNS) if (re.test(name)) return cap;
  if (name === 'Bash' && typeof input?.command === 'string'
      && input.command.includes('middleware-exec')) return 'middleware';
  return null;
}

function bump(conductor, cap, field, n) {
  if (!conductor[cap]) conductor[cap] = { calls: 0, bytes: 0 };
  conductor[cap][field] += n;
}

function statePath(sessionId) {
  return path.join(os.tmpdir(), `sp-usage-${sessionId}`);
}

function readState(sessionId) {
  const empty = { offset: 0, pending: {}, truncatedBackfill: false };
  try {
    const raw = fs.readFileSync(statePath(sessionId), 'utf8');
    try {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object' && Number.isFinite(s.offset)) {
        return { offset: s.offset, pending: s.pending || {}, truncatedBackfill: !!s.truncatedBackfill };
      }
    } catch { /* fall through to the legacy bare-integer format */ }
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return { ...empty, offset: n };
  } catch {}
  return empty;
}

function writeState(sessionId, state) {
  try { fs.writeFileSync(statePath(sessionId), JSON.stringify(state)); } catch {}
}

/** Offset of the first line start at or after `from` (or `from` if none found). */
function lineStartAtOrAfter(fd, from, size) {
  const len = Math.min(64 * 1024, size - from);
  if (len <= 0) return from;
  const probe = Buffer.alloc(len);
  fs.readSync(fd, probe, 0, len, from);
  const nl = probe.indexOf(0x0a);
  return nl === -1 ? from : from + nl + 1;
}

export function aggregate(transcriptPath, offset, opts = {}) {
  const maxChunk = opts.maxChunk ?? MAX_CHUNK;
  const backfillCap = opts.backfillCap ?? BACKFILL_CAP;
  const maxPending = opts.maxPending ?? MAX_PENDING;
  const size = fs.statSync(transcriptPath).size;
  if (offset > size) offset = 0; // file shrank: rotated or regenerated, re-scan
  if (offset >= size) {
    return {
      delta: null, nextOffset: offset, truncatedBackfill: false,
      conductor: {}, pending: { ...(opts.pending || {}) },
    };
  }

  let truncatedBackfill = false;
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    // First sight of an already-huge transcript: counting all of it would cost
    // many slow turns, so start near EOF and say so rather than pretend.
    if (offset === 0 && size > backfillCap) {
      offset = lineStartAtOrAfter(fd, size - backfillCap, size);
      truncatedBackfill = true;
    }

    const want = Math.min(size - offset, maxChunk);
    const buf = Buffer.alloc(want);
    fs.readSync(fd, buf, 0, want, offset);

    // `end` is relative to buf (which starts at `offset`).
    let end = want;
    // Only consume complete lines: an unterminated tail is re-read next run.
    if (buf[end - 1] !== 0x0a) {
      end = buf.lastIndexOf(0x0a, end - 1) + 1;
      if (end <= 0) {
        // A full chunk with no newline means one line exceeds maxChunk. Advance
        // past it: the next chunk starts mid-line and its leading fragment
        // fails JSON.parse harmlessly. Stalling here is the original bug.
        // A short chunk is just an incomplete tail — wait for more bytes.
        return want === maxChunk
          ? {
              delta: null, nextOffset: offset + want, truncatedBackfill,
              conductor: {}, pending: { ...(opts.pending || {}) },
            }
          : {
              delta: null, nextOffset: offset, truncatedBackfill,
              conductor: {}, pending: { ...(opts.pending || {}) },
            };
      }
    }

    const delta = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    let saw = false;
    const conductor = {};
    const pending = { ...(opts.pending || {}) };
    for (const line of buf.toString('utf8', 0, end).split('\n')) {
      const hasUsage = line.includes('"usage"');
      const hasTool = line.includes('"tool_use"') || line.includes('"tool_result"');
      if (!hasUsage && !hasTool) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }

      const u = event?.message?.usage;
      if (u && typeof u === 'object' && event?.message?.role === 'assistant') {
        saw = true;
        delta.input += u.input_tokens || 0;
        delta.output += u.output_tokens || 0;
        delta.cacheRead += u.cache_read_input_tokens || 0;
        delta.cacheCreation += u.cache_creation_input_tokens || 0;
      }

      const content = event?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_use') {
          const cap = capabilityOf(b.name, b.input);
          if (cap && b.id) {
            bump(conductor, cap, 'calls', 1);
            pending[b.id] = cap;
          }
        } else if (b.type === 'tool_result') {
          const cap = pending[b.tool_use_id];
          if (cap) {
            bump(conductor, cap, 'bytes', Buffer.byteLength(JSON.stringify(b.content ?? '')));
            delete pending[b.tool_use_id];
          }
        }
      }
    }
    // Interrupted calls never get a result; keep the map bounded.
    if (Object.keys(pending).length > maxPending) {
      for (const k of Object.keys(pending).slice(0, Object.keys(pending).length - maxPending)) delete pending[k];
    }
    return { delta: saw ? delta : null, conductor, nextOffset: offset + end, pending, truncatedBackfill };
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const { session_id, transcript_path } = JSON.parse(input);
    if (typeof transcript_path !== 'string' || !transcript_path || !fs.existsSync(transcript_path)) {
      writeHealth({ lastRunAt: new Date().toISOString(), lastError: null, note: 'no transcript_path' });
      process.stdout.write('{}');
      return;
    }
    const sessionId = String(session_id || 'unknown');
    const st = readState(sessionId);
    const { delta, conductor, nextOffset, pending, truncatedBackfill } =
      aggregate(transcript_path, st.offset, { pending: st.pending });
    writeState(sessionId, { offset: nextOffset, pending, truncatedBackfill: st.truncatedBackfill || truncatedBackfill });
    const hasConductor = Object.keys(conductor).length > 0;
    if (delta || hasConductor) {
      const stats = loadStats();
      if (delta) {
        const t = stats.tokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
        stats.tokens = {
          input: t.input + delta.input, output: t.output + delta.output,
          cacheRead: t.cacheRead + delta.cacheRead, cacheCreation: t.cacheCreation + delta.cacheCreation,
        };
      }
      if (hasConductor) {
        const c = stats.conductor || {};
        for (const [cap, v] of Object.entries(conductor)) {
          const prev = c[cap] || { calls: 0, bytes: 0 };
          c[cap] = { calls: prev.calls + v.calls, bytes: prev.bytes + v.bytes };
        }
        stats.conductor = c;
      }
      saveStats(stats);
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, 'claude-usage.jsonl'), JSON.stringify({
        ts: new Date().toISOString(), sessionId,
        ...(delta || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }),
        ...(hasConductor ? { conductor } : {}),
      }) + '\n');
    }
    writeHealth({
      lastRunAt: new Date().toISOString(), lastError: null,
      offset: nextOffset, transcriptSize: fs.statSync(transcript_path).size,
      truncatedBackfill: st.truncatedBackfill || truncatedBackfill,
    });
  } catch (e) {
    writeHealth({ lastRunAt: new Date().toISOString(), lastError: { ts: new Date().toISOString(), message: String(e && e.message || e).slice(0, 300) } });
  }
  process.stdout.write('{}');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(() => { process.stdout.write('{}'); });
