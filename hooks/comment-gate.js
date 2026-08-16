#!/usr/bin/env node
/**
 * Comment Gate — PreToolUse hook for Edit|Write.
 *
 * Denies a write whose content introduces a comment that narrates
 * development history or names an intended-to-leave state, per
 * hooks/lib/comment-patterns.js. Scope is limited to lines the write
 * introduces: for Edit, lines present in new_string but not old_string;
 * for Write, lines present in content but not in the file's current
 * on-disk text. A violation elsewhere in the file, unchanged by this
 * write, never enters the scanned set.
 *
 * `.superpowers-no-comment-gate` at the project root (resolved from the
 * hook payload's cwd) disables this hook there.
 *
 * Fails open: any internal fault allows the write.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyComment, extractComments } from './lib/comment-patterns.js';
import { dedupeReason } from './lib/rejection-dedup.js';

/**
 * Lines present in `newText` that are absent from `oldText`, by exact-text
 * occurrence count rather than position. A line repeated in `oldText` still
 * counts as unchanged in `newText` up to its old occurrence count.
 */
function addedLines(oldText, newText) {
  const oldLines = String(oldText ?? '').split(/\r?\n/);
  const newLines = String(newText ?? '').split(/\r?\n/);
  const counts = new Map();
  for (const l of oldLines) counts.set(l, (counts.get(l) || 0) + 1);
  const added = [];
  for (const l of newLines) {
    const c = counts.get(l) || 0;
    if (c > 0) {
      counts.set(l, c - 1);
    } else {
      added.push(l);
    }
  }
  return added;
}

/** Classification of the first violating comment among the added lines, or null. */
function findViolation(oldText, newText) {
  const added = addedLines(oldText, newText);
  const comments = extractComments(added.join('\n'));
  for (const body of comments) {
    const result = classifyComment(body);
    if (result) return result;
  }
  return null;
}

function declineMarkerExists(projectRoot) {
  try {
    return fs.existsSync(path.join(projectRoot, '.superpowers-no-comment-gate'));
  } catch {
    return false;
  }
}

function readCurrentContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Evaluates one Edit or Write payload. Returns { blocked, violation }.
 * Any other tool name, or malformed input, returns not-blocked.
 */
function check(toolName, toolInput, cwd = process.cwd()) {
  try {
    if (!['Edit', 'Write'].includes(toolName)) return { blocked: false, violation: null };

    const projectRoot = cwd || process.cwd();
    if (declineMarkerExists(projectRoot)) return { blocked: false, violation: null };

    const filePath = toolInput?.file_path;
    let oldText;
    let newText;

    if (toolName === 'Write') {
      newText = toolInput?.content;
      oldText = typeof filePath === 'string' && filePath ? readCurrentContent(filePath) : '';
    } else {
      oldText = toolInput?.old_string;
      newText = toolInput?.new_string;
    }

    if (typeof newText !== 'string') return { blocked: false, violation: null };
    if (typeof oldText !== 'string') oldText = '';

    const violation = findViolation(oldText, newText);
    if (violation) return { blocked: true, violation };
    return { blocked: false, violation: null };
  } catch {
    return { blocked: false, violation: null };
  }
}

/** Deny message quoting the matched text and naming the disable path. */
function buildDenyMessage(violation) {
  const intro = violation.violation === 'narration'
    ? 'Comment describes development history, not present-state behavior.'
    : 'Comment describes a state its author intends to leave, not present-state behavior.';
  return [
    intro,
    '',
    `  matched: "${violation.match}"`,
    '',
    'State what the code does now — behavior, inputs, outputs, side effects.',
    'The change history belongs in the commit message.',
    '',
    'Disable in this project: touch .superpowers-no-comment-gate',
  ].join('\n');
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, cwd, session_id } = data;
    const result = check(tool_name, tool_input, cwd);

    if (result.blocked) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: dedupeReason({
            sessionId: session_id,
            hook: 'comment-gate',
            ruleId: result.violation.violation,
            reason: buildDenyMessage(result.violation),
            subject: tool_input?.file_path || '(no file path)',
          }),
        },
      }));
      return;
    }

    process.stdout.write('{}');
  } catch {
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

export { check, findViolation, addedLines, buildDenyMessage, declineMarkerExists };
