// hooks/lib/comment-patterns.js — classifies a single comment line as
// development narration, impermanence, or a legitimate present-state
// description, and extracts comment bodies from a block of source text.
//
// Patterns match multi-word constructions, not bare past-tense verbs.
// "Fixed entries have strikethrough" and "Fixed crash on empty payload"
// share a verb but not a construction; only constructions that name a
// change rather than a behavior are matched. A bare "Fixed X" fragment
// passes classifyComment regardless of which of those two shapes it is.
//
// Coverage: `//` and `#` line comments only. `--`, `/* */`, `<!-- -->`,
// and docstrings are not recognized by extractComments.

// A change to the code, not a behavior of the code. Grouped by taxonomy
// category (see the design spec); each group's header states what
// construction separates a violation from an adjacent present-state
// reading, since a bare word is rarely safe on its own.
//
// Category 5, active-voice development actions (Added/Fixed/Adjusted/
// Improved/Refactored/Updated as a bare sentence-initial verb), is not a
// pattern here. Measured and rejected:
// /^(?:\s*(?:\/\/|#|\*)\s*)?(?:Added|Fixed|Adjusted|Improved|Refactored|
// Updated)\b/i — 7 false positives to catch 3 targets, including both
// "Fixed …" comments the negative corpus protects plus "Updated timestamp
// is returned in ISO format", "Improved-precision mode rounds to six
// decimals", and "Adjusted gross income is read from field 7" — all
// present-state, all sentence-initial. No position anchor separates "Fixed
// crash on empty payload" from "Fixed entries have strikethrough"; the
// category stays covered only where it overlaps categories 4 and 6 below
// (a rationale or cause attached to the verb). A bare verb with no
// rationale clause — "Fixed the null check.", "Added a new field." — passes
// classifyComment; this is the accepted gap.
const NARRATION = [
  // Category 1: passive change reports.
  /\b(?:was|were|has been|have been)\s+(?:broadened|added|fixed|expanded|adjusted|improved|refactored|removed|changed|updated)\b/i,

  // Category 2: review and discovery narration.
  /\b(?:a\s+)?later\s+review\b/i,
  /\bturned out (?:to|that)\b/i,
  /\bit emerged that\b/i,
  /\b(?:investigation|debugging)\s+(?:showed|revealed|found)\b/i,
  /\bwe discovered\b/i,
  /\bafter debugging\b/i,

  // Category 3: temporal comparison. Bare "previously"/"originally"/
  // "no longer"/"used to" have an adjectival or purpose-clause reading —
  // "the previously cached value", "is used to authenticate requests" — so
  // each is matched only in a construction that names a change, not a
  // present attribute. "now also" has no found present-state reading ("now"
  // inherently signals a before/after contrast) and stays bare. "up until"
  // was tried and rejected: 2 false positives ("Retries the request up
  // until the timeout elapses.", "Buffers events up until the flush
  // interval fires.") against 1 target — a runtime boundary condition reads
  // identically to a development-history boundary; left uncovered.
  /\bpreviously\s*,?\s+(?:this|it)\b/i,
  /\boriginally\s*,?\s+(?:this|it)\b/i,
  /\bno longer\s+(?:needed|necessary|used|maintained|supported)\b/i,
  /\bnow also\b/i,
  /(?<!\b(?:is|are|was|were)\s)\bused to\b/i,
  /\bin the old version\b/i,
  /\bbefore the refactor\b/i,

  // Category 4: change plus rationale. The verb list is deliberately wider
  // than category 1's bare-verb rejection allows, because pairing the verb
  // with a rationale marker ("because", "so that", "so we", "to support",
  // "to handle") within the same clause is itself the construction that
  // makes it safe — "Fixed session key so the test client can authenticate"
  // does not contain "so that" or "so we", so it stays silent.
  /\b(?:added|refactored|expanded|broadened|changed|updated|fixed|adjusted|improved)\b[^.\n]{0,60}\b(?:because|so that|so we|to support|to handle)\b/i,
  /\bfixed against\b/i,

  // Category 6: present-participle development, the same rationale-clause
  // requirement as category 4 applied to the -ing form.
  /\b(?:Adding|Adjusting|Fixing|Refactoring|Mocking)\b[^.\n]{0,60}\b(?:because|to handle|so we|here)\b/i,

  // Category 8: troubleshooting anecdote. "intermittently failed/failing/
  // fails" was tried and rejected: "Retries when the upstream connection
  // intermittently fails." is a present-tense trigger-condition
  // description, not an anecdote, and the construction cannot tell the two
  // apart — left uncovered.
  /\bkeeps (?:dropping|failing|crashing|timing out|breaking)\b/i,
  /\bkept (?:dropping|failing|crashing|timing out|breaking)\b/i,
  /\bwas (?:flaky|flakey)\b/i,

  // Category 9: fallback rationale.
  /\b(?:fallback|workaround) because\b/i,
  /\bguard against\b[^.\n]{0,80}\bwe (?:saw|observed|hit)\b/i,
];

