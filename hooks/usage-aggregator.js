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
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { configDir } from './lib/config-dir.js';
import { loadStats, saveStats } from './track-session-stats.js';

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');

// Bounded work per invocation. buf.toString() over the whole unread region is
// what killed this hook in the field: V8 refuses strings past ~512 MB, the
// throw landed before writeOffset, and every later Stop retried from 0 forever.
const MAX_CHUNK = 32 * 1024 * 1024;
const BACKFILL_CAP = 64 * 1024 * 1024;

function readOffset(sessionId) {
  try { return parseInt(fs.readFileSync(path.join(os.tmpdir(), `sp-usage-${sessionId}`), 'utf8'), 10) || 0; }
  catch { return 0; }
}

function writeOffset(sessionId, offset) {
  try { fs.writeFileSync(path.join(os.tmpdir(), `sp-usage-${sessionId}`), String(offset)); } catch {}
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
  const size = fs.statSync(transcriptPath).size;
  if (offset > size) offset = 0; // file shrank: rotated or regenerated, re-scan
  if (offset >= size) return { delta: null, nextOffset: offset, truncatedBackfill: false };

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
          ? { delta: null, nextOffset: offset + want, truncatedBackfill }
          : { delta: null, nextOffset: offset, truncatedBackfill };
      }
    }

    const delta = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    let saw = false;
    for (const line of buf.toString('utf8', 0, end).split('\n')) {
      if (!line.includes('"usage"')) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const u = event?.message?.usage;
      if (!u || typeof u !== 'object' || event?.message?.role !== 'assistant') continue;
      saw = true;
      delta.input += u.input_tokens || 0;
      delta.output += u.output_tokens || 0;
      delta.cacheRead += u.cache_read_input_tokens || 0;
      delta.cacheCreation += u.cache_creation_input_tokens || 0;
    }
    return { delta: saw ? delta : null, nextOffset: offset + end, truncatedBackfill };
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
      process.stdout.write('{}');
      return;
    }
    const sessionId = String(session_id || 'unknown');
    const offset = readOffset(sessionId);
    const { delta, nextOffset } = aggregate(transcript_path, offset);
    writeOffset(sessionId, nextOffset);
    if (delta) {
      const stats = loadStats();
      const t = stats.tokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      stats.tokens = {
        input: t.input + delta.input, output: t.output + delta.output,
        cacheRead: t.cacheRead + delta.cacheRead, cacheCreation: t.cacheCreation + delta.cacheCreation,
      };
      saveStats(stats);
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, 'claude-usage.jsonl'),
        JSON.stringify({ ts: new Date().toISOString(), sessionId, ...delta }) + '\n');
    }
  } catch { /* fail-open */ }
  process.stdout.write('{}');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(() => { process.stdout.write('{}'); });
