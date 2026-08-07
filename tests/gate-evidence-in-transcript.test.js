import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

// Task 16 (criterion 9): the coexistence mitigation. A user-gate task closed
// WITHOUT `AC:`/`PROVEN BY` evidence in the TRANSCRIPT must block (the
// false-positive that happens when evidence lived only in a ctx sandbox).
// The same close WITH the canonical evidence echoed into an assistant-text
// entry must pass. We drive the REAL hook script with two synthetic
// transcripts and assert the block/pass outcomes.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'examples', 'post-task-complete-revalidate.sh');

// The hook requires python3 + jq + bash. Detect them so we skip with a clear
// message rather than reporting a false green.
function have(cmd) {
  return spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
}
const DEPS_OK = have('bash') && have('python3') && have('jq');

// Build a transcript JSONL mirroring what the hook parses:
//   1. assistant tool_use TaskCreate (carries json:metadata fence, userGate)
//   2. assistant tool_use TaskUpdate status=in_progress  (window start)
//   3. optional assistant text (the evidence — present only in positive case)
//   4. assistant tool_use TaskUpdate status=completed     (the close)
// TaskCreate carries no taskId; the hook rebuilds the 1-based id counter, so
// this single TaskCreate is task #1.
function buildTranscript({ withEvidence }) {
  const metadata = JSON.stringify({
    userGate: true,
    tags: ['user-gate'],
    acceptanceCriteria: ['todo list renders', 'items can be added'],
  }, null, 2);
  const description = [
    'USER-ORDERED GATE',
    '',
    '```json:metadata',
    metadata,
    '```',
  ].join('\n');

  const lines = [];
  const asstToolUse = (name, input) => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] },
  });
  const asstText = (text) => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });

  lines.push(asstToolUse('TaskCreate', { subject: 'react todo list works', description }));
  lines.push(asstToolUse('TaskUpdate', { taskId: 1, status: 'in_progress' }));

  if (withEvidence) {
    // Canonical shape per checking-gates Task 13 — echoed into the transcript.
    lines.push(asstText([
      'Gate: react todo list works',
      'AC: todo list renders — PROVEN BY ctx_execute output: rendered 3 <li> nodes',
      'AC: items can be added — PROVEN BY ctx_execute output: count 3 -> 4 after add',
    ].join('\n')));
  } else {
    // Generic completion claim, NO AC:/PROVEN BY (evidence stuck in sandbox).
    lines.push(asstText('plan complete, moving on to the next item.'));
  }

  lines.push(asstToolUse('TaskUpdate', { taskId: 1, status: 'completed' }));

  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function runHook(transcriptPath) {
  const input = JSON.stringify({
    tool_name: 'TaskUpdate',
    tool_input: { taskId: 1, status: 'completed' },
    transcript_path: transcriptPath,
  });
  return spawnSync('bash', [HOOK], {
    input,
    encoding: 'utf8',
    env: { ...process.env, SUPERPOWERS_USERGATE_GUARD: '1' },
  });
}

function withFixture(opts, fn) {
  const dir = fs.mkdtempSync(path.join(spTmpDir(), 'gate-fixture-'));
  const fp = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(fp, buildTranscript(opts));
  try {
    return fn(fp);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('gate evidence-in-transcript (criterion 9)', () => {
  it('the real hook script exists', () => {
    expect(fs.existsSync(HOOK)).toBe(true);
  });

  it.skipIf(!DEPS_OK)(
    'NEGATIVE: user-gate closed without AC:/PROVEN BY in transcript BLOCKS (exit 2)',
    () => {
      withFixture({ withEvidence: false }, (fp) => {
        const r = runHook(fp);
        expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/USER-GATE CLOSED/);
      });
    },
  );

  it.skipIf(!DEPS_OK)(
    'POSITIVE: user-gate closed WITH AC:/PROVEN BY echoed in transcript PASSES (exit 0)',
    () => {
      withFixture({ withEvidence: true }, (fp) => {
        const r = runHook(fp);
        expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(0);
        expect(r.stderr).not.toMatch(/USER-GATE CLOSED/);
      });
    },
  );

  // Forward-reference guard: checking-gates lands in a later resync commit.
  it.skipIf(!fs.existsSync(path.join(ROOT, 'skills', 'checking-gates', 'SKILL.md')))('checking-gates SKILL.md carries the canonical block AND the in-transcript echo rule', () => {
    const src = fs.readFileSync(path.join(ROOT, 'skills', 'checking-gates', 'SKILL.md'), 'utf8');
    // Canonical AC: ... — PROVEN BY ... block.
    expect(src).toMatch(/AC:\s*<criterion[^>]*>\s*—\s*PROVEN BY/);
    // The behavioral contract that produces the positive case: echo into the
    // assistant message / transcript, not only into a ctx sandbox.
    expect(src).toMatch(/assistant text in the conversation/i);
    expect(src).toMatch(/echoed IN THE TRANSCRIPT|not only into a ctx sandbox/i);
  });

  if (!DEPS_OK) {
    it('SKIP NOTICE: hook deps (bash/python3/jq) unavailable — block/pass cases skipped', () => {
      expect(DEPS_OK).toBe(false);
    });
  }
});
