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

/** True when the path resolves to a location inside cwd. */
function isWithinRepo(filePath, cwd) {
  if (!cwd) return true;
  const rel = path.relative(path.resolve(cwd), path.resolve(filePath));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * True for a non-test, non-config source file that lives inside the session
 * repository. Containment against cwd is what excludes scratch: a probe
 * written to the temp root is outside the repository, while a repository
 * that happens to be checked out under the temp root is still the
 * repository. Without a cwd there is nothing to contain against, so the
 * extension match alone decides, exactly as before this change.
 */
function isSourceFile(filePath, cwd) {
  if (!SOURCE_PATTERNS.some(p => p.test(filePath))) return false;
  if (CONFIG_PATTERNS.some(p => p.test(filePath))) return false;
  if (!cwd) return true;
  return isWithinRepo(filePath, cwd);
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

// Forward-commitment guard (Task 4): catches a turn whose final message
// promises action ("I'll now", "proceeding to", "writing X now", "let me
// start") but that recorded no file-changing tool use. Kept short and
// literal on purpose — a broad regex fires on ordinary prose, and a
// reminder that fires constantly gets ignored. Errs toward silence: a false
// nudge on a turn legitimately blocked on the operator ("I'll do X once you
// answer") is worse than a missed one.
//
// Two patterns are deliberately excluded, so a future pass does not
// "complete" the list by adding them back:
//   - /\bhere (?:is|are|we go)(?: with)? the (?:code|script|implementation|
//     updated|requested)\b/i — this *presents* work rather than promising
//     it. "Here is the code" usually precedes delivered content; firing on
//     it would block a turn that already delivered exactly what was asked.
//   - /\bi can (?:certainly|definitely) (?:help|do|write|generate)\b/i —
//     sycophancy, not a did-you-do-the-work signal. Belongs to the
//     banned-vocabulary purity gate, not this guard.
//
// Patterns require a same-clause "now" or a narrow, deliverable-naming verb
// rather than a bare topic-transition or opener phrasing (see the "report
// corpus stays silent" and "innocent conversational prose stays silent"
// describe blocks):
//   - "moving on to" is not matched: it is a paragraph-transition idiom
//     ("Moving on to the tradeoffs, the second approach..."), not a
//     commitment marker.
//   - Bare "proceeding to/on/with" is not matched; only "proceeding ...
//     now" in the same clause is, mirroring the writing/generating pattern
//     below — the bare form occurs on ordinary topic transitions
//     ("Proceeding to the next section, the article covers...").
//   - "let me start/now/begin", "let's dive in/start/begin", and "allow me
//     to start/begin" are not matched; only verbs naming a concrete
//     deliverable (write/generate/implement/create/handle/go ahead) are —
//     the broader forms occur in ordinary explanatory openers ("Let me
//     start by explaining...", "Let's dive in: the reason this fails...",
//     "Allow me to start with the constraints...").
const FORWARD_COMMITMENT_PATTERNS = [
  /\bi'll now\b/i,
  /\bi will now\b/i,
  /\bstarting now\b/i,
  // "writing ... now" within a short, same-clause span (no sentence break).
  /\bwriting\b[^.\n]{0,40}\bnow\b/i,
  /\bi(?:'ll| will) (?:now|go ahead|start|begin|generate|write|create|implement|update|proceed)\b/i,
  /\blet me (?:go ahead|write|generate|implement|create|handle)\b/i,
  /\b(?:i'm|i am) going to (?:start|begin|generate|write|create|implement|update|proceed)\b/i,
  /\blet's (?:get started|implement|write|create)\b/i,
  // Requires "now" in the same clause as "proceeding", mirroring the
  // writing/generating tightening below, instead of matching bare
  // "proceeding to/on/with" (fires on ordinary topic transitions).
  /\bproceeding\b[^.\n]{0,40}\bnow\b/i,
  /\b(?:starting|beginning) now\b/i,
  /\ballow me to (?:write|generate|implement|create)\b/i,
  // A verb matched anywhere in the message, with "now"/"for you" anywhere
  // after it, is indistinguishable from mid-sentence past-tense status
  // reporting (see the mid-sentence past-tense reporting test below). The
  // verb must open the message or a sentence, or follow a first-person
  // "I'm"/"I am", so only an announcement is caught, not a status update
  // embedded mid-sentence.
  /(?:^|(?<=[.!?\n]\s)|(?<=\bi(?:'m|m| am) ))(?:writing|generating|creating|implementing|updating|working on)\b[^.\n]{0,40}\b(?:now|for you)\b/i,
];

const FILE_CHANGING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash']);

const UNFULFILLED_COMMITMENT_REMINDER =
  'You announced work in this turn and the turn ended without doing it. ' +
  'If you are blocked on the operator, say what you need. Otherwise, do it now.';

/**
 * Pure check: does finalMessage contain a forward commitment with no
 * file-changing tool use recorded in toolUses? Returns the reminder string,
 * or '' when there is nothing to flag. Never throws — any internal fault
 * (bad shape, etc.) resolves to '' so the hook fails open.
 */
function checkForwardCommitment({ finalMessage, toolUses } = {}) {
  try {
    if (typeof finalMessage !== 'string' || !finalMessage) return '';
    if (!FORWARD_COMMITMENT_PATTERNS.some((re) => re.test(finalMessage))) return '';
    const uses = Array.isArray(toolUses) ? toolUses : [];
    const changedFiles = uses.some((t) => t && FILE_CHANGING_TOOLS.has(t.name));
    if (changedFiles) return '';
    return UNFULFILLED_COMMITMENT_REMINDER;
  } catch {
    return '';
  }
}

/**
 * Return true if a transcript entry is a real, human-authored user turn
 * (as opposed to a tool_result, which the API also represents as a "user"
 * role message). Used to find where the current turn began.
 */
function isRealUserMessage(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.some((b) => b && b.type !== 'tool_result');
}

/**
 * Scan the transcript backward from the end to collect the current turn's
 * final assistant text and every tool_use recorded since the last real user
 * message. Returns { finalMessage, toolUses } or null on any read/parse
 * fault (missing file, malformed JSON, unexpected shape) — callers treat
 * null the same as "nothing to flag".
 */
function getLastTurnData(transcriptPath) {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
    let finalMessage = '';
    let foundFinalText = false;
    const toolUses = [];

    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue; // one malformed line poisons only itself
      }
      if (!entry || typeof entry !== 'object') continue;

      if (entry.type === 'user' && isRealUserMessage(entry)) break;
      if (entry.type !== 'assistant') continue;

      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          toolUses.push({ name: block.name });
        }
      }

      if (!foundFinalText) {
        const textParts = content
          .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text);
        if (textParts.length > 0) {
          finalMessage = textParts.join('\n');
          foundFinalText = true;
        }
      }
    }

    return { finalMessage, toolUses };
  } catch {
    return null;
  }
}

/**
 * The path a `git status --porcelain` line refers to. The two-character
 * status and its trailing space are dropped; a rename renders as
 * `old -> new` and resolves to the new path.
 */
function parsePorcelainPath(line) {
  const p = line.slice(3).trim();
  const arrow = p.lastIndexOf(' -> ');
  return arrow === -1 ? p : p.slice(arrow + 4);
}

/** Repository-relative paths reported dirty by git, or [] on any fault. */
function getUncommittedPaths(cwd) {
  try {
    const result = spawnSync('git', ['status', '--porcelain'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status !== 0 || result.error) return [];
    return (result.stdout || '')
      .split('\n')
      .filter(l => l.trim().length > 0)
      .map(parsePorcelainPath);
  } catch {
    return [];
  }
}

/**
 * Session-edited paths, expressed relative to cwd in git's own format, that
 * git also reports dirty. Both the TDD reminder and the commit reminder
 * derive their counts from this intersection rather than from the edit log
 * alone, so a path written and then reverted to its committed bytes, or
 * written outside the repository, never contributes to either count. A git
 * failure or a non-repository cwd yields no dirty paths at all, so both
 * reminders go silent rather than falling back to an edit-log count.
 */
function getUncommittedSessionPaths(cwd, editedPaths, dirtyPaths) {
  const dirty = dirtyPaths || getUncommittedPaths(cwd);
  const base = path.resolve(cwd || '.');
  const edited = new Set(
    (editedPaths || []).map(p =>
      path.relative(base, path.resolve(p)).split(path.sep).join('/')
    )
  );
  return dirty.filter(d => edited.has(d));
}

/**
 * Count of dirty paths that this session also edited. Scoping to session
 * edits keeps a reminder about the operator's own work from counting a
 * working tree another agent left dirty.
 */
function getUncommittedSessionCount(cwd, editedPaths, dirtyPaths) {
  return getUncommittedSessionPaths(cwd, editedPaths, dirtyPaths).length;
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
  const dirtyPaths = getUncommittedPaths(cwd);
  const dirtySessionPaths = getUncommittedSessionPaths(cwd, editedPaths, dirtyPaths);

  // TDD reminder: non-test source files this session both edited and left
  // dirty in git, with no dirty test file alongside them. Deriving from git
  // status (via dirtySessionPaths above) rather than the edit log means a
  // clean tree never fires this regardless of how many Write/Edit calls the
  // session made, and a file written then reverted to its committed bytes
  // drops out once its diff disappears. Untracked (newly created) source
  // files count the same as modified ones — new code with no test coverage
  // is the same "behavior changed, tests didn't" signal — so the wording
  // says "changed" rather than "modified" to match what is counted.
  const dirtySourceFiles = dirtySessionPaths.filter(p => {
    const abs = path.join(cwd || '.', p);
    return isSourceFile(abs, cwd) && !isTestFile(p);
  });
  const dirtyTestFiles = dirtySessionPaths.filter(isTestFile);
  if (dirtySourceFiles.length > 0 && dirtyTestFiles.length === 0) {
    reminders.push(
      `TDD reminder: ${dirtySourceFiles.length} source file(s) changed without test changes. ` +
      `Consider running tests or invoking TDD workflow if behavior changed.`
    );
  }

  // Commit reminder: only files this session touched and left dirty.
  if (editedPaths.length >= 5) {
    const uncommittedCount = dirtySessionPaths.length;
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
      new Date(e.timestamp).getTime() > stateMtime && isSourceFile(e.filePath, cwd)
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

  // Forward-commitment guard: the turn's final text promises action but no
  // file-changing tool ran this turn. See checkForwardCommitment above.
  const transcriptPath = data.transcript_path;
  if (typeof transcriptPath === 'string' && transcriptPath) {
    const turn = getLastTurnData(transcriptPath);
    if (turn) {
      const commitmentReminder = checkForwardCommitment(turn);
      if (commitmentReminder) reminders.push(commitmentReminder);
    }
  }

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
  checkForwardCommitment,
  checkSessionLogSize,
  checkStateMdStaleness,
  evaluatePayload,
  generateReminders,
  getEditsAfter,
  getLastSavedEntryTime,
  getLastTurnData,
  getRecentEdits,
  getUncommittedPaths,
  getUncommittedSessionCount,
  getUncommittedSessionPaths,
  guardFile,
  isRealUserMessage,
  isSourceFile,
  isTestFile,
  isWithinRepo,
  matchesSession,
  parseLogLine,
  parsePorcelainPath,
  setGuard,
  shouldFire,
};



