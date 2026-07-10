#!/usr/bin/env node

/**
 * Bash Output Compression Hook — PreToolUse/Bash
 * Compresses compressible Bash output via bash-optimizer.js.
 * YIELDS (returns {}) when context-mode is active — context-mode owns Bash
 * routing in that mode (spec §6.3). Honors SP_NO_COMPRESS=1 and .sp-no-compress.
 * Fail-open: any error runs the original command unmodified.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { RULES, NEVER_COMPRESS } from './compression-rules.js';
import { isContextModeActive } from './lib/ctx-detect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Global disable check ──
if (process.env.SP_NO_COMPRESS === '1') {
  process.stdout.write('{}');
  process.exit(0);
}

/**
 * Adaptive re-run detection.
 *
 * Tracks whether a command was recently compressed. If Claude runs the
 * exact same command again within 60 seconds, we pass it through raw —
 * Claude is likely re-running because the compressed output was insufficient.
 *
 * State is stored in a session-scoped temp file that is automatically
 * cleaned up by the OS.
 */
function shouldSkipForRerun(cmd, sessionId) {
  const trackFile = path.join(os.tmpdir(), `sp-compress-${sessionId || 'default'}.json`);
  let tracking = {};
  try { tracking = JSON.parse(fs.readFileSync(trackFile, 'utf8')); } catch {}
  const key = cmd.replace(/\s+/g, ' ').trim();
  const prev = tracking[key];
  if (prev && prev.compressed && (Date.now() - prev.ts < 60000)) {
    tracking[key] = { compressed: false, ts: Date.now() };
    try { fs.writeFileSync(trackFile, JSON.stringify(tracking)); } catch {}
    return true;
  }
  return false;
}

function markCompressed(cmd, sessionId) {
  const trackFile = path.join(os.tmpdir(), `sp-compress-${sessionId || 'default'}.json`);
  let tracking = {};
  try { tracking = JSON.parse(fs.readFileSync(trackFile, 'utf8')); } catch {}
  const key = cmd.replace(/\s+/g, ' ').trim();
  tracking[key] = { compressed: true, ts: Date.now() };
  try { fs.writeFileSync(trackFile, JSON.stringify(tracking)); } catch {}
}

function ctxActive(sessionId) {
  try {
    return isContextModeActive({ sessionId });
  } catch {
    return false; // fail-open: if detection breaks, behave as if inactive
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd } = data;

    // Only handle Bash tool calls
    if (tool_name !== 'Bash') { process.stdout.write('{}'); return; }

    const cmd = (tool_input?.command || '').trim();
    if (!cmd) { process.stdout.write('{}'); return; }

    // ── context-mode yield ──
    // When context-mode is active it owns Bash routing. Yield: no updatedInput.
    if (ctxActive(session_id)) { process.stdout.write('{}'); return; }

    // ── Project-level disable ──
    const projectDir = cwd || process.cwd();
    try {
      if (fs.existsSync(path.join(projectDir, '.sp-no-compress'))) {
        process.stdout.write('{}'); return;
      }
    } catch {}

    // ── RTK coexistence ──
    // If RTK is already handling this command, don't double-compress
    if (/^rtk(\s|\.exe\s)/.test(cmd)) { process.stdout.write('{}'); return; }

    // ── Never-compress list ──
    if (NEVER_COMPRESS.some(p => p.test(cmd))) { process.stdout.write('{}'); return; }

    // ── Find matching compression rule ──
    const rule = RULES.find(r => r.match.test(cmd));
    if (!rule) { process.stdout.write('{}'); return; }

    // ── Adaptive re-run detection ──
    if (shouldSkipForRerun(cmd, session_id)) { process.stdout.write('{}'); return; }

    // ── Rewrite command to run through bash-optimizer.js ──
    // Use forward slashes for all platforms (bash on Windows handles them)
    const optimizerPath = path.join(__dirname, 'bash-optimizer.js').replace(/\\/g, '/');
    const b64 = Buffer.from(cmd).toString('base64');
    const rewrittenCmd = `node "${optimizerPath}" "${b64}" "${rule.type}"`;

    // Preserve all original tool_input fields, only replace the command
    const updatedInput = { ...tool_input, command: rewrittenCmd };

    // Track this command as compressed for re-run detection
    markCompressed(cmd, session_id);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `smart-compress: ${rule.type}`,
        updatedInput,
      },
    }));
  } catch {
    // Fail-open: any error lets the original command through unchanged
    process.stdout.write('{}');
  }
}

main();
