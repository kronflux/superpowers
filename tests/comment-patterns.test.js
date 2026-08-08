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
  // Impermanence constructions: "temporary"/"hack" as an intended-to-leave
  // state, not as ordinary vocabulary.
  'Temporary hack until the API stabilises',
  'this is temporary, remove after migration',
  'hacky workaround for the date parser',
  // Narration constructions: a change explained by its cause, not a
  // behavior. Impermanence constructions: deferred work and ticket refs.
  'Adding a guard here because the API returns null',
  'Added a fallback because the primary DB keeps dropping connections',
  'Workaround because the vendor SDK leaks handles',
  'See ticket #4412 for the original report',
  'TODO: revisit after the migration',
  'Fix later, tech debt',
];

// Per-category derivation: 5+ MUST_FLAG and 3+ near-miss negatives for each
// of the eleven taxonomy categories in the design spec. Categories 1, 4, 6,
// 7, 9, and 10 draw some examples from MUST_FLAG/NEGATIVE_CORPUS above
// where those already exercise the category; the remainder are new.

// Category 1: passive change reports.
const CAT1_MUST_FLAG = [
  'Coverage was broadened to include the Bash negative corpus.',
  'The retry wrapper was added after the SDK stopped retrying internally.',
  'This branch was fixed against the sentence-initial false positives.',
  'The schema has been refactored to support multi-tenant IDs.',
  'The timeout was expanded from 5s to 30s.',
  'The cache key was changed to include the tenant ID.',
];
const CAT1_NEAR_MISS = [
  'Fixed entries have strikethrough: ## ~~...~~',
  'Updated timestamp is returned in ISO format',
  'Adjusted gross income is read from field 7',
];

// Category 2: review and discovery narration.
const CAT2_MUST_FLAG = [
  'A later review found the broadened list misfired on ordinary prose.',
  'It turned out to be a paragraph-transition idiom, not a commitment.',
  'It emerged that the cache key collided across tenants.',
  'Debugging revealed the socket was never closed on retry.',
  'We discovered the header was case-sensitive on the vendor side.',
  'After debugging, the null check moved above the parse call.',
];
const CAT2_NEAR_MISS = [
  'Reviews the request body against the JSON schema before dispatch.',
  'The discovery service resolves peers on the local subnet.',
  'Debugging output is written to stderr, not stdout.',
];

// Category 3: temporal comparison.
const CAT3_MUST_FLAG = [
  'Previously, this returned null; it now throws.',
  'Originally, this used a linked list for the queue.',
  'The cleanup routine is no longer necessary after the driver upgrade.',
  'This function used to throw on null input.',
  'Now also validates the schema before writing.',
  'In the old version this returned a string; now it returns an object.',
  'Before the refactor this held a global mutable cache.',
];
const CAT3_NEAR_MISS = [
  'Returns the previously cached value if present, otherwise fetches fresh.',
  'Emits an error once the session is no longer valid.',
  'This helper is used to normalize whitespace before comparison.',
  'The field holds the value originally submitted by the client.',
  'This value was used to compute the checksum.',
];

// Category 4: change plus rationale.
const CAT4_MUST_FLAG = [
  'Added retry logic to handle unstable network',
  'Refactored to support multi-tenant user IDs',
  'Changed the timeout so that retries do not overlap.',
  'Updated the schema because the vendor added a new field.',
  'Fixed the parser because empty payloads crashed it.',
  'Adjusted the batch size because the queue kept overflowing.',
];
const CAT4_NEAR_MISS = [
  'Fixed session key so the test client can authenticate',
  'Updated timestamp is returned in ISO format',
  'Improved-precision mode rounds to six decimals',
];

// Category 5: active-voice development actions. Documented gap — see the
// comment above NARRATION in comment-patterns.js. Covered only where a
// rationale clause is present (category 4); a bare sentence-initial verb is
// silent by design.
const CAT5_GAP_EXAMPLES = [
  'Fixed the null check.',
  'Added a new field.',
];

