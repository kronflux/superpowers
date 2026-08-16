#!/usr/bin/env node
/**
 * UserPromptSubmit Hook — Proactive Skill Activation + Memory Recall
 *
 * Analyzes the user's prompt before Claude processes it and injects
 * two types of context:
 *
 * 1. Skill hints — which superpowers skills are relevant to
 *    this prompt (reinforces using-superpowers routing deterministically).
 *
 * 2. Memory recall — relevant past decisions from session-log.md that
 *    match keywords extracted from the prompt. Surfaces historical context
 *    automatically at the moment it's needed, without requiring the AI to
 *    remember to grep the log manually.
 *
 * Features:
 * - Micro-task detection: short, specific prompts skip both features entirely
 * - Confidence threshold: only suggests skills when match confidence is meaningful
 * - Memory recall: keyword-based grep of session-log.md, ≤2 entries, deduped
 * - Smart routing: fewer false positives, zero overhead for simple tasks
 *
 * Input:  stdin JSON with { prompt, session_id, cwd, ... }
 * Output: stdout JSON with additionalContext suggesting relevant skills
 *         and/or surfacing relevant past decisions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { configDir, userCandidates } from './lib/config-dir.js';

// Resolve hooks directory from this script's location
const __filename = fileURLToPath(import.meta.url);
const HOOKS_DIR = path.dirname(__filename);

// Load skill rules
let RULES = [];
try {
  const rulesPath = path.join(HOOKS_DIR, 'skill-rules.json');
  RULES = JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules || [];
} catch (e) {
  // If rules can't be loaded, hook is a no-op
  process.stdout.write('{}');
  process.exit(0);
}

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// Minimum score threshold — matches below this are discarded as noise
const CONFIDENCE_THRESHOLD = 2;

// Minimum match score before a rule's authored priority is shown. A score of
// 2 is the confidence floor a match must already clear to appear at all —
// one intent pattern, or two keywords — and means the prompt barely matched,
// so no priority is shown at the floor regardless of the rule's own tier.
// Above the floor, the authored priority is shown. `critical` additionally
// requires an intent match plus two keywords, or two intent matches, since a
// `critical` label on a bare-floor match reports a strong match when only
// the rule's author was confident.
const LABEL_MIN_SCORE = { critical: 4, high: 3, medium: 3, low: 3 };

/** One hint line: the skill, and its priority only when the score earns it. */
function renderMatch(m) {
  const min = LABEL_MIN_SCORE[m.priority];
  const labelled = typeof min === 'number' && m.score >= min;
  return labelled
    ? `  - superpowers:${m.skill} (${m.priority})`
    : `  - superpowers:${m.skill}`;
}

// ── Memory recall constants ───────────────────────────────────────────────────
const MAX_MEMORY_ENTRIES = 2;    // Never inject more than 2 matched entries
const MIN_KEYWORD_LENGTH = 4;   // Skip tokens shorter than this
const MAX_ENTRY_CHARS = 1500;   // Truncate oversized entries (~250 words / ~375 tokens)

// Common English words that produce noisy false-positive matches
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'this', 'that',
  'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'all', 'both', 'each', 'every', 'any', 'some', 'not', 'only',
  'than', 'too', 'very', 'just', 'now', 'also', 'but', 'and', 'or',
  'if', 'then', 'so', 'let', 'get', 'got', 'go', 'make', 'know',
  'think', 'see', 'look', 'use', 'using', 'used', 'like', 'want',
  'need', 'please', 'here', 'there', 'about', 'more', 'other', 'new',
  'good', 'right', 'well', 'really', 'actually', 'already', 'still',
  'even', 'back', 'thing', 'things', 'way', 'work', 'works', 'worked',
]);

/**
 * Detect micro-tasks that should skip skill routing entirely.
 * Returns true if the prompt is clearly a small, specific action.
 */
