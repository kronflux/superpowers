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

// A change to the code, not a behavior of the code.
//
// Measured and rejected: /^(?:\s*(?:\/\/|#|\*)\s*)?(?:Added|Fixed|Adjusted|
// Improved|Refactored|Updated)\b/i (sentence-initial past-tense verb). 7
// false positives to catch 3 targets, including both "Fixed …" comments the
// negative corpus protects plus "Updated timestamp is returned in ISO
// format", "Improved-precision mode rounds to six decimals", and "Adjusted
// gross income is read from field 7" — all present-state, all
// sentence-initial. No position anchor separates "Fixed crash on empty
// payload" from "Fixed entries have strikethrough"; the bare-verb fragment
// stays a documented gap rather than a pattern.
const NARRATION = [
  /\b(?:was|were|has been|have been)\s+(?:broadened|added|fixed|expanded|adjusted|improved|refactored|removed|changed|updated)\b/i,
  /\b(?:a\s+)?later\s+review\b/i,
  /\bturned out (?:to|that)\b/i,
  /\b(?:previously|used to|now also|no longer)\b/i,
  /\b(?:added|refactored|expanded|broadened)\b[^.\n]{0,60}\b(?:because|so that|so we|to support|to handle)\b/i,
  /\bfixed against\b/i,
  /\b(?:Adding|Adjusting|Fixing|Refactoring|Mocking)\b[^.\n]{0,60}\b(?:because|to handle|so we|here)\b/i,
  /\bkeeps (?:dropping|failing|crashing|timing out|breaking)\b/i,
  /\b(?:fallback|workaround) because\b/i,
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
  /\b(?:tech debt|rewrite later|fix later)\b/i,
  /\brevisit (?:this|later|after|once)\b/i,
  /\bstill (?:adjusting|working on|need to)\b/i,
  /\bso we can test\b/i,
  /\bwill be (?:replaced|rewritten|removed)\b/i,
  // Ticket references: an explicit `#<digits>` or a JIRA-style `ABC-123`
  // key. A bare number ("issue 404 page") is not a ticket reference.
  /\b(?:ticket|issue|jira|bug)\s*#\d+/i,
  /\b[A-Z]{2,}-\d+\b/,
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
