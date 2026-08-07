#!/usr/bin/env node
/**
 * Stop Hook — Contextual Reminders
 *
 * When Claude finishes responding, checks session context and provides
 * gentle reminders about TDD, verification, and commit hygiene.
 * These reminders reinforce discipline skills deterministically.
 *
 * Uses a PER-SESSION file-based guard to fire only once per session lock and
 * prevent infinite loops (a Stop hook returning content causes Claude to
 * resume). The lock is keyed by sessionId under the sp/ tmp root
 * (<tmpdir>/sp/stop-<sessionId>.lock) — never a global lock — so concurrent
 * sessions and other plugins' Stop hooks do not collide (spec §6.3, criterion 7).
 *
 * Input:  stdin JSON with { session_id, cwd, ... }
 * Output: stdout JSON with decision/reason continuation payload (only when
 * actionable reminders exist), or {} to let Claude stop normally.
 * Uses decision+reason rather than hookSpecificOutput for broader version compat.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { configDir } from './lib/config-dir.js';
import { spTmp } from './lib/sp-tmp.js';

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');
const EDIT_LOG = path.join(LOG_DIR, 'edit-log.txt');
const LAST_SAVED_FILE = path.join(LOG_DIR, 'last-saved-entry.txt');
const STATS_FILE = path.join(LOG_DIR, 'session-stats.json');

// Guard: only fire once per session (prevent infinite loop).
// The per-session lock file is created on first fire and checked on subsequent
// fires. It auto-expires after 15 minutes so later Claude stops can show reminders.
const GUARD_TTL_MS = 15 * 60 * 1000;

// Per-session Stop lock under the sp/ tmp root (stop-<sessionId>.lock) — never a
// global lock, so concurrent sessions / other plugins do not collide (spec §6.3).
function guardFile(sessionId) {
  return spTmp(`stop-${sessionId || 'default'}.lock`);
}

function shouldFire(sessionId) {
  try {
    const gf = guardFile(sessionId);
    if (fs.existsSync(gf)) {
      const age = Date.now() - fs.statSync(gf).mtimeMs;
      if (age < GUARD_TTL_MS) return false; // Guard is active, don't fire
    }
    return true;
  } catch {
    return true;
  }
}

function setGuard(sessionId) {
  try {
    fs.writeFileSync(guardFile(sessionId), new Date().toISOString());
  } catch {
    // Ignore guard write errors
  }
}

// Common test file patterns
const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.(go|py|rb)$/,
  /test_[^/]+\.py$/,
  /Tests?\.[^/]+$/,
  /\.test$/,
  /__tests__\//,
  /(?:^|[/\\])test[-_][^/\\]+\.[jt]sx?$/i,
  /[/\\]tests?[/\\]/i,
];

// Common source file patterns (non-test, non-config)
const SOURCE_PATTERNS = [
  /\.(js|jsx|ts|tsx|py|rb|go|rs|java|cs|cpp|c|h|hpp|swift|kt|scala|php)$/,
];

// Files that are clearly config/non-source
const CONFIG_PATTERNS = [
  /package\.json$/,
  /tsconfig.*\.json$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /\.gitignore$/,
  /\.env/,
  /Dockerfile/,
  /docker-compose/,
  /\.ya?ml$/,
  /\.toml$/,
  /\.cfg$/,
  /\.ini$/,
  /\.md$/,
  /\.lock$/,
  /CLAUDE\.md$/,
  /SKILL\.md$/,
];

function isTestFile(filePath) {
  return TEST_PATTERNS.some(p => p.test(filePath));
}

function isSourceFile(filePath) {
  return SOURCE_PATTERNS.some(p => p.test(filePath)) && !CONFIG_PATTERNS.some(p => p.test(filePath));
}

/**
 * Parse a raw log line into an entry object.
 * Supports both legacy 3-field format and new 4-field format with session_id.
 */
function parseLogLine(line) {
  const parts = line.split(' | ');
  if (parts.length < 3) return null;
  if (parts.length >= 4) {
    // New format: timestamp | session_id | tool | filePath
    return {
      timestamp: parts[0],
      sessionId: parts[1] || null,
      tool: parts[2],
      filePath: parts.slice(3).join(' | '),
    };
  }
  // Legacy format: timestamp | tool | filePath
  return {
    timestamp: parts[0],
    sessionId: null,
    tool: parts[1],
    filePath: parts.slice(2).join(' | '),
  };
}

/**
 * Return true if an entry matches the given sessionId filter.
 * When sessionId is provided: only entries with a matching sessionId pass.
 * When sessionId is null/undefined: legacy entries (no sessionId) pass.
 */
function matchesSession(entry, sessionId) {
  if (sessionId) {
    return entry.sessionId === sessionId;
  }
  return entry.sessionId === null;
}

/**
 * Read recent edits from the edit log (last 30 minutes), filtered to the current session.
 */
