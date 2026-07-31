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
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { configDir } from './lib/config-dir.js';
import { loadStats, saveStats } from './track-session-stats.js';

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');

function readOffset(sessionId) {
  try { return parseInt(fs.readFileSync(path.join(os.tmpdir(), `sp-usage-${sessionId}`), 'utf8'), 10) || 0; }
  catch { return 0; }
}

function writeOffset(sessionId, offset) {
  try { fs.writeFileSync(path.join(os.tmpdir(), `sp-usage-${sessionId}`), String(offset)); } catch {}
}

export function aggregate(transcriptPath, offset) {
  const size = fs.statSync(transcriptPath).size;
  if (offset > size) offset = 0; // file shrank: rotated or regenerated, re-scan
  if (offset >= size) return { delta: null, nextOffset: offset };

  // Positional read: only the bytes since offset, not the whole transcript.
  const buf = Buffer.alloc(size - offset);
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    fs.readSync(fd, buf, 0, buf.length, offset);
  } finally {
    fs.closeSync(fd);
  }

  // end is relative to buf (which starts at `offset`); nextOffset below
  // converts back to an absolute file offset.
  let end = buf.length;
  // Only consume complete lines: an unterminated tail is re-read next run.
  if (buf[end - 1] !== 0x0a) {
    end = buf.lastIndexOf(0x0a, end - 1) + 1;
    if (end <= 0) return { delta: null, nextOffset: offset };
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
  return { delta: saw ? delta : null, nextOffset: offset + end };
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
