import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Task 15 (criteria 2 & 8): enforce frontmatter + cross-ref namespace + blocked
// fetch-pattern hygiene on EVERY skill via the existing standalone lint.
// This wraps tests/lint-skills.mjs — it does NOT re-implement the lint logic.
// The lint already checks: YAML frontmatter present (name/description), no
// non-superpowers namespace (cross-ref normalization), and no blocked fetch
// directive (curl/wget/WebFetch/Read directly/Grep to locate) outside an
// adapter native-fallback block.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LINT = path.join(ROOT, 'tests', 'lint-skills.mjs');

function runLint(args = []) {
  return spawnSync('node', [LINT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

describe('skills frontmatter + cross-ref lint (criterion 2)', () => {
  it('the standalone lint exists and is the single source of truth', () => {
    expect(fs.existsSync(LINT)).toBe(true);
  });

  it('every skill passes frontmatter + cross-ref + blocked-pattern lint (exit 0)', () => {
    const r = runLint();
    expect(
      r.status,
      `lint failed:\n${r.stdout}\n${r.stderr}`,
    ).toBe(0);
    // Sanity: the lint actually examined skills, not a vacuous no-op.
    expect(r.stdout).toMatch(/frontmatter OK/);
  });

  it('the 13 net-new skills are covered by the lint run', () => {
    const newSkills = [
      'claude-md-creator', 'context-management', 'deliberation',
      'dependency-management', 'error-recovery', 'frontend-design',
      'performance-investigation', 'premise-check', 'refactoring',
      'self-consistency-reasoner', 'token-efficiency',
      'checking-gates', 'specifying-gates',
    ];
    const r = runLint(newSkills.map((s) => `skills/${s}`));
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    for (const s of newSkills) {
      expect(fs.existsSync(path.join(ROOT, 'skills', s, 'SKILL.md')), `missing ${s}`).toBe(true);
      expect(r.stdout, `lint did not report ${s}`).toContain(`${s}: frontmatter OK`);
    }
  });

  it('the lint BITES: a skill with broken frontmatter / bad namespace fails (exit 1)', () => {
    // Prove the assertion is not vacuous: feed the lint a fixture skill that
    // has no frontmatter and a non-superpowers namespace reference.
    const tmp = fs.mkdtempSync(path.join(ROOT, 'tests', '.fixture-skill-'));
    try {
      const dir = path.join(tmp, 'bad-skill');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        'no frontmatter here\nsee superpowers-optimized:foo for details\n',
      );
      const rel = path.relative(ROOT, dir);
      const r = runLint([rel]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/no YAML frontmatter/);
      expect(r.stderr).toMatch(/non-superpowers namespace/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
