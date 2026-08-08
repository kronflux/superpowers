import { describe, it, expect } from 'vitest';
import { checkForwardCommitment, evaluatePayload } from '../hooks/stop-reminders.js';

// Task 4: guard against a turn that announces work and does none.
// run() exercises the pure detector directly — no transcript file needed,
// matching the { finalMessage, toolUses } shape the plan's test spec uses.
function run({ finalMessage, toolUses }) {
  return checkForwardCommitment({ finalMessage, toolUses });
}

describe('stop-reminders: forward-commitment guard', () => {
  it('nudges when the turn promises work and changes nothing', () => {
    const out = run({
      finalMessage: 'Proceeding on best judgement. Writing the spec for piece 1 now.',
      toolUses: [],
    });
    expect(out).toMatch(/announced|did not|no file/i);
  });

  it('stays silent when the promised work actually happened', () => {
    const out = run({
      finalMessage: 'Proceeding on best judgement. Writing the spec for piece 1 now.',
      toolUses: [{ name: 'Write' }],
    });
    expect(out).toBe('');
  });

  it('stays silent on a turn with no forward commitment', () => {
    const out = run({ finalMessage: 'The suite is green: 524 passed.', toolUses: [] });
    expect(out).toBe('');
  });

  it('fails open on malformed input', () => {
    expect(checkForwardCommitment(undefined)).toBe('');
    expect(checkForwardCommitment({ finalMessage: 123, toolUses: 'nope' })).toBe('');
    expect(checkForwardCommitment({ finalMessage: 'I will now fix it.', toolUses: null })).not.toBe('');
  });

  it('evaluatePayload fails open when transcript_path is missing or unreadable', () => {
    expect(evaluatePayload({ cwd: process.cwd(), session_id: 'sr-test-1' })).toEqual({});
    expect(
      evaluatePayload({
        cwd: process.cwd(),
        session_id: 'sr-test-2',
        transcript_path: 'C:\\definitely\\not\\a\\real\\path.jsonl',
      })
    ).toEqual({});
  });

  it('evaluatePayload never throws on a garbage payload', () => {
    expect(() => evaluatePayload(null)).not.toThrow();
    expect(() => evaluatePayload('not an object')).not.toThrow();
    expect(() => evaluatePayload({ transcript_path: 42 })).not.toThrow();
  });
});

// Corpus test: real past-tense engineering prose pulled verbatim from
// .superpowers/sdd/**/*report*.md task reports. This is exactly the genre
// of text the forward-commitment guard must stay silent on — reports
// narrate what was already done, in first and third person, using the same
// verbs ("writing", "creating", "implementing") the guard's patterns key
// on. None of these promise unfinished work, so all must produce ''.
const REPORT_CORPUS = [
  // .superpowers/sdd/v760-final-fixes-report.md:68
  'One real bug surfaced while writing this test, orthogonal to the fix itself:',
  // .superpowers/sdd/v7100-task-5-report.md:15
  '`<cwd>/.claude/settings.json`, creating the file/dir if absent, preserving unrelated keys,',
  // .superpowers/sdd/v7100-task-5-report.md:145
  'decided by `readdirSync` order. Chose anchoring (`/^\\d+\\.\\d+\\.\\d+$/`) over implementing',
  // .superpowers/sdd/v760-task-1-report.md:47
  '**GREEN** — same command after implementing the hook:',
  // .superpowers/sdd/v790-task-4-report.md:31
  '**RED** — `npx vitest run tests/session-end-cleanup.test.js` (before creating the hook):',
  // .superpowers/sdd/v780-task-2-report.md:32
  '**RED** — `npx vitest run tests/capability-registry.test.js` (before implementing Step 3):',
  // .superpowers/sdd/v770-task-1-report.md:61
  '**GREEN** — `npx vitest run tests/usage-aggregator.test.js` (after implementing Step 3):',
  // .superpowers/sdd/v780-task-5-report.md:16
  'Command: `npx vitest run tests/doc-links.test.js`, run immediately after creating the test file and before touching any adapter/skill file.',
  // .superpowers/sdd/v790-task-3-report.md:12
  'Implementation follows the brief verbatim with one addition: after writing the `.last-sweep`',
  // .superpowers/sdd/2026-08-08-sdd-workspace-defects/guard-report.md:3
  '## Payload verification (done before writing anything)',
  // .superpowers/sdd/task-4-report.md:24-26 (first-person past tense, "I added ... writing")
  'I added a `reason` guard inside `archive()` so an in-process call with a missing/empty reason throws the same prefixed error rather than silently writing `reason: undefined`',
  // .superpowers/sdd/v790-task-5-report.md:81 (mid-sentence "writing/causing writes")
  'Traced to `tests/ctx-detect.test.js` and `tests/bash-compress-hook.test.js` writing/causing writes to `_cacheFile()`/`compress-*.json` state files with no teardown. Fixed as described above.',
];

describe('stop-reminders: forward-commitment guard — report corpus stays silent', () => {
  for (const text of REPORT_CORPUS) {
    it(`silent on: ${text.slice(0, 60)}...`, () => {
      expect(run({ finalMessage: text, toolUses: [] })).toBe('');
    });
  }
});

describe('stop-reminders: forward-commitment guard — expanded patterns', () => {
  it('fires on each of the seven newly adopted commitment phrasings', () => {
    const promises = [
      "I'll now update the config.",
      'Let me go ahead and fix the import.',
      "I'm going to start on the migration.",
      "Let's get started on the next task.",
      'Proceeding with the deploy now.',
      'Beginning now on the refactor.',
      'Allow me to write the missing test.',
    ];
    for (const finalMessage of promises) {
      expect(run({ finalMessage, toolUses: [] })).not.toBe('');
    }
  });

  it('fires on the tightened writing/generating/... pattern for genuine announcements', () => {
    expect(run({ finalMessage: 'Writing the fix now.', toolUses: [] })).not.toBe('');
    expect(
      run({ finalMessage: "I'm writing the migration script now.", toolUses: [] })
    ).not.toBe('');
    expect(
      run({ finalMessage: 'I am generating the report for you.', toolUses: [] })
    ).not.toBe('');
  });

  it('stays silent on the tightened pattern for mid-sentence past-tense reporting', () => {
    // The untightened candidate ("verb ... now/for-you" anywhere in the message)
    // matched this; requiring sentence-initial or first-person position fixes it.
    const text =
      'Fixed the failing assertion and refactored the helper; still working on the reaper now covered by tests.';
    expect(run({ finalMessage: text, toolUses: [] })).toBe('');
  });

  it('fires on "moving on to" as a bare commitment', () => {
    expect(
      run({ finalMessage: 'Moving on to the next task now.', toolUses: [] })
    ).not.toBe('');
  });

  it('does not include the two rejected patterns (presenting work, sycophancy)', () => {
    expect(
      run({ finalMessage: 'Here is the code you asked for.', toolUses: [] })
    ).toBe('');
    expect(
      run({ finalMessage: 'I can certainly help with that.', toolUses: [] })
    ).toBe('');
  });
});
