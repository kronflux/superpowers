#!/usr/bin/env node
/**
 * Conductor Nudges — PreToolUse (Grep|Glob|Read|Edit) + PostToolUse (Bash)
 *
 * The conductor chain (skills/shared/conductor/routing.md) is prose, so
 * nothing fires at the moment of tool choice and optional integrations go
 * unused. This hook injects ONE short tip per capability class per session,
 * at the exact moment the inferior default is being used:
 *   codegraph  — Grep/Glob/Read in a CodeGraph-indexed repo
 *   serena     — first Edit while Serena is configured
 *   middleware — large failing Bash output while middleware is configured
 * State (probed capabilities + spent flags) lives in one sp- tmpfile per
 * session, so after every nudge has fired the hook is a read + exit.
 * Never denies anything. Fail-open: any error -> {}.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { probe } from './lib/capability-registry.js';

const CLASSES = ['codegraph', 'serena', 'middleware'];

const TIPS = {
  codegraph: 'Conductor: this repo is CodeGraph-indexed. Macro discovery (find/trace/blast-radius) goes to `codegraph explore "<symbols or question>"` first - one call replaces a grep-and-read chain (chain order: skills/shared/conductor/routing.md). Grep/Read stay right for known exact locations.',
  serena: 'Conductor: Serena is configured. Symbol-precise edits (rename, replace body, find references) route via Serena symbol tools before native Edit - see skills/shared/conductor/serena.md.',
  middleware: 'Conductor: middleware is configured. Digest this failing output externally instead of re-reading it: `node scripts/middleware-exec.mjs --task summarize-test-failure --input-file <f>` (or pipe stdin). Announce the run and its token cost per skills/shared/conductor/routing.md.',
};

// Failure heuristic for Bash output: generic across vitest/pytest/cargo/tsc.
const FAIL_RE = /\bFAIL(ED)?\b|\b[1-9]\d* (failed|errors?)\b|\bError[:\s]|Traceback \(most recent/;
const MIN_OUTPUT_BYTES = 2048;

function statePath(sessionId) {
  return path.join(os.tmpdir(), `sp-conductor-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}`);
}

function loadState(sessionId, cwd) {
  try { return JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8')); } catch {}
  // First invocation this session: probe once and cache. probe() is fs/PATH
  // checks only; if it ever throws, caps stay all-false (nudges silent).
  const caps = { codegraph: false, serena: false, middleware: false };
  try {
    const p = probe(cwd);
    caps.codegraph = p.codegraph.indexed === true && p.codegraph.declined !== true;
    caps.serena = p.serena.status !== 'absent' && p.serena.declined !== true;
    caps.middleware = p.middleware.status !== 'absent' && p.middleware.declined !== true;
  } catch {}
  const state = { caps, spent: { codegraph: false, serena: false, middleware: false } };
  try { fs.writeFileSync(statePath(sessionId), JSON.stringify(state)); } catch {}
  return state;
}

function responseText(resp) {
  if (typeof resp === 'string') return resp;
  if (resp && typeof resp === 'object') {
    return [resp.stdout, resp.stderr, resp.output].filter((s) => typeof s === 'string').join('\n');
  }
  return '';
}

async function main() {
  let input = '';
  try {
    for await (const chunk of process.stdin) input += chunk;
    const data = JSON.parse(input);
    const { tool_name, session_id, cwd } = data;
    const isPost = data.hook_event_name === 'PostToolUse' || 'tool_response' in data;
    const sessionId = String(session_id || 'unknown');
    const state = loadState(sessionId, cwd || process.cwd());

    if (CLASSES.every((c) => state.spent[c] || !state.caps[c])) {
      process.stdout.write('{}');
      return;
    }

    let cls = null;
    if (!isPost && (tool_name === 'Grep' || tool_name === 'Glob' || tool_name === 'Read')) {
      cls = 'codegraph';
    } else if (!isPost && tool_name === 'Edit') {
      cls = 'serena';
    } else if (isPost && tool_name === 'Bash') {
      const text = responseText(data.tool_response);
      if (Buffer.byteLength(text) > MIN_OUTPUT_BYTES && FAIL_RE.test(text)) cls = 'middleware';
    }

    if (!cls || !state.caps[cls] || state.spent[cls]) {
      process.stdout.write('{}');
      return;
    }

    state.spent[cls] = true;
    try { fs.writeFileSync(statePath(sessionId), JSON.stringify(state)); } catch {}
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: isPost ? 'PostToolUse' : 'PreToolUse',
        additionalContext: TIPS[cls],
      },
    }));
  } catch {
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(() => { process.stdout.write('{}'); });