// Category 6: present-participle development.
const CAT6_MUST_FLAG = [
  'Adding a guard here because the API returns null',
  'Mocking the auth payload here so we can test the frontend locally.',
  'Fixing the null check here to unblock the release.',
  'Refactoring this because the old shape leaked memory.',
  'Adjusting the retry budget because load tests kept failing.',
];
const CAT6_NEAR_MISS = [
  'Mocking is handled by the test harness',
  'Adding two positive integers overflows past Number.MAX_SAFE_INTEGER.',
  'Fixing the cursor position happens after every keystroke.',
];

// Category 7: provisional state.
const CAT7_MUST_FLAG = [
  'WIP - still adjusting this function to handle negative integers.',
  'TODO: Rewrite this string matching later, it\'s a temporary hack for the demo.',
  'This is temporary, remove after migration.',
  'Hacky workaround for the date parser.',
  'For now, this only supports UTC timestamps.',
  'Skips validation for local testing.',
];
const CAT7_NEAR_MISS = [
  'Temporary files are written under the sp/ root',
  'Returns the cached value for now-current sessions',
  'Parses the hack-day export format',
];

// Category 8: troubleshooting anecdote.
const CAT8_MUST_FLAG = [
  'The upstream keeps dropping mid-request under heavy load.',
  'The upstream kept crashing under load, so this adds a circuit breaker.',
  'This connection was flaky during the migration window.',
  'The job kept timing out until the retry loop was added.',
  'This socket was flaky during early load tests.',
];
const CAT8_NEAR_MISS = [
  'Skips rows when the sensor reading is flaky.',
  'Circuit breaker opens after five consecutive failures.',
  'Retries when the upstream connection intermittently fails.',
];

// Category 9: fallback rationale.
const CAT9_MUST_FLAG = [
  'Added a fallback because the primary DB keeps dropping connections during load tests.',
  'Workaround because the vendor SDK leaks handles',
  'This is a fallback because the primary region is unreliable.',
  'Guard against the null-tenant payloads we saw in production.',
  'Added this guard against the malformed headers we observed from the legacy client.',
];
const CAT9_NEAR_MISS = [
  'Guard clauses reject payloads over 1MB.',
  'Returns the fallback locale when the header is absent.',
  'This workaround only applies to legacy clients.',
];

// Category 10: deferment and debt.
const CAT10_MUST_FLAG = [
  'TODO: revisit after the migration',
  'Fix later, tech debt',
  'Revisit this once the vendor SDK ships a fix.',
  'Come back to this once the vendor ships a fix.',
  'Leaving this as-is for the current release; needs a real fix later.',
  'Not worth fixing yet -- traffic through this path is negligible.',
];
const CAT10_NEAR_MISS = [
  'Revisit the cache on every poll',
  'Values are left as-is when the locale is unset.',
  'Timestamps are stored as-is, without timezone conversion.',
];

// Category 11: external references.
const CAT11_MUST_FLAG = [
  'See ticket #4412 for the original report',
  'See issue #7 for the schema history.',
  'Per PR #22, this now validates twice.',
  'See JIRA-456 for the original report.',
  'Fixes bug #918.',
];
const CAT11_NEAR_MISS = [
  'Returns the issue 404 page when absent',
  'Encodes the payload as UTF-8 before hashing.',
  'Uses SHA-256 for the integrity checksum.',
  'Parses timestamps per RFC-3339.',
  'AES-128 encryption is applied to the payload at rest.',
];

