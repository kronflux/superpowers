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
