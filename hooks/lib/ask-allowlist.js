// hooks/lib/ask-allowlist.js — per-session record of ask-tier commands the
// operator approved.
//
// Storage lives here rather than in either hook because both need it: the
// PreToolUse gate reads it before asking and the PostToolUse recorder writes
// it after a command runs. Hooks importing each other would form an ESM cycle
// whose bindings resolve differently depending on which module is entered
// first.
//
// The fingerprint is the exact command, not the flag shape: one approval
// authorizes one command for one session, and nothing wider.

import fs from 'fs';
import { spTmp } from './sp-tmp.js';

/** Absolute path to the session's allowlist file inside the sp/ temp root. */
function allowlistPath(sessionId) {
  return spTmp(`askallow-${sessionId || 'default'}`);
}

/**
 * The allowlist key for a command: internal whitespace runs collapsed to one
 * space, both ends trimmed, every other character preserved verbatim.
 *
 * Deliberately not normalizeCommand. That collapses quoted bodies to `ARG`
 * and heredoc bodies to `<<HEREDOC`, which is correct for pattern matching
 * and wrong for an authorization key: `git commit -am "fix typo"` and
 * `git commit -am "rewrite the auth layer"` would share one key, so a single
 * approval would silence every later -am commit in the session.
 */
function fingerprint(cmd) {
  return String(cmd).replace(/\s+/g, ' ').trim();
}

function readAllowlist(sessionId) {
  try {
    return new Set(
      fs.readFileSync(allowlistPath(sessionId), 'utf8').split('\n').filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

/** True when this exact command was approved earlier in the session. */
function isAllowed(sessionId, cmd) {
  return readAllowlist(sessionId).has(fingerprint(cmd));
}

/** Appends the command's fingerprint to the session allowlist, once. */
function recordAllowed(sessionId, cmd) {
  try {
    const entry = fingerprint(cmd);
    if (!entry || readAllowlist(sessionId).has(entry)) return;
    fs.appendFileSync(allowlistPath(sessionId), `${entry}\n`);
  } catch {
    // Silently ignore — a missing allowlist entry costs one extra prompt
  }
}

export { allowlistPath, isAllowed, recordAllowed };
