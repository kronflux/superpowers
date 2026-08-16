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
 * The allowlist key for a command: the command verbatim, ends trimmed.
 *
 * No normalisation of any kind. Collapsing quoted bodies or whitespace runs is
 * content-lossy, and a lossy key lets one approval authorise a different
 * command. Two commands differing only in whitespace layout therefore take two
 * prompts: one redundant prompt in a rare case, against no possibility of
 * authorising something the operator did not see.
 */
function fingerprint(cmd) {
  return String(cmd).trim();
}

// Entries are separated by a NUL byte, not a newline: the fingerprint is the
// command verbatim, so a multi-line heredoc body carries its own newlines and
// a newline-delimited file would read one recorded command back as several
// unrelated lines. A shell command string cannot itself contain a NUL byte.
function readAllowlist(sessionId) {
  try {
    return new Set(
      fs.readFileSync(allowlistPath(sessionId), 'utf8').split('\0').filter(Boolean)
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
    fs.appendFileSync(allowlistPath(sessionId), `${entry}\0`);
  } catch {
    // Silently ignore — a missing allowlist entry costs one extra prompt
  }
}

export { allowlistPath, isAllowed, recordAllowed };
