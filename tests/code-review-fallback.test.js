import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

// Plan 4 Task 9: wire the static dispatch+fallback contract test
// (tests/test-code-review-fallback.sh) into `npm test`, and prove the
// assertion is non-vacuous by also driving the FAILING (broken-contract) case.
//
// The .sh resolves paths relative to its own location (`cd $(dirname $0)/..`),
// so we run it against a temp mirror of the repo: once intact (must PASS), and
// once with the `general-purpose` fallback stripped from the skill (must FAIL).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tests', 'test-code-review-fallback.sh');

const CONTRACT_FILES = [
  'agents/code-reviewer.md',
  'agents/red-team.md',
  'skills/requesting-code-review/SKILL.md',
  'skills/requesting-code-review/code-reviewer.md',
];

function have(cmd) {
  return spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
}
const BASH_OK = have('bash');

// Build a temp repo mirror containing only the files the contract test reads,
// plus the .sh under tests/. Optionally apply a mutation to SKILL.md to break
// the contract.
function buildMirror({ mutateSkill } = {}) {
  const dir = fs.mkdtempSync(path.join(spTmpDir(), 'cr-fallback-'));
  for (const rel of CONTRACT_FILES) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (mutateSkill && rel === 'skills/requesting-code-review/SKILL.md') {
      content = mutateSkill(content);
    }
    fs.writeFileSync(dest, content);
  }
  const testsDir = path.join(dir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(testsDir, 'test-code-review-fallback.sh'));
  return dir;
}

function runScript(mirrorDir) {
  return spawnSync('bash', [path.join(mirrorDir, 'tests', 'test-code-review-fallback.sh')], {
    encoding: 'utf8',
  });
}

function withMirror(opts, fn) {
  const dir = buildMirror(opts);
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('code-review dispatch + fallback contract (Plan 4 Task 9)', () => {
  it('the contract test script exists', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  it.skipIf(!BASH_OK)(
    'PRESENT-AGENTS + FALLBACK: intact contract PASSES (exit 0)',
    () => {
      withMirror({}, (dir) => {
        const r = runScript(dir);
        expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/PASS: code-review dispatch \+ fallback contract holds/);
      });
    },
  );

  it.skipIf(!BASH_OK)(
    'NON-VACUITY: removing the general-purpose fallback FAILS the test (exit != 0)',
    () => {
      withMirror(
        { mutateSkill: (c) => c.split('\n').filter((l) => !l.includes('general-purpose')).join('\n') },
        (dir) => {
          const r = runScript(dir);
          expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).not.toBe(0);
          expect(r.stderr).toMatch(/FAIL: skill missing general-purpose fallback/);
        },
      );
    },
  );

  it('skill references both named agents, the fallback, and the inline template', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'skills', 'requesting-code-review', 'SKILL.md'),
      'utf8',
    );
    expect(src).toMatch(/superpowers:code-reviewer/);
    expect(src).toMatch(/superpowers:red-team/);
    expect(src).toMatch(/general-purpose/);
    expect(src).toMatch(/code-reviewer\.md/);
    // No Bash subagent type configured on the review surface.
    expect(src).not.toMatch(/subagent_type:"Bash"/);
  });

  if (!BASH_OK) {
    it('SKIP NOTICE: bash unavailable — script-driven cases skipped', () => {
      expect(BASH_OK).toBe(false);
    });
  }
});
