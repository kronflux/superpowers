// hooks/lib/commit-command.js — recovers the message a `git commit` invocation
// would store, and reports when a command carries no message to inspect.
//
// Returns one of:
//   { kind: 'message', text }  a message is present in the command
//   { kind: 'none' }           the command commits with no inline message
//   { kind: 'absent' }         the command does not commit at all
//
// 'none' covers an editor-driven commit, a reused or generated message, and
// `--amend --no-edit`: in each case the text is not in the command, so nothing
// can be checked without guessing at it.

import { stripHeredocs } from './command-segments.js';

// Flags whose message text lives outside the command line.
const NO_INLINE_MESSAGE = [
  '--no-edit', '--fixup', '--squash', '-C', '--reuse-message', '-c',
  '--reedit-message', '-F', '--file', '--template', '-t',
];

/** Every `git commit ...` invocation in a command, heredoc bodies removed. */
function commitInvocations(command) {
  const text = stripHeredocs(String(command ?? ''));
  const out = [];
  const re = /\bgit\b[^\n;&|]*?\bcommit\b([^\n;&|]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

/**
 * The quoted or bare argument following a -m/--message flag.
 * Handles single quotes, double quotes, and an unquoted single token.
 */
function messageArg(invocation) {
  const re = /(?:^|\s)(?:-m|--message(?:=|\s))\s*("((?:\\.|[^"\\])*)"|'((?:[^'])*)'|([^\s]+))/;
  const m = re.exec(invocation);
  if (!m) return null;
  if (m[2] !== undefined) return m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  if (m[3] !== undefined) return m[3];
  return m[4] ?? null;
}

/**
 * All -m values in one invocation, joined the way git joins them: each becomes
 * its own paragraph, separated by a blank line.
 */
function allMessageArgs(invocation) {
  const parts = [];
  let rest = invocation;
  for (;;) {
    const value = messageArg(rest);
    if (value === null) break;
    parts.push(value);
    const idx = rest.search(/(?:^|\s)(?:-m|--message)/);
    rest = rest.slice(idx + 3);
  }
  return parts;
}

/** What a command would commit, per the contract in this file's header. */
function extractCommitMessage(command) {
  const invocations = commitInvocations(command);
  if (invocations.length === 0) return { kind: 'absent' };

  for (const invocation of invocations) {
    const parts = allMessageArgs(invocation);
    if (parts.length > 0) return { kind: 'message', text: parts.join('\n\n') };
    if (NO_INLINE_MESSAGE.some(f => new RegExp(`(?:^|\\s)${f}(?:[=\\s]|$)`).test(invocation))) {
      return { kind: 'none' };
    }
  }
  return { kind: 'none' };
}

export { extractCommitMessage, commitInvocations, allMessageArgs };
