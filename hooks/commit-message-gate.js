#!/usr/bin/env node
/**
 * Commit Message Gate — PreToolUse hook for Bash.
 *
 * Denies a `git commit` whose inline message does not follow Conventional
 * Commits 1.0.0, per hooks/lib/conventional-commit.js. Only a message carried
 * in the command is checked: an editor-driven commit, a reused or generated
 * message, and `--amend --no-edit` supply no text to inspect and pass through.
 *
 * A repository with no commits yet passes through, so the first commit is
 * never blocked.
 *
 * `.superpowers-no-commit-gate` at the project root (resolved from the hook
 * payload's cwd) disables this hook there.
 *
 * Fails open: any internal fault allows the command.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { validateCommitMessage, significantLines, TYPES } from './lib/conventional-commit.js';
import { findBannedContent } from './lib/commit-content.js';
import { extractCommitMessage } from './lib/commit-command.js';
import { dedupeReason } from './lib/rejection-dedup.js';

const HEADER_RE = /^[a-zA-Z]+(\([^()]*\))?!?: (.*)$/;

/** Format findings plus the banned-content findings for the same message. */
function allFindings(message) {
  const format = validateCommitMessage(message);
  const lines = significantLines(message);
  const m = HEADER_RE.exec(lines[0] ?? '');
  // Content is judged only once the header parses; otherwise the description
  // cannot be separated from the prefix.
  if (!m) return format;
  return [...format, ...findBannedContent(m[2], lines.slice(1).join('\n'))];
}

function declineMarkerExists(projectRoot) {
  try {
    return fs.existsSync(path.join(projectRoot, '.superpowers-no-commit-gate'));
  } catch {
    return false;
  }
}

/** True when the repository already has a commit, so this one is not the first. */
function hasCommits(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 5000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function buildDenyMessage(findings) {
  return [
    'Commit message rejected.',
    '',
    ...findings.map(f => (f.match ? `  - ${f.detail} — "${f.match}"` : `  - ${f.detail}`)),
    '',
    'Required shape:',
    '',
    '  type(optional-scope): description',
    '',
    `  type is one of: ${TYPES.join(', ')}`,
    '  description is lower-case, imperative, and carries no trailing full stop',
    '  a breaking change adds ! before the colon, or a BREAKING CHANGE: footer',
    '',
    'The description states what changed in the software. The bans in',
    'skills/shared/git-hygiene.md still apply to it: no internal counts, no',
    'planning structure, no process verbs about yourself.',
    '',
    'Disable in this project: touch .superpowers-no-commit-gate',
  ].join('\n');
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }

  const cwd = payload?.cwd || process.cwd();
  if (declineMarkerExists(cwd)) process.exit(0);

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || command === '') process.exit(0);

  const extracted = extractCommitMessage(command);
  if (extracted.kind !== 'message') process.exit(0);

  const findings = allFindings(extracted.text);
  if (findings.length === 0) process.exit(0);

  if (!hasCommits(cwd)) process.exit(0);

  const reason = dedupeReason({
    sessionId: payload?.session_id,
    hook: 'commit-message-gate',
    ruleId: findings[0].rule,
    full: buildDenyMessage(findings),
    short: `Commit message does not follow Conventional Commits: ${findings[0].detail}`,
  });

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
