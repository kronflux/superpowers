// hooks/lib/comment-patterns.js — classifies a single comment line as
// development narration, impermanence, a traceability marker, or a
// legitimate present-state description, and extracts comment bodies from a
// block of source text.
//
// Patterns match multi-word constructions, not bare past-tense verbs.
// "Fixed entries have strikethrough" and "Fixed crash on empty payload"
// share a verb but not a construction; only constructions that name a
// change rather than a behavior are matched. A bare "Fixed X" fragment
// passes classifyComment regardless of which of those two shapes it is.
//
// Coverage: `//` and `#` line comments, plus `/* */` and `<!-- -->` block
// comments. `--` line comments and docstrings are not recognized by
// extractComments.

// A change to the code, not a behavior of the code. Each group is matched
// only via the construction that separates a violation from an adjacent
// present-state reading — a bare word is rarely safe on its own.
//
// A bare sentence-initial verb (Added, Fixed, Adjusted, Improved,
// Refactored, Updated) is not matched on its own: no position anchor
// separates "Fixed crash on empty payload" from "Fixed entries have
// strikethrough", or "Updated the parser" from "Updated timestamp is
// returned in ISO format". Such a verb is caught only when paired with a
// rationale clause (below); "Fixed the null check." and "Added a new
// field." pass classifyComment.
const NARRATION = [
  // Passive change reports.
  /\b(?:was|were|has been|have been)\s+(?:broadened|added|fixed|expanded|adjusted|improved|refactored|removed|changed|updated)\b/i,

  // Review and discovery narration.
  /\b(?:a\s+)?later\s+review\b/i,
  /\bturned out (?:to|that)\b/i,
  /\bit emerged that\b/i,
  /\b(?:investigation|debugging)\s+(?:showed|revealed|found)\b/i,
  /\bwe discovered\b/i,
  /\bafter debugging\b/i,

  // Temporal comparison. "Previously", "originally", "no longer", and the
  // auxiliary infinitive construction ('to X' preceded by is/are/was/were)
  // read as ordinary present-state description outside a specific
  // construction — "the previously cached value", "is used to authenticate
  // requests" — so each requires a construction naming a change, not just
  // the bare word. A runtime boundary condition ("retries up until the
  // timeout elapses") reads identically to a development-history boundary
  // and is not distinguishable from one, so that phrasing is not covered.
  /\bpreviously\s*,?\s+(?:this|it)\b/i,
  /\boriginally\s*,?\s+(?:this|it)\b/i,
  /\bno longer\s+(?:needed|necessary|used|maintained|supported)\b/i,
  /\bnow also\b/i,
  /(?<!\b(?:is|are|was|were)\s)\bused to\b/i,
  /\bin the old version\b/i,
  /\bbefore the refactor\b/i,

  // Change plus rationale: a development verb paired with a rationale
  // marker ("because", "so that", "so we", "to support", "to handle") in
  // the same clause. The marker is what makes the pairing distinguishable
  // from present-state prose; a bare "Fixed session key so the test client
  // can authenticate" contains neither marker and is not matched.
  /\b(?:added|refactored|expanded|broadened|changed|updated|fixed|adjusted|improved)\b[^.\n]{0,60}\b(?:because|so that|so we|to support|to handle)\b/i,
  /\bfixed against\b/i,

  // Present-participle development (-ing form), matched only under the
  // same rationale-clause requirement as above.
  /\b(?:Adding|Adjusting|Fixing|Refactoring|Mocking)\b[^.\n]{0,60}\b(?:because|to handle|so we|here)\b/i,

  // Troubleshooting anecdote. A present-tense trigger-condition description
  // ("Retries when the upstream connection intermittently fails.") is not
  // distinguishable from an anecdote, so an intermittent-failure phrasing
  // on its own is not covered.
  /\bkeeps (?:dropping|failing|crashing|timing out|breaking)\b/i,
  /\bkept (?:dropping|failing|crashing|timing out|breaking)\b/i,
  /\bwas (?:flaky|flakey)\b/i,

  // Fallback rationale.
  /\b(?:fallback|workaround) because\b/i,
  /\bguard against\b[^.\n]{0,80}\bwe (?:saw|observed|hit)\b/i,
];