function getRecentEdits(sessionId) {
  try {
    if (!fs.existsSync(EDIT_LOG)) return [];

    const content = fs.readFileSync(EDIT_LOG, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);

    return lines
      .map(parseLogLine)
      .filter(entry =>
        entry &&
        new Date(entry.timestamp) > cutoff &&
        matchesSession(entry, sessionId)
      );
  } catch {
    return [];
  }
}

/**
 * Return the timestamp of the last [saved] entry written to session-log.md,
 * or null if no saved entry exists yet this session.
 */
function getLastSavedEntryTime() {
  try {
    if (!fs.existsSync(LAST_SAVED_FILE)) return null;
    const ts = new Date(fs.readFileSync(LAST_SAVED_FILE, 'utf8').trim());
    return isNaN(ts.getTime()) ? null : ts;
  } catch {
    return null;
  }
}

/**
 * Return all edit log entries after the given timestamp, filtered to the current session.
 * If timestamp is null, returns all session entries (i.e. no [saved] baseline exists).
 */
function getEditsAfter(timestamp, sessionId) {
  try {
    if (!fs.existsSync(EDIT_LOG)) return [];
    const cutoff = timestamp || new Date(0);
    return fs.readFileSync(EDIT_LOG, 'utf8')
      .split('\n').filter(Boolean)
      .map(parseLogLine)
      .filter(e => e && new Date(e.timestamp) > cutoff && matchesSession(e, sessionId));
  } catch {
    return [];
  }
}

/**
 * Load session statistics for progress visibility.
 */
function getSessionStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Format session stats into a brief summary line.
 */
