// hooks/lib/commit-content.js — the banned commit-message content classes from
// skills/shared/git-hygiene.md, as matchers.
//
// A commit describes what changed in the software. These four classes describe
// the work that produced it, or facts about the implementation that go stale.
//
// Every pattern is anchored to phrasing that only occurs when narrating the
// process. A bare domain use is not matched: "fix: retry step 2 of the OAuth
// handshake" and "feat: add a 3-phase migration" describe the software, and
// stay allowed. Precision is the priority, because a gate that blocks correct
// work is a gate that gets switched off.

const BANNED = [
  {
    rule: 'planning-structure',
    // A reference to the plan that produced the change, which no reader of
    // `git log` can resolve later.
    pattern: /\b(?:per|from|following|implements?|completes?|closes?)\s+(?:the\s+)?(?:plan|spec|design\s+doc)\b|\bplan'?s\s+task\b|\b(?:task|phase|step)\s+\d+\s+of\s+the\s+(?:plan|spec)\b|\bas\s+(?:specified|described|planned)\s+in\s+the\s+(?:plan|spec)\b/i,
    detail: 'names the plan or spec that produced the change; that scaffolding does not outlive the work',
  },
  {
    rule: 'planning-task-reference',
    // "Task 3", "Phase 2" capitalised as a proper noun is this repo's plan-task
    // convention, never a domain term.
    pattern: /\b(?:Task|Phase|Step|Workstream|WS)\s*#?\d+\b/,
    detail: 'refers to a numbered task or phase; a reader of `git log` cannot resolve it',
  },
  {
    rule: 'internal-counts',
    pattern: /\b\d+\s+(?:patterns?|categories|rules?|checks?|detectors?|cases?|assertions?|tests?)\b/i,
    detail: 'carries an internal count that goes stale and describes the implementation rather than the change',
  },
  {
    rule: 'measurement-as-achievement',
    pattern: /\bwith\s+measured\s+\w+|\bnow\s+(?:fully\s+)?(?:tested|covered|verified|passing)\b|\ball\s+tests?\s+pass(?:ing)?\b/i,
    detail: 'reports how the change was made trustworthy, which is not part of the change',
  },
  {
    rule: 'process-verbs',
    // Sentence-initial in the description, where it reports the author's motion.
    pattern: /^(?:derive|adopt|iterate\s+on|revisit|revamp|rework|address|tackle)\b/i,
    detail: 'opens with a verb describing your motion rather than the software\'s behaviour',
  },
];

/**
 * Findings for the parts of a message that describe the software: the
 * description and the body. The type and scope prefix is excluded, so a
 * legitimate `refactor(step2):` scope never matches.
 */
function findBannedContent(description, body = '') {
  const findings = [];
  for (const { rule, pattern, detail } of BANNED) {
    // Process verbs are judged on the description only; anchoring them to the
    // start of a body paragraph would flag ordinary prose.
    const subject = rule === 'process-verbs' ? String(description ?? '') : `${description ?? ''}\n${body ?? ''}`;
    const m = pattern.exec(subject);
    if (m) findings.push({ rule, detail, match: m[0].trim() });
  }
  return findings;
}

export { findBannedContent, BANNED };