// A state its author intends to leave rather than a state the code holds.
// TODO/FIXME/XXX are unambiguous markers with no adjectival reading and stay
// bare; HACK requires a trailing colon since bare "hack" is ordinary
// vocabulary ("Parses the hack-day export format"). "temporary", "mocking",
// "revisit", and ticket numbers are ordinary vocabulary too ("Temporary
// files are written under sp/", "Mocking is handled by the test harness",
// "Revisit the cache on every poll", "Returns the issue 404 page when
// absent"), so each is matched only in the construction that names an
// intended-to-leave or deferred-elsewhere state, not as a bare word.
const IMPERMANENCE = [
  // Category 7: provisional state.
  /\b(?:TODO|FIXME|XXX)\b/,
  /\bHACK:/,
  /\b(?:WIP|work in progress|for (?:the )?demo|local testing)\b/i,
  /\btemporary\s+(?:hack|fix|solution|workaround|measure|shim)\b/i,
  /\bthis is temporary\b/i,
  /\btemporarily\s+(?:disabled|commented|stubbed)\b/i,
  // A hyphen immediately after "now" excludes compound adjectives such as
  // "now-current" from this match.
  /\bfor now\b(?!-)/i,
  /\bplaceholder for\b/i,
  /\bhacky\b/i,
  /\bhack to\b/i,
  /\bquick hack\b/i,

  // Category 10: deferment and debt.
  /\b(?:tech debt|rewrite later|fix later)\b/i,
  /\brevisit (?:this|later|after|once)\b/i,
  /\bstill (?:adjusting|working on|need to)\b/i,
  /\bso we can test\b/i,
  /\bwill be (?:replaced|rewritten|removed)\b/i,
  /\bcome back to this\b/i,
  /\bleaving (?:this |it )?as-is\b/i,
  /\bnot worth fixing (?:yet|now)\b/i,

  // Category 11: external references. An explicit `#<digits>` ticket
  // reference, or the literal `JIRA-<digits>` key form. The general
  // project-key shape `[A-Z]{2,}-\d+` (e.g. "ABC-123") was tried and
  // rejected: it matches technical identifiers at the same rate it matches
  // tickets — "Encodes the payload as UTF-8", "Uses SHA-256 for the
  // checksum", "Parses timestamps per RFC-3339", "AES-128 encryption is
  // applied", "Negotiates HTTP-2 keepalive" all false-positive (5 false
  // positives, 1 target: "JIRA-456"). Only the literal "JIRA-" prefix is
  // covered; other bare project keys ("PROJ-1234", "ENG-99") are a
  // documented gap. A bare number ("issue 404 page") is not a ticket
  // reference.
  /\b(?:ticket|issue|jira|bug|pr)\s*#\d+/i,
  /\bJIRA-\d+\b/i,
];

/**
 * Classifies a comment line. Returns null for a present-state description,
 * or { violation: 'narration'|'impermanence', match } for the first
 * construction matched.
 */
export function classifyComment(line) {
  if (typeof line !== 'string' || !line) return null;
  for (const re of NARRATION) {
    const m = line.match(re);
    if (m) return { violation: 'narration', match: m[0] };
  }
  for (const re of IMPERMANENCE) {
    const m = line.match(re);
    if (m) return { violation: 'impermanence', match: m[0] };
  }
  return null;
}

// Finds the index of the first `//` or `#` on a line that is not inside a
// quoted string. Tracks single, double, and backtick quotes; a backslash
// escapes the following character while a quote is open.
function findCommentStart(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '#') return i;
    if (ch === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}

/**
 * Returns the trimmed bodies of `//` and `#` line comments in text, skipping
 * any `//` or `#` that occurs inside a quoted string.
 */
export function extractComments(text) {
  const bodies = [];
  for (const line of String(text).split(/\r?\n/)) {
    const start = findCommentStart(line);
    if (start === -1) continue;
    const markerLength = line[start] === '#' ? 1 : 2;
    const body = line.slice(start + markerLength).trim();
    if (body) bodies.push(body);
  }
  return bodies;
}