function formatStatsSummary(stats) {
  if (!stats || stats.totalSkillCalls === 0) return null;

  const duration = Math.round((Date.now() - new Date(stats.startedAt).getTime()) / 60000);
  const skillNames = Object.entries(stats.skillInvocations)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count}x)`)
    .join(', ');

  const injectedKB = ((stats.injectedBytes || 0) / 1024).toFixed(1);
  return `Session summary: ${duration}min, ${stats.totalSkillCalls} skill invocations [${skillNames}], hook-injected context this session: ${injectedKB}KB`;
}

function getUncommittedCount(cwd) {
  try {
    const result = spawnSync('git', ['status', '--porcelain'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status !== 0 || result.error) return 0;
    const lines = (result.stdout || '').split('\n').filter(l => l.trim().length > 0);
    return lines.length;
  } catch {
    return 0;
  }
}

/**
 * Generate contextual reminders based on edit history and session stats.
 * Returns array of reminder strings.
 */
function generateReminders(edits, cwd) {
  const reminders = [];

  // Session stats summary (always include if available)
  const stats = getSessionStats();
  const statsSummary = formatStatsSummary(stats);
  if (statsSummary) {
    reminders.push(statsSummary);
  }

  if (edits.length === 0) return reminders;

  const editedPaths = [...new Set(edits.map(e => e.filePath))];
  const sourceFiles = editedPaths.filter(isSourceFile);
  const testFiles = editedPaths.filter(isTestFile);

  // TDD reminder: source files changed without corresponding tests
  const untestedSources = sourceFiles.filter(src => !isTestFile(src));
  if (untestedSources.length > 0 && testFiles.length === 0) {
    reminders.push(
      `TDD reminder: ${untestedSources.length} source file(s) modified without test changes. ` +
      `Consider running tests or invoking TDD workflow if behavior changed.`
    );
  }

  // Commit reminder: check actual uncommitted changes via git, not just session edits.
  if (editedPaths.length >= 5) {
    const uncommittedCount = getUncommittedCount(cwd);
    if (uncommittedCount >= 5) {
      reminders.push(
        `Commit reminder: ${uncommittedCount} files with uncommitted changes. ` +
        `Consider committing incremental progress to avoid losing work.`
      );
    }
  }

  return reminders;
}

/**
 * Detect sessions where significant architectural decisions were made.
 * These are sessions that modified skill files, hooks, or plugin config —
 * places where the "why" matters and would be costly to rediscover.
 */
function isSignificantSession(edits) {
  const sigPatterns = [
    /SKILL\.md$/i,
    /[/\\]hooks[/\\][^/\\]+\.js$/,
    /[/\\]hooks[/\\]session-start$/,
    /skill-rules\.json$/,
    /CLAUDE\.md$/i,
    /agents[/\\][^/\\]+\.md$/i,
    /[/\\]specs[/\\][^/\\]+\.md$/i,
    /[/\\]plans[/\\][^/\\]+\.md$/i,
    /plugin\.universal\.yaml$/,
  ];
  return edits.some(e => sigPatterns.some(p => p.test(e.filePath)));
}

/**
 * Check if state.md exists in cwd and has been overtaken by recent source-file
 * edits — a signal that active task state may have drifted since last save.
 * Returns a reminder string if stale, null otherwise.
 *
 * Threshold: state.md older than at least 2 source-file edits that occurred
 * after it was last written. Config-only edits are excluded (noise).
 */
function checkStateMdStaleness(cwd, recentEdits) {
  try {
    const stateMdPath = path.join(cwd, 'state.md');
    if (!fs.existsSync(stateMdPath)) return null;

    const stateMtime = fs.statSync(stateMdPath).mtimeMs;
    const editsAfterState = recentEdits.filter(e =>
      new Date(e.timestamp).getTime() > stateMtime && isSourceFile(e.filePath)
    );

    if (editsAfterState.length >= 2) {
      return (
        'State.md sync: state.md was written before recent code changes in this session. ' +
        'If progress was made on the active task, update state.md via the context-management skill.'
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check the last 2 [saved] entries in session-log.md and warn if they
 * exceed the token budget. Hard cap is 250 tokens (~1000 chars) per entry.
 * Returns a warning string if over budget, null otherwise.
 */
function checkSessionLogSize(cwd) {
  try {
    const sessionLogPath = path.join(cwd, 'session-log.md');
    if (!fs.existsSync(sessionLogPath)) return null;

    const lines = fs.readFileSync(sessionLogPath, 'utf8').split('\n');
    const entries = [];
    let current = null;

    for (const line of lines) {
      if (/^## .+\[saved\]/.test(line)) {
        if (current) entries.push(current);
        current = { header: line, chars: line.length + 1 };
      } else if (current) {
        current.chars += line.length + 1;
      }
    }
    if (current) entries.push(current);

    const last2 = entries.slice(-2);
    const HARD_CAP_CHARS = 1500; // ~375 tokens — accommodates multi-subsystem sessions
    const over = last2.filter(e => e.chars > HARD_CAP_CHARS);
    if (over.length === 0) return null;

    const totalTokens = last2.reduce((s, e) => s + Math.round(e.chars / 4), 0);
    return (
      `Session-log size warning: last 2 [saved] entries inject ~${totalTokens} tokens per session ` +
      `(target: <500). Entries over budget: ${over.map(e => e.header.trim()).join('; ')}. ` +
      `Trim to: Goal / Decisions / Rejected / Open only. Hard cap 375 tokens per entry. ` +
      `Task checklists → state.md. Speculative analysis → design docs. Test results → delete.`
    );
  } catch {
    return null;
  }
}

/**
 * Build Claude Stop hook response object from input payload.
 * Only blocks Claude's stop when actionable reminders exist (TDD, commit,
 * decision log, session-log size). Informational stats alone do not block.
 */
function evaluatePayload(data) {
  if (!data || typeof data !== 'object') return {};

  const cwd = data.cwd || process.cwd();
  const sessionId = data.session_id || null;
  const edits = getRecentEdits(sessionId);

  // Per-session file-based guard prevents infinite loop for reminder injection
  if (!shouldFire(sessionId)) return {};

  const reminders = generateReminders(edits, cwd);

  // Decision-log reminder: only when the memory workflow is actually in use
  // (session-log.md exists in cwd). Without it there is nowhere to save, so the
  // nudge would be noise every turn — the "start using memory" offer belongs to
  // the using-superpowers entry sequence, not here. Once session-log.md exists,
  // this fires only when significant files changed since the last [saved] entry.
  const memoryInUse = fs.existsSync(path.join(cwd, 'session-log.md'));
  const lastSavedTime = getLastSavedEntryTime();
  const editsSinceLastSaved = getEditsAfter(lastSavedTime, sessionId);
  if (memoryInUse && isSignificantSession(editsSinceLastSaved)) {
    reminders.push(
      'Decision log: This session modified core skill/hook/config files. ' +
      'Before stopping, invoke context-management via the Skill tool to write a [saved] entry ' +
      'capturing decisions, rationale, and rejected approaches. ' +
      'Future sessions start with zero context — this is the only way to preserve the "why".'
    );
  }

  // state.md staleness: warn if state.md exists but source files changed after it was written
  const stateStaleness = checkStateMdStaleness(cwd, edits);
  if (stateStaleness) reminders.push(stateStaleness);

  // Session-log size guard: warn if last 2 [saved] entries exceed token budget
  const sizeWarning = checkSessionLogSize(cwd);
  if (sizeWarning) reminders.push(sizeWarning);

  if (reminders.length === 0) return {};

  // Stats-only sessions don't warrant blocking Claude's stop.
  // Only block when there are actionable reminders that need Claude's attention.
  const hasActionableReminders = reminders.some(r => !r.startsWith('Session summary:'));
  if (!hasActionableReminders) return {};

  // Set guard BEFORE outputting — prevents re-entry
  setGuard(sessionId);

  const context = [
    '<stop-hook-reminders>',
    ...reminders,
    '</stop-hook-reminders>',
  ].join('\n');

  return {
    decision: 'block',
    reason: context,
  };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    process.stdout.write(JSON.stringify(evaluatePayload(data)));
  } catch {
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

export {
  checkSessionLogSize,
  checkStateMdStaleness,
  evaluatePayload,
  generateReminders,
  getEditsAfter,
  getLastSavedEntryTime,
  getRecentEdits,
  guardFile,
  isSourceFile,
  isTestFile,
  matchesSession,
  parseLogLine,
  setGuard,
  shouldFire,
};