// A state its author intends to leave rather than a state the code holds.
// The markers below are matched bare, in their conventional uppercase
// spelling, since they have no adjectival reading; the hack marker
// requires a trailing colon, since bare "hack" is ordinary vocabulary
// ("Parses the hack-day export format"). "temporary", "mocking", "revisit",
// and ticket numbers are ordinary vocabulary too ("Temporary files are
// written under sp/", "Mocking is handled by the test harness", "Revisit
// the cache on every poll", "Returns the issue 404 page when absent"), so
// each is matched only in the construction that names an intended-to-leave
// or deferred-elsewhere state, not as a bare word.
const IMPERMANENCE = [
  // Provisional state markers.
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

  // Deferment and debt.
  /\b(?:tech debt|rewrite later|fix later)\b/i,
  /\brevisit (?:this|later|after|once)\b/i,
  /\bstill (?:adjusting|working on|need to)\b/i,
  /\bso we can test\b/i,
  /\bwill be (?:replaced|rewritten|removed)\b/i,
  /\bcome back to this\b/i,
  /\bleaving (?:this |it )?as-is\b/i,
  /\bnot worth fixing (?:yet|now)\b/i,

  // External references: an explicit `#<digits>` ticket reference, or the
  // literal `JIRA-<digits>` key. A general project-key shape such as
  // "ABC-123" is indistinguishable from a technical identifier ("SHA-256",
  // "RFC-3339", "AES-128", "HTTP-2"), so only the literal "JIRA-" prefix is
  // covered; other bare project keys ("PROJ-1234") are not. A bare number
  // ("issue 404 page") is not a ticket reference.
  /\b(?:ticket|issue|jira|bug|pr)\s*#\d+/i,
  /\bJIRA-\d+\b/i,
];

// A traceability identifier used as a comment prefix records where a
// requirement lives rather than what the code does, and goes stale as soon as
// the requirement is renumbered.
//
// The shape alone is ambiguous: "SHA-256", "RFC-3339" and "UTF-8" are
// identical in form. Position and punctuation separate them. The identifier
// must open the comment and be followed by a colon or dash and then prose,
// which "Returns the ISO-8601 timestamp" is not. Two digits minimum excludes
// "UTF-8" and "HTTP-2"; the denylist excludes the four-digit standards that
// clear the digit floor. Both guards are load-bearing — neither excludes
// every standard on its own.
const STANDARD_PREFIXES = new Set(['UTF', 'SHA', 'RFC', 'AES', 'HTTP', 'ISO', 'UTC', 'RGB', 'SQL', 'MD']);
const TRACEABILITY_RE = /^([A-Z]{2,6})-\d{2,4}\s*[:—-]\s+\S/;

function classifyTraceability(line) {
  const m = TRACEABILITY_RE.exec(line);
  if (!m || STANDARD_PREFIXES.has(m[1])) return null;
  return { violation: 'traceability', match: m[0].trim() };
}

/**
 * Classifies a comment line. Returns null for a present-state description,
 * or { violation: 'narration'|'impermanence'|'traceability', match } for the
 * first construction matched.
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
  const trace = classifyTraceability(line);
  if (trace) return trace;
  return null;
}

// Block comment delimiters scanned in addition to line comments. Docstrings
// are not included: they carry prose and code samples that read as comment
// violations without being comments.
const BLOCK_DELIMITERS = [
  { open: '/*', close: '*/' },
  { open: '<!--', close: '-->' },
];

/**
 * Returns the trimmed bodies of line comments (`//`, `#`) and block comments
 * (`/* *\/`, `<!-- -->`) in text. An opener inside a quoted string is
 * skipped. A block body is returned one line at a time, with leading `*`
 * decoration removed.
 */
export function extractComments(text) {
  const src = String(text);
  const bodies = [];
  let i = 0;
  let quote = null;

  while (i < src.length) {
    const ch = src[i];

    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i++; continue; }

    const block = BLOCK_DELIMITERS.find((d) => src.startsWith(d.open, i));
    if (block) {
      const end = src.indexOf(block.close, i + block.open.length);
      const body = src.slice(i + block.open.length, end === -1 ? src.length : end);
      for (const line of body.split(/\r?\n/)) {
        const cleaned = line.replace(/^\s*\*+\s?/, '').trim();
        if (cleaned) bodies.push(cleaned);
      }
      i = end === -1 ? src.length : end + block.close.length;
      continue;
    }

    if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      const marker = ch === '#' ? 1 : 2;
      const body = src.slice(i + marker, end).trim();
      if (body) bodies.push(body);
      i = end;
      continue;
    }

    i++;
  }

  return bodies;
}