const CATEGORY_MUST_FLAG = [
  ...CAT1_MUST_FLAG, ...CAT2_MUST_FLAG, ...CAT3_MUST_FLAG, ...CAT4_MUST_FLAG,
  ...CAT6_MUST_FLAG, ...CAT7_MUST_FLAG, ...CAT8_MUST_FLAG, ...CAT9_MUST_FLAG,
  ...CAT10_MUST_FLAG, ...CAT11_MUST_FLAG,
];
const CATEGORY_NEAR_MISS = [
  ...CAT1_NEAR_MISS, ...CAT2_NEAR_MISS, ...CAT3_NEAR_MISS, ...CAT4_NEAR_MISS,
  ...CAT6_NEAR_MISS, ...CAT7_NEAR_MISS, ...CAT8_NEAR_MISS, ...CAT9_NEAR_MISS,
  ...CAT10_NEAR_MISS, ...CAT11_NEAR_MISS,
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
  // Category 5's documented gap: a bare sentence-initial verb with no
  // rationale clause. classifyComment is silent on these by design — see
  // the comment above NARRATION in comment-patterns.js.
  ...CAT5_GAP_EXAMPLES,
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
//   38-41  hand-written hard cases: "temporary"/"hack"/"for now" as
//          ordinary vocabulary rather than an impermanence construction
//   42-47  hand-written hard cases: "mocking"/"revisit"/a bare number/
//          sentence-initial past-tense verbs as ordinary vocabulary
//   48-50  hand-written hard cases: category 2 near-misses ("review"/
//          "discovery"/"debugging" as ordinary vocabulary)
//   51-55  hand-written hard cases: category 3 near-misses ("previously"/
//          "no longer"/"used to"/"originally" with an adjectival or
//          purpose-clause reading)
//   56-57  hand-written hard cases: category 6 near-misses ("adding"/
//          "fixing" as ordinary present-tense description, no rationale)
//   58-60  hand-written hard cases: category 8 near-misses ("flaky"/
//          "keeps"/"intermittently" as a present-tense trigger condition)
//   61-63  hand-written hard cases: category 9 near-misses ("guard"/
//          "fallback"/"workaround" without a rationale clause)
//   64-65  hand-written hard cases: category 10 near-misses ("as-is" without
//          a deferment construction)
//   66-69  hand-written hard cases: category 11 near-misses (technical
//          identifiers shaped like a JIRA-style project key)
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
  // Hand-written hard cases: "temporary"/"hack"/"for now" as ordinary
  // vocabulary, not an impermanence construction.
  'Temporary files are written under the sp/ root',
  'Removes the temporary directory on exit',
  'Parses the hack-day export format',
  'Returns the cached value for now-current sessions',
  // Hand-written hard cases: "mocking"/"revisit"/a bare number/
  // sentence-initial past-tense verbs as ordinary vocabulary.
  'Mocking is handled by the test harness',
  'Revisit the cache on every poll',
  'Returns the issue 404 page when absent',
  'Updated timestamp is returned in ISO format',
  'Improved-precision mode rounds to six decimals',
  'Adjusted gross income is read from field 7',
  // Hand-written hard cases: category 2 near-misses.
  'Reviews the request body against the JSON schema before dispatch.',
  'The discovery service resolves peers on the local subnet.',
  'Debugging output is written to stderr, not stdout.',
  // Hand-written hard cases: category 3 near-misses.
  'Returns the previously cached value if present, otherwise fetches fresh.',
  'Emits an error once the session is no longer valid.',
  'This helper is used to normalize whitespace before comparison.',
  'The field holds the value originally submitted by the client.',
  'This value was used to compute the checksum.',
  // Hand-written hard cases: category 6 near-misses.
  'Adding two positive integers overflows past Number.MAX_SAFE_INTEGER.',
  'Fixing the cursor position happens after every keystroke.',
  // Hand-written hard cases: category 8 near-misses.
  'Skips rows when the sensor reading is flaky.',
  'Circuit breaker opens after five consecutive failures.',
  'Retries when the upstream connection intermittently fails.',
  // Hand-written hard cases: category 9 near-misses.
  'Guard clauses reject payloads over 1MB.',
  'Returns the fallback locale when the header is absent.',
  'This workaround only applies to legacy clients.',
  // Hand-written hard cases: category 10 near-misses.
  'Values are left as-is when the locale is unset.',
  'Timestamps are stored as-is, without timezone conversion.',
  // Hand-written hard cases: category 11 near-misses.
  'Encodes the payload as UTF-8 before hashing.',
  'Uses SHA-256 for the integrity checksum.',
  'Parses timestamps per RFC-3339.',
  'AES-128 encryption is applied to the payload at rest.',
];

describe('classifyComment', () => {
  it.each(MUST_FLAG)('flags: %s', (line) => {
    expect(classifyComment(line), line).not.toBeNull();
  });

  it.each(MUST_NOT_FLAG)('allows: %s', (line) => {
    expect(classifyComment(line), line).toBeNull();
  });

  it.each(CATEGORY_MUST_FLAG)('flags (per-category derivation): %s', (line) => {
    expect(classifyComment(line), line).not.toBeNull();
  });

  it.each(CATEGORY_NEAR_MISS)('allows (per-category near-miss): %s', (line) => {
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
