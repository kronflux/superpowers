import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Task 4 (skill-semantics-routing): `preconditions:` frontmatter is drawn
// from a closed vocabulary of exactly three values. tests/lint-skills.mjs
// must reject anything outside it and accept everything inside it,
// including the absence of the key entirely.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LINT = path.join(ROOT, 'tests', 'lint-skills.mjs');

function runLint(args = []) {
  return spawnSync('node', [LINT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function makeFixture(tmp, name, frontmatterExtra) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: x\n${frontmatterExtra}---\n\nBody text.\n`,
  );
  return dir;
}

describe('lint-skills.mjs — preconditions vocabulary', () => {
  it('rejects an unknown preconditions value, naming it', () => {
    const tmp = fs.mkdtempSync(path.join(ROOT, 'tests', '.fixture-preconditions-'));
    try {
      const dir = makeFixture(tmp, 'bad-precondition-skill', 'preconditions:\n  - flies-to-the-moon\n');
      const rel = path.relative(ROOT, dir);
      const r = runLint([rel]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unknown preconditions value: flies-to-the-moon/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts each of the three valid values individually', () => {
    const tmp = fs.mkdtempSync(path.join(ROOT, 'tests', '.fixture-preconditions-'));
    try {
      for (const value of ['artifact-cheap-to-modify', 'execution-safe', 'failure-is-cheap']) {
        const dir = makeFixture(tmp, `good-${value}-skill`, `preconditions:\n  - ${value}\n`);
        const rel = path.relative(ROOT, dir);
        const r = runLint([rel]);
        expect(r.status, `${value}: ${r.stdout}\n${r.stderr}`).toBe(0);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts all three values declared together', () => {
    const tmp = fs.mkdtempSync(path.join(ROOT, 'tests', '.fixture-preconditions-'));
    try {
      const dir = makeFixture(
        tmp,
        'all-preconditions-skill',
        'preconditions:\n  - artifact-cheap-to-modify\n  - execution-safe\n  - failure-is-cheap\n',
      );
      const rel = path.relative(ROOT, dir);
      const r = runLint([rel]);
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts a skill with no preconditions key at all', () => {
    const tmp = fs.mkdtempSync(path.join(ROOT, 'tests', '.fixture-preconditions-'));
    try {
      const dir = makeFixture(tmp, 'no-preconditions-skill', '');
      const rel = path.relative(ROOT, dir);
      const r = runLint([rel]);
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