function isMicroTask(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;

  const lower = prompt.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Very short prompts with specific action words are likely micro-tasks
  if (wordCount <= 8) {
    const microPatterns = [
      /^(fix|change|rename|update|replace|set|remove|delete|add)\s+(the\s+)?(typo|name|variable|import|spacing|indent)/i,
      /^rename\s+\S+\s+to\s+\S+$/i,
      /^(change|update|set)\s+.+\s+(to|=)\s+.+$/i,
      /^remove\s+(the\s+)?(unused|extra|duplicate)\s+/i,
      /^add\s+(a\s+)?(missing\s+)?(import|comma|semicolon|bracket|paren)/i,
      /^fix\s+(the\s+)?(typo|spelling|whitespace|indent(ation)?)/i,
    ];

    if (microPatterns.some(p => p.test(lower))) {
      return true;
    }
  }

  // Single-line file reference with small action
  if (wordCount <= 12 && /line\s+\d+/i.test(lower) && /(fix|change|update|rename|remove)/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Score a prompt against skill rules.
 * Returns matched rules sorted by priority, max 3.
 * Applies confidence threshold to filter weak matches.
 */
function matchSkills(prompt) {
  if (!prompt || typeof prompt !== 'string') return [];

  const lower = prompt.toLowerCase();
  const matches = [];

  for (const rule of RULES) {
    let score = 0;

    // Check keywords (case-insensitive, left-boundary aware)
    for (const kw of rule.keywords || []) {
      const kwLower = kw.toLowerCase();
      // Multi-word keywords: use substring match (boundary is implicit)
      // Single-word keywords: use left word boundary to avoid partial matches
      // (e.g. "fix" in "prefix") while still allowing inflected forms (e.g. "errors" for "error")
      if (kwLower.includes(' ')) {
        if (lower.includes(kwLower)) score += 1;
      } else {
        const re = new RegExp(`\\b${kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        if (re.test(lower)) score += 1;
      }
    }

    // Check intent patterns (regex)
    for (const pattern of rule.intentPatterns || []) {
      try {
        const re = new RegExp(pattern, 'i');
        if (re.test(prompt)) {
          score += 2; // Intent patterns weighted higher
        }
      } catch {
        // Skip invalid regex
      }
    }

    // Apply confidence threshold — single keyword matches are noise
    if (score >= CONFIDENCE_THRESHOLD) {
      matches.push({
        skill: rule.skill,
        priority: rule.priority,
        type: rule.type,
        score,
      });
    }
  }

  // Sort by priority (critical first), then by score (highest first)
  matches.sort((a, b) => {
    const pDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (pDiff !== 0) return pDiff;
    return b.score - a.score;
  });

  return matches.slice(0, 3);
}

/**
 * Build the context injection message for matched skills.
 */
function buildContext(matches) {
  if (matches.length === 0) return null;

  const skillList = matches
    .map(renderMatch)
    .join('\n');

  return [
    '<user-prompt-submit-hook>',
    'Skill activation hint: The following skills are relevant to this prompt.',
    'Remember: invoke superpowers:using-superpowers FIRST as the mandatory entry point,',
    'then follow its routing to these suggested skills:',
    skillList,
    'IMPORTANT: If the user names a skill directly (e.g. "use brainstorming"), invoke it via the Skill tool.',
    'Do NOT re-implement the skill\'s purpose with ad-hoc agents or manual steps.',
    '</user-prompt-submit-hook>',
  ].join('\n');
}

// ── Memory recall ─────────────────────────────────────────────────────────────

/**
 * Extract distinctive keywords from a prompt for session-log searching.
 * Strips stop words, punctuation (preserving hyphens), and short tokens.
 * Returns a deduplicated array of lowercase keyword strings.
 */
function extractKeywords(prompt) {
  if (!prompt || typeof prompt !== 'string') return [];

  const tokens = prompt
    .toLowerCase()
    // Remove punctuation except hyphens (preserves compound terms like "session-log")
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(t));

  return [...new Set(tokens)];
}

/**
 * Search session-log.md for [saved] entries matching the given keywords.
 * Skips [superseded] entries. Returns up to MAX_MEMORY_ENTRIES matches,
 * most recent first. Each entry is trimmed to MAX_ENTRY_CHARS.
 *
 * A match requires at least 1 keyword hit in the entry text.
 * (Threshold is low because keywords are already filtered for distinctiveness.)
 */
function searchSessionLog(cwd, keywords) {
  if (!keywords || keywords.length === 0) return [];

  const logPath = path.join(cwd, 'session-log.md');
  let content;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch {
    return []; // File absent — silent no-op
  }

  // Parse file into individual [saved] entries (preserve order: oldest first)
  const entries = [];
  let current = null;

  for (const line of content.split('\n')) {
    if (/^## .+\[saved\]/.test(line)) {
      // Flush previous entry
      if (current !== null) entries.push(current.trim());
      // Skip superseded entries — they represent overturned decisions
      if (/\[superseded/.test(line)) {
        current = null;
      } else {
        current = line;
      }
    } else if (current !== null) {
      current += '\n' + line;
    }
  }
  // Flush last entry
  if (current !== null) entries.push(current.trim());

  if (entries.length === 0) return [];

  // Weighted scoring: keyword density (70%) + recency (30%)
  // Replaces flat boolean matching to reduce false positives and surface
  // the most relevant entries, not just the most recent ones.
  const scored = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryLower = entry.toLowerCase();
    const hits = keywords.filter(kw => entryLower.includes(kw)).length;
    if (hits === 0) continue;

    const densityScore = hits / keywords.length;
    const recencyScore = (i + 1) / entries.length;
    const score = (densityScore * 0.7) + (recencyScore * 0.3);
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_MEMORY_ENTRIES).map(s => {
    const text = s.entry.length > MAX_ENTRY_CHARS
      ? s.entry.slice(0, MAX_ENTRY_CHARS).trimEnd() + '\n*(entry truncated)*'
      : s.entry;
    return { text, score: s.score };
  });
}

/**
 * Format matched session-log entries for injection as additional context.
 */
function buildMemoryContext(entries) {
  if (!entries || entries.length === 0) return null;

  return [
    '<session-memory-recall>',
    'Relevant past decisions matching this prompt (from session-log.md):',
    '',
    entries.join('\n\n'),
    '',
    '*(Full history searchable in session-log.md)*',
    '</session-memory-recall>',
  ].join('\n');
}

// ── Known-issues recall ───────────────────────────────────────────────────────

/**
 * Search known-issues.md for open (non-fixed) entries matching the given keywords.
 * Fixed entries (## ~~...~~) are skipped. Returns up to MAX_MEMORY_ENTRIES matches,
 * most recent first. Each entry is trimmed to MAX_ENTRY_CHARS.
 */
function searchKnownIssues(cwd, keywords) {
  if (!keywords || keywords.length === 0) return [];

  const filePath = path.join(cwd, 'known-issues.md');
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return []; // File absent — silent no-op
  }

  // Parse into open entries (skip fixed entries with ## ~~ header)
  const entries = [];
  let current = null;

  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      if (current !== null) entries.push(current.trim());
      // Fixed entries have strikethrough: ## ~~...~~
      current = line.startsWith('## ~~') ? null : line;
    } else if (current !== null) {
      current += '\n' + line;
    }
  }
  if (current !== null) entries.push(current.trim());

  if (entries.length === 0) return [];

  // Weighted scoring: keyword density (70%) + recency (30%)
  const scored = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryLower = entry.toLowerCase();
    const hits = keywords.filter(kw => entryLower.includes(kw)).length;
    if (hits === 0) continue;

    const densityScore = hits / keywords.length;
    const recencyScore = (i + 1) / entries.length;
    const score = (densityScore * 0.7) + (recencyScore * 0.3);
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_MEMORY_ENTRIES).map(s => {
    const text = s.entry.length > MAX_ENTRY_CHARS
      ? s.entry.slice(0, MAX_ENTRY_CHARS).trimEnd() + '\n*(entry truncated)*'
      : s.entry;
    return { text, score: s.score };
  });
}

/**
 * Format matched known-issues entries for injection as additional context.
 */
function buildKnownIssuesContext(entries) {
  if (!entries || entries.length === 0) return null;

  return [
    '<known-issues-recall>',
    'Relevant known issues matching this prompt (from known-issues.md):',
    '',
    entries.join('\n\n'),
    '',
    '*(Full list in known-issues.md)*',
    '</known-issues-recall>',
  ].join('\n');
}

// ── Context pressure gate ─────────────────────────────────────────────────────

/**
 * Patterns that indicate the user is about to start plan execution
 * or heavy implementation work.
 */
const EXECUTION_TRIGGER_PATTERNS = [
  /\bexecute\s+(the\s+)?plan\b/i,
  /\bstart\s+build(ing)?\b/i,
  /\bstart\s+implement(ing|ation)?\b/i,
  /\bfollow\s+(the\s+)?plan\b/i,
  /\bimplement\s+(the\s+)?plan\b/i,
  /\blet'?s\s+(build|implement|execute)\b/i,
  /\brun\s+(the\s+)?plan\b/i,
  /\bbegin\s+implement(ing|ation)?\b/i,
  /\bbegin\s+(the\s+)?plan\b/i,
];

const CONTEXT_WINDOW_SIZE = parseInt(process.env.SUPERPOWERS_CONTEXT_WINDOW, 10) || 200000; // configurable context window tokens
const CONTEXT_PRESSURE_THRESHOLD = 0.60; // Hard block at 60%

/**
 * Returns true if the prompt is triggering plan execution or heavy implementation.
 */
function isExecutionTrigger(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  return EXECUTION_TRIGGER_PATTERNS.some(p => p.test(prompt));
}

/**
 * Convert a filesystem cwd path to the Claude Code project directory name.
 * Examples:
 *   Windows: "C:\Users\Tjerk Pieksma\..." → "c--Users-Tjerk-Pieksma-..."
 *   Unix:    "/home/user/projects/foo"    → "home-user-projects-foo"
 */
function cwdToProjectDir(cwd) {
  return cwd
    .replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase() + '-') // C: → c-
    .replace(/[/\\]/g, '-')  // path separators → -
    .replace(/\s/g, '-')     // spaces → -
    .replace(/-+$/, '');     // trim trailing dashes
}

/**
 * Read the current session JSONL and return context pressure info.
 * Uses the last assistant turn's total input tokens as the context size estimate —
 * this is the most accurate indicator of how much context window is currently occupied.
 * Returns null if the JSONL can't be read or has no usable data.
 */
function getContextPressure(cwd, sessionId) {
  if (!sessionId) return null;

  const projectDir = cwdToProjectDir(cwd);
  const candidates = userCandidates(['projects', projectDir, sessionId + '.jsonl'], process.env);

  let content = null;
  for (const candidate of candidates) {
    try {
      content = fs.readFileSync(candidate, 'utf8');
      break;
    } catch {
      // Try the next candidate (legacy home fallback)
    }
  }
  if (content === null) return null; // No candidate readable — silent no-op

  // Use the last assistant turn's input total as context size.
  // input + cache_creation + cache_read = total tokens in context window for that turn.
  // Later turns always have more context, so the last value is the current state.
  let lastInputTotal = 0;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'assistant' && obj.message && obj.message.usage) {
        const u = obj.message.usage;
        const turnInput = (u.input_tokens || 0)
          + (u.cache_creation_input_tokens || 0)
          + (u.cache_read_input_tokens || 0);
        if (turnInput > 0) lastInputTotal = turnInput;
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (lastInputTotal === 0) return null;

  const ratio = lastInputTotal / CONTEXT_WINDOW_SIZE;
  return {
    inputK: Math.round(lastInputTotal / 1000),
    percent: Math.round(ratio * 100),
    overThreshold: ratio >= CONTEXT_PRESSURE_THRESHOLD,
  };
}

/**
 * Build the hard block message injected when context pressure ≥60%.
 * Returned as additionalContext — Claude sees this instead of skill hints.
 */
function buildContextPressureBlock(pressure) {
  return [
    '<context-pressure-gate>',
    `STOP — Do not start implementation yet.`,
    ``,
    `Context window: ~${pressure.inputK}K tokens consumed (${pressure.percent}% of 200K limit).`,
    `Starting implementation at ≥60% risks Auto Compact firing mid-task, destroying`,
    `variable names, file paths, and discovered facts at the worst possible moment.`,
    ``,
    `Required actions before proceeding:`,
    `1. Invoke the context-management skill to write state.md. Include:`,
    `   - Path to the plan file`,
    `   - Starting task number (e.g. "Task 1 — fresh start")`,
    `   - Any research-phase facts (exact file paths, variable names, non-obvious`,
    `     constraints) that the plan references but does not spell out explicitly.`,
    `2. Tell the user: "Context is at ${pressure.percent}%. Saving state and compacting`,
    `   before implementation — this prevents Auto Compact firing mid-task."`,
    `3. Run /compact.`,
    `4. After compaction, read state.md and resume with executing-plans.`,
    ``,
    `Do NOT begin implementation without completing steps 1–3.`,
    `</context-pressure-gate>`,
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Injection cap + telemetry ─────────────────────────────────────────────────

// Hard ceiling on total hook-injected context per prompt. Skill hints are never
// dropped; the memory/known-issues sections are shed lowest-relevance-first until
// the combined payload fits.
const INJECTION_CAP_BYTES = 4000;

function capInjection(blocks /* [{text, score}] sorted desc by score */) {
  // Account for the '\n\n' separators added when blocks are joined.
  let total = blocks.reduce((n, b) => n + Buffer.byteLength(b.text), 0)
    + 2 * Math.max(0, blocks.length - 1);
  while (total > INJECTION_CAP_BYTES && blocks.length > 1) {
    const dropped = blocks.pop();                 // lowest-scored last
    total -= Buffer.byteLength(dropped.text) + 2; // block plus its separator
  }
  return blocks;
}

// Accumulate telemetry into the same session-stats.json that track-session-stats.js
// maintains (same file path and 2-hour expiry convention) — the mechanism by which
// this UserPromptSubmit hook and that PostToolUse hook, running as separate
// processes, share session state: this hook records which skills were hinted and
// that hook, seeing the same file, can tell whether a later Skill invocation
// converts one of them.
// Deliberately self-contained — no import from track-session-stats.js — so a
// missing or changed sibling module can never crash this hook at load time.
// Fail-open: all IO errors are swallowed.
const STATS_EXPIRY_MS = 2 * 60 * 60 * 1000;

function loadOrInitSessionStats(logDir, statsFile) {
  let stats = null;
  try {
    stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  } catch {
    // Absent or corrupt — start fresh below
  }
  // Mirror track-session-stats.js: auto-expire stats after 2 hours (new session)
  if (!stats || !stats.startedAt
      || (Date.now() - new Date(stats.startedAt).getTime()) > STATS_EXPIRY_MS) {
    stats = {
      startedAt: new Date().toISOString(),
      skillInvocations: {},
      totalSkillCalls: 0,
      hookBlocks: 0,
      filesEdited: 0,
      verificationsRun: 0,
      hintsEmitted: 0,
      hintedSkills: [],
      hintsConverted: 0,
    };
  }
  return stats;
}

function writeSessionStats(logDir, statsFile, stats) {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

function recordInjectedBytes(bytes) {
  if (!bytes) return;
  try {
    const logDir = path.join(configDir(process.env), 'hooks-logs');
    const statsFile = path.join(logDir, 'session-stats.json');
    const stats = loadOrInitSessionStats(logDir, statsFile);
    stats.injectedBytes = (stats.injectedBytes || 0) + bytes;
    writeSessionStats(logDir, statsFile, stats);
  } catch {
    // Telemetry is best-effort; swallow all IO errors.
  }
}

// Records one emitted hint block and the skills it named, so hintsConverted
// can later be computed from the same session-stats.json when a Skill
// invocation names a skill already present in hintedSkills.
function recordHintTelemetry(matches) {
  if (!matches || matches.length === 0) return;
  try {
    const logDir = path.join(configDir(process.env), 'hooks-logs');
    const statsFile = path.join(logDir, 'session-stats.json');
    const stats = loadOrInitSessionStats(logDir, statsFile);
    stats.hintsEmitted = (stats.hintsEmitted || 0) + 1;
    const hinted = new Set(stats.hintedSkills || []);
    for (const m of matches) hinted.add(m.skill);
    stats.hintedSkills = [...hinted];
    writeSessionStats(logDir, statsFile, stats);
  } catch {
    // Telemetry is best-effort; swallow all IO errors.
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const prompt = data.prompt || '';
    const cwd = data.cwd || process.cwd();
    const sessionId = data.session_id || null;

    // Micro-task fast path: skip all enrichment entirely
    if (isMicroTask(prompt)) {
      process.stdout.write('{}');
      return;
    }

    // Context pressure gate: if the user is about to start implementation and
    // the context window is ≥60% full, block and require compact-first.
    // Returns early — pressure block replaces all other hints when it fires.
    if (isExecutionTrigger(prompt)) {
      const pressure = getContextPressure(cwd, sessionId);
      if (pressure && pressure.overThreshold) {
        const pressureBlock = buildContextPressureBlock(pressure);
        recordInjectedBytes(Buffer.byteLength(pressureBlock));
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: pressureBlock,
          },
        }));
        return;
      }
    }

    // Run all pipelines independently
    const matches = matchSkills(prompt);
    const keywords = extractKeywords(prompt);
    const memoryEntries = searchSessionLog(cwd, keywords);
    const knownIssueEntries = searchKnownIssues(cwd, keywords);

    const skillContext = buildContext(matches);
    const memoryContext = buildMemoryContext(memoryEntries.map(e => e.text));
    const knownIssuesContext = buildKnownIssuesContext(knownIssueEntries.map(e => e.text));

    if (skillContext) recordHintTelemetry(matches);

    // Nothing to inject
    if (!skillContext && !memoryContext && !knownIssuesContext) {
      process.stdout.write('{}');
      return;
    }

    // Combine: skill hint first (routing), known issues second (avoid known errors),
    // memory last (historical context). Assemble as scored blocks so total injection
    // can be capped: skill hints are never dropped (Infinity); the memory/known-issues
    // sections carry their most-relevant entry's score and are shed lowest-first.
    const topScore = (entries) => entries.reduce((m, e) => Math.max(m, e.score), 0);
    const blocks = [];
    if (skillContext) blocks.push({ text: skillContext, score: Infinity, order: 0 });
    if (knownIssuesContext) blocks.push({ text: knownIssuesContext, score: topScore(knownIssueEntries), order: 1 });
    if (memoryContext) blocks.push({ text: memoryContext, score: topScore(memoryEntries), order: 2 });

    blocks.sort((a, b) => b.score - a.score); // desc by score for capInjection
    const kept = capInjection(blocks);
    kept.sort((a, b) => a.order - b.order);   // restore display order
    const combined = kept.map(b => b.text).join('\n\n');

    recordInjectedBytes(Buffer.byteLength(combined));

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: combined,
      },
    }));
  } catch {
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main();
}

export {
  matchSkills,
  buildContext,
  isMicroTask,
  extractKeywords,
  searchSessionLog,
  buildMemoryContext,
  searchKnownIssues,
  buildKnownIssuesContext,
  isExecutionTrigger,
  cwdToProjectDir,
  getContextPressure,
  buildContextPressureBlock,
  capInjection,
  INJECTION_CAP_BYTES,
  RULES,
  CONFIDENCE_THRESHOLD,
  LABEL_MIN_SCORE,
  renderMatch,
  STOP_WORDS,
  MAX_MEMORY_ENTRIES,
  CONTEXT_WINDOW_SIZE,
  CONTEXT_PRESSURE_THRESHOLD,
};
