import { describe, it, expect } from 'vitest';
import { classifyComment, extractComments } from '../hooks/lib/comment-patterns.js';

// The spec's generic BAD examples plus the four real narration violations
// this repo carried in hooks/stop-reminders.js and tests/stop-reminders.test.js.
const MUST_FLAG = [
  'Added retry logic to handle unstable network',
  'Refactored to support multi-tenant user IDs',
  'Added a fallback because the primary DB keeps dropping connections during load tests.',
  'Mocking the auth payload here so we can test the frontend locally.',
  'WIP - still adjusting this function to handle negative integers.',
  'TODO: Rewrite this string matching later, it\'s a temporary hack for the demo.',
  'Coverage was broadened (corpus-tested against real report prose)',
  'A later review found the broadened list misfired on ordinary prose',
  'moving on to shipped with zero corpus coverage and turned out to be an idiom',
  'it turned out to be a paragraph-transition idiom, not a commitment',
];

// The spec's generic GOOD examples plus the two present-state comments a
// naive word list denies.
const MUST_NOT_FLAG = [
  'Returns null if the payload is empty',
  'Executes network request with 3 exponential backoff retries',
  'Retrieves user records isolated by the specified tenant ID',
  'Returns cached configuration data if the primary database connection fails.',
  'Generates a static JWT payload for unauthenticated sessions.',
  'Calculates the absolute sum of the array. Only supports positive integers.',
  'Parses the XML payload using exact string matching. Does not validate XML schema.',
  // Both describe present state; a bare "fixed" word match denies both.
  'Fixed entries have strikethrough: ## ~~...~~',
  'Fixed session key so the test client can authenticate',
];

// Comments that must never be flagged, collected from real source rather
// than written to fit the patterns. Sources and language, by index range:
//   0-7    this repo, JavaScript (hooks/lib/*.js, scripts/*.js)
//   8-9    this repo, JavaScript (hooks/skill-activator.js)
//   10     this repo, JavaScript (tests/brainstorm-server/server.test.js)
//   11-15  this repo, Bash (skills/brainstorming/scripts/start-server.sh)
//   16-18  foreign, JavaScript (context-mode Cloudflare Worker router)
//   19-27  foreign, TypeScript (codegraph src)
//   28-35  foreign, Python (claude-code hookify plugin)
//   36-37  hand-written hard cases naming "test" and failure handling
const NEGATIVE_CORPUS = [
  // hooks/lib/*.js, scripts/*.js — this repo
  'Advertised is not installed: a marketplace lists every plugin it offers',
  'Malformed JSON -> fail open.',
  'Fail open. A cleanup routine must never be the reason a session fails to start.',
  'First existing file wins entirely; invalid content -> dormant.',
  'Silently ignore — never block a hook',
  'Never create or write through a symlinked root: an attacker who',
  'Logging is best-effort; never let it break routing resolution.',
  'cache write failure is non-fatal',
  // hooks/skill-activator.js — this repo
  'Parse into open entries (skip fixed entries with ## ~~ header)',
  'Fixed entries have strikethrough: ## ~~...~~',
  // tests/brainstorm-server/server.test.js — this repo
  'Fixed session key so the test client can authenticate (see auth.test.js for the security behavior itself; here we just need authorized requests).',
  // skills/brainstorming/scripts/start-server.sh — this repo, Bash
  'Starts server on a random high port, outputs JSON with URL.',
  'Each session gets its own directory to avoid conflicts.',
  'Kill any existing server',
  'Resolve the harness PID (grandparent of this script).',
  '$PPID is the ephemeral shell the harness spawned to run us — it dies',
  // ../_reference/context-mode — foreign, JavaScript Cloudflare Worker
  'context-mode.com router — Master at /, Context Saving at /context-saving, Insight at /insight.',
  '/oss is preserved as a 301 redirect to /context-saving for backwards compatibility.',
  'platform.context-mode.com is the SPA app (separate deployment) — sign-in / dashboard. This worker only handles marketing routing + asset fallthrough.',
  // ../_reference/codegraph/src — foreign, TypeScript
  "Cap the injection so a large-repo explore can't flood the prompt.",
  'Create suffix keys so both "Module.Class.Method" and "Class.Method" can resolve.',
  'SQLite re-write hot B-tree pages into the main DB file inline',
  'Go receivers resolve strictly via validated field-hop',
  "Recurse into children at the same depth (they're part of the same symbol)",
  "Block CodeGraph on Node.js 25.x — V8's turboshaft WASM JIT has a Zone allocator bug that reliably crashes when compiling tree-sitter grammars (see #54, #81, #140).",
  'Enforce the supported Node floor.',
  'Lazy-load heavy modules (CodeGraph, runInstaller) to keep CLI startup fast.',
  'Persist V8 compile artifacts across runs (Node >= 22.8).',
  // ../_reference/claude-code/plugins/hookify — foreign, Python
  'Concatenate all edits',
  'Read transcript file if path provided',
  'Use cached compiled regex (LRU cache with max 128 patterns)',
  'ALWAYS exit 0 - never block operations due to hook errors',
  'Check tool matcher if specified',
  'Determine event type based on tool',
  'Apply operator',
  'Evaluate rules',
  // Hand-written hard cases: legitimate "test" usage and failure handling.
  'Returns a stub client for tests',
  'Returns null when parsing fails',
];

describe('classifyComment', () => {
  it.each(MUST_FLAG)('flags: %s', (line) => {
    expect(classifyComment(line), line).not.toBeNull();
  });

  it.each(MUST_NOT_FLAG)('allows: %s', (line) => {
    expect(classifyComment(line), line).toBeNull();
  });

  it('is silent on the whole negative corpus', () => {
    const flagged = NEGATIVE_CORPUS.filter((c) => classifyComment(c));
    expect(flagged, `flagged ${flagged.length} legitimate comments`).toEqual([]);
  });

  it('is silent on non-string and empty input', () => {
    expect(classifyComment('')).toBeNull();
    expect(classifyComment(undefined)).toBeNull();
  });
});

describe('extractComments', () => {
  it('pulls // and # bodies, ignoring string literals containing them', () => {
    expect(extractComments('const u = "http://x"; // Returns the URL'))
      .toEqual(['Returns the URL']);
  });

  it('pulls # comment bodies, ignoring a # inside a quoted string', () => {
    expect(extractComments('echo "a#b"  # Starts the background job'))
      .toEqual(['Starts the background job']);
  });

  it('collects comments across multiple lines, skipping code-only lines', () => {
    const block = [
      'function add(a, b) {',
      '  // Returns the sum of two numbers',
      '  return a + b;',
      '}',
    ].join('\n');
    expect(extractComments(block)).toEqual(['Returns the sum of two numbers']);
  });
});
