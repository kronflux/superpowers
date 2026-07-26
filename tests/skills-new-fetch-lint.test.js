import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Task 15 (criterion 8): no blocked fetch directive (curl/wget/WebFetch/
// "Read directly"/"Grep to locate") may survive in any skill body as an
// instruction. The line-scoped check (allowing adapter native-fallback fences)
// lives in tests/lint-skills.mjs; this suite drives that lint and adds the
// explicit token-efficiency assertion the plan calls out.
// It does NOT re-implement the blocked-pattern regex.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LINT = path.join(ROOT, 'tests', 'lint-skills.mjs');

function runLint(args = []) {
  return spawnSync('node', [LINT, ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('skills blocked-fetch lint (criterion 8)', () => {
  it('no skill contains an un-adapter-guarded blocked fetch directive (exit 0)', () => {
    const r = runLint();
    expect(r.status, `lint failed:\n${r.stdout}\n${r.stderr}`).toBe(0);
    // Guard against a vacuous pass: stderr must not name any blocked pattern.
    expect(r.stderr).not.toMatch(/blocked fetch pattern/);
  });

  it('token-efficiency SKILL.md has zero curl/WebFetch fetch directives', () => {
    const r = runLint(['skills/token-efficiency']);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('token-efficiency: frontmatter OK');

    // Direct content assertion mirroring the plan's explicit criterion-8 check.
    const src = fs.readFileSync(
      path.join(ROOT, 'skills', 'token-efficiency', 'SKILL.md'),
      'utf8',
    );
    expect(src).not.toMatch(/\bcurl\s+-sf\b/i);
    expect(src).not.toMatch(/WebFetch returns AI-generated summaries/i);
    // The deferral must be wired to the adapter, not orphaned.
    expect(src).toMatch(/superpowers:skills\/shared\/conductor\/context-mode-adapter\.md/);
  });

  it('the blocked-fetch check BITES: a fixture with a curl directive fails', () => {
    // Prove non-vacuity: a skill with a bare `curl http...` directive (not in
    // an adapter native-fallback fence) must trip the lint.
    const tmp = fs.mkdtempSync(path.join(ROOT, 'tests', '.fixture-fetch-'));
    try {
      const dir = path.join(tmp, 'bad-fetch-skill');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        '---\nname: bad-fetch-skill\ndescription: x\n---\n\nRun `curl -sf https://example.com/api` to fetch the data.\n',
      );
      const rel = path.relative(ROOT, dir);
      const r = runLint([rel]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/blocked fetch pattern/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
