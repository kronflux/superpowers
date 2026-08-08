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
const NARRATION = [
  /\b(?:was|were|has been|have been)\s+(?:broadened|added|fixed|expanded|adjusted|improved|refactored|removed|changed|updated)\b/i,
  /\b(?:a\s+)?later\s+review\b/i,
  /\bturned out (?:to|that)\b/i,
  /\b(?:previously|used to|now also|no longer)\b/i,
  /\b(?:added|refactored|expanded|broadened)\b[^.\n]{0,60}\b(?:because|so that|so we|to support|to handle)\b/i,
  /\bfixed against\b/i,
];

// A state its author intends to leave rather than a state the code holds.
// TODO/FIXME/XXX/WIP are unambiguous markers with no adjectival reading and
// stay bare. "temporary" and "hack" are ordinary vocabulary in present-state
// prose ("Temporary files are written under sp/", "Parses the hack-day
// export format"), so only the constructions that name an intended-to-leave
// state are matched, not the bare words.
const IMPERMANENCE = [
  /\b(?:TODO|FIXME|XXX|HACK)\b/,
  /\bWIP\b/,
  /\btemporary\s+(?:hack|fix|solution|workaround|measure|shim)\b/i,
  /\bthis is temporary\b/i,
  /\btemporarily\s+(?:disabled|commented|stubbed)\b/i,
  // A hyphen immediately after "now" excludes compound adjectives such as
  // "now-current" from this match.
  /\bfor now\b(?!-)/i,
  /\bfor the demo\b/i,
  /\bplaceholder for\b/i,
  /\bhacky\b/i,
  /\bhack to\b/i,
  /\bquick hack\b/i,
  /\bstill (?:adjusting|working on|need to)\b/i,
  /\bso we can test\b/i,
  /\bwill be (?:replaced|rewritten|removed)\b/i,
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
