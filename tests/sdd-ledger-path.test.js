import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SDD = path.join(ROOT, 'skills', 'subagent-driven-development');

describe('SDD ledger path', () => {
  it('no doc tells a controller to read a literal flat ledger path', () => {
    // The flat path names whichever plan wrote it last. Briefs and review
    // packages became plan-scoped; the ledger was missed, and six releases
    // worked around the collision by inventing filename prefixes.
    const docs = [
      path.join(SDD, 'SKILL.md'),
      path.join(SDD, 'references', 'controller-operations.md'),
      path.join(SDD, 'references', 'dispatch-and-handoffs.md'),
    ];
    for (const d of docs) {
      const text = fs.readFileSync(d, 'utf8');
      expect(text, `${path.basename(d)} names a flat ledger path`)
        .not.toMatch(/\.superpowers\/sdd\/progress\.md/);
    }
  });

  it('the documented resume command resolves through sdd-workspace', () => {
    const text = fs.readFileSync(path.join(SDD, 'references', 'controller-operations.md'), 'utf8');
    expect(text).toMatch(/sdd-workspace[^\n]*progress\.md/);
  });

  describe('two plans resolve to two different ledger paths', () => {
    // sdd-workspace requires the plan file to exist; these fixtures are
    // created here (and removed after) rather than committed, since
    // .superpowers/ is entirely gitignored scratch.
    const plansDir = path.join(ROOT, '.superpowers', 'plans');
    const planAlpha = path.join(plansDir, 'plan-alpha.md');
    const planBeta = path.join(plansDir, 'plan-beta.md');
    const wsAlpha = path.join(ROOT, '.superpowers', 'sdd', 'plan-alpha');
    const wsBeta = path.join(ROOT, '.superpowers', 'sdd', 'plan-beta');

    beforeAll(() => {
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(planAlpha, '# plan-alpha\n');
      fs.writeFileSync(planBeta, '# plan-beta\n');
    });

    afterAll(() => {
      fs.rmSync(planAlpha, { force: true });
      fs.rmSync(planBeta, { force: true });
      fs.rmSync(wsAlpha, { recursive: true, force: true });
      fs.rmSync(wsBeta, { recursive: true, force: true });
    });

    it('resolves distinct workspace paths', () => {
      const script = path.join(SDD, 'scripts', 'sdd-workspace');
      const resolve = (plan) =>
        execFileSync('bash', [script, plan], { cwd: ROOT, encoding: 'utf8' }).trim();
      const a = resolve('.superpowers/plans/plan-alpha.md');
      const b = resolve('.superpowers/plans/plan-beta.md');
      expect(a).not.toBe(b);
      expect(a.endsWith('plan-alpha')).toBe(true);
      expect(b.endsWith('plan-beta')).toBe(true);
    });
  });
});
