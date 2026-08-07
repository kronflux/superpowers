#!/usr/bin/env node
/**
 * Conductor Nudges — PreToolUse (Grep|Glob|Read) + PostToolUse (Bash|Edit)
 *
 * The conductor chain (skills/shared/conductor/routing.md) is prose, so
 * nothing fires at the moment of tool choice and optional integrations go
 * unused. This hook injects ONE short tip per capability class per session,
 * at the exact moment the inferior default is being used:
 *   codegraph      — Grep/Glob/Read in a CodeGraph-indexed repo
 *   codegraph-init — Grep/Glob/Read when CodeGraph is installed but unindexed
 *   lsp            — Edit of a file type no installed language server covers
 *   middleware     — large failing Bash output while middleware is configured
 * State (probed capabilities + spent flags) lives in one file under the sp/
 * tmp root per session, so after every nudge has fired the hook is a read + exit.
 * Never denies anything. Fail-open: any error -> {}.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pluginForPath, extensionOf } from './lib/lsp-plugins.js';
import { spTmp } from './lib/sp-tmp.js';

const CLASSES = ['codegraph', 'codegraph-init', 'lsp', 'middleware'];

const TIPS = {
  codegraph: 'Conductor: this repo is CodeGraph-indexed. Macro discovery (find/trace/blast-radius) goes to `codegraph explore "<symbols or question>"` first - one call replaces a grep-and-read chain (chain order: skills/shared/conductor/routing.md). Grep/Read stay right for known exact locations.',
  'codegraph-init': 'Conductor: CodeGraph is installed but this project is NOT indexed, so discovery is falling back to grep sweeps. At the next natural break in the current task - not now, do not derail what you are doing - offer the user: run `codegraph init` (creates ./.codegraph/, builds the graph, auto-syncs afterwards)? NEVER run it uninvited. On decline, write an empty `.superpowers-no-codegraph` in the project root and never offer again.',
  middleware: 'Conductor: middleware is configured. Digest this failing output externally instead of re-reading it: `node scripts/middleware-exec.mjs --task summarize-test-failure --input-file <f>` (or pipe stdin). Announce the run and its token cost per skills/shared/conductor/routing.md.',
};

function lspTip(plugin) {
  return `Conductor: no language server covers this file type, so edits here produce no diagnostics. At the next natural break in the current task - not now, do not derail what you are doing - offer the user: install \`${plugin}\` via /plugin from the claude-plugins-official marketplace, for inline diagnostics after each edit. NEVER run the install yourself. On decline, append "${plugin}" on its own line to \`.superpowers-no-lsp\` in the project root. Diagnostics are a fast first signal only - they NEVER replace a verification gate named in a plan's acceptance criteria (skills/shared/conductor/lsp.md).`;
}

// Failure heuristic for Bash output: generic across vitest/pytest/cargo/tsc.
const FAIL_RE = /\bFAIL(ED)?\b|\b[1-9]\d* (failed|errors?)\b|\bError[:\s]|Traceback \(most recent/;
const MIN_OUTPUT_BYTES = 2048;

function statePath(sessionId) {
  return spTmp(`conductor-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}`);
}

function claimNudge(sessionId, cls) {
  try {
    fs.writeFileSync(`${statePath(sessionId)}-${cls}`, '1', { flag: 'wx' });
    return true;
  } catch {
    return false; // already claimed (EEXIST) or unwritable - either way, stay silent
  }
}

async function loadState(sessionId, cwd) {
  try { return JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8')); } catch {}
  // First invocation this session: probe once and cache. probe() is fs/PATH
  // checks only; if it ever throws, caps stay all-false (nudges silent).
  const caps = {
    codegraph: false,
    'codegraph-init': false,
    lsp: { extensions: [], declined: [], declinedAll: true },
    middleware: false,
  };
  try {
    const { probe } = await import('./lib/capability-registry.js');
    const p = probe(cwd);
    const cgLive = p.codegraph.status !== 'absent' && p.codegraph.declined !== true;
    caps.codegraph = cgLive && p.codegraph.indexed === true;
    caps['codegraph-init'] = cgLive && p.codegraph.indexed !== true;
    caps.lsp = {
      extensions: p.lsp.extensions || [],
      declined: p.lsp.declined || [],
      declinedAll: !!p.lsp.declinedAll,
    };
    caps.middleware = p.middleware.status !== 'absent' && p.middleware.declined !== true;
  } catch {}
  const state = {
    caps,
    spent: { codegraph: false, 'codegraph-init': false, lsp: false, middleware: false },
  };
  try {
    const tmp = statePath(sessionId) + `.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    try {
      fs.renameSync(tmp, statePath(sessionId));
    } catch {
      // Another instance won the race; prefer its state.
      try { fs.rmSync(tmp, { force: true }); } catch {}
      try { return JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8')); } catch {}
    }
  } catch {}
  return state;
}

function responseText(resp) {
  if (typeof resp === 'string') return resp;
  if (resp && typeof resp === 'object') {
    return [resp.stdout, resp.stderr, resp.output].filter((s) => typeof s === 'string').join('\n');
  }
  return '';
}

// `lsp` availability is per-file, so the class-level check only asks whether
// any offer is still possible this session.
function available(state, cls) {
  if (cls === 'lsp') {
    const l = state.caps.lsp;
    return !!l && !l.declinedAll;
  }
  return !!state.caps[cls];
}

// The plugin to offer for this path, or null when there is nothing to offer:
// unmapped extension, already covered by an installed server, or declined.
function lspOfferFor(state, filePath) {
  const l = state.caps.lsp;
  if (!l || l.declinedAll) return null;
  const plugin = pluginForPath(filePath);
  if (!plugin) return null;
  if ((l.declined || []).includes(plugin)) return null;
  const ext = extensionOf(filePath);
  if (ext && (l.extensions || []).includes(ext)) return null;
  return plugin;
}

async function main() {
  let input = '';
  try {
    for await (const chunk of process.stdin) input += chunk;
    const data = JSON.parse(input);
    const { tool_name, session_id, cwd } = data;
    const isPost = data.hook_event_name === 'PostToolUse' || 'tool_response' in data;
    const sessionId = String(session_id || 'unknown');
    const state = await loadState(sessionId, cwd || process.cwd());

    if (CLASSES.every((c) => state.spent[c] || !available(state, c))) {
      process.stdout.write('{}');
      return;
    }

    let cls = null;
    let text = null;
    if (!isPost && (tool_name === 'Grep' || tool_name === 'Glob' || tool_name === 'Read')) {
      cls = state.caps['codegraph-init'] ? 'codegraph-init' : 'codegraph';
      text = TIPS[cls];
    } else if (isPost && tool_name === 'Edit') {
      const plugin = lspOfferFor(state, data.tool_input?.file_path);
      if (plugin) { cls = 'lsp'; text = lspTip(plugin); }
    } else if (isPost && tool_name === 'Bash') {
      const out = responseText(data.tool_response);
      if (Buffer.byteLength(out) > MIN_OUTPUT_BYTES && FAIL_RE.test(out)) {
        cls = 'middleware';
        text = TIPS.middleware;
      }
    }

    if (!cls || !text || !available(state, cls) || state.spent[cls]) {
      process.stdout.write('{}');
      return;
    }
    if (!claimNudge(sessionId, cls)) { process.stdout.write('{}'); return; }

    state.spent[cls] = true;
    try { fs.writeFileSync(statePath(sessionId), JSON.stringify(state)); } catch {}
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: isPost ? 'PostToolUse' : 'PreToolUse',
        additionalContext: text,
      },
    }));
  } catch {
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(() => { process.stdout.write('{}'); });
