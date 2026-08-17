import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Task 6 (skill-semantics-routing): Assumptions and Carried constraints become
// required task-brief sections, and implementer reports become durable file
// artefacts the orchestrator reads instead of re-eliciting.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKILL_SIZE_BUDGET = 12288; // bytes — matches tests/lint-skills.mjs

const taskFormatRef = fs.readFileSync(path.join(ROOT, 'skills/shared/task-format-reference.md'), 'utf8');
const writingPlans = fs.readFileSync(path.join(ROOT, 'skills/writing-plans/SKILL.md'), 'utf8');
const sdd = fs.readFileSync(path.join(ROOT, 'skills/subagent-driven-development/SKILL.md'), 'utf8');
const dispatchHandoffs = fs.readFileSync(
  path.join(ROOT, 'skills/subagent-driven-development/references/dispatch-and-handoffs.md'),
  'utf8'
);
const controllerOps = fs.readFileSync(
  path.join(ROOT, 'skills/subagent-driven-development/references/controller-operations.md'),
  'utf8'
);
const sddCombined = [sdd, dispatchHandoffs, controllerOps].join('\n');

function requiredSectionsBlock(text) {
  const start = text.indexOf('### Required Sections');
  const end = text.indexOf('### Optional Sections');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** Recursively collects every SKILL.md path under skills/. */
function findSkillFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSkillFiles(full));
    else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

describe('task-format-reference.md — Assumptions and Carried constraints', () => {
  it('lists both new sections under Required Sections, not Optional', () => {
    const required = requiredSectionsBlock(taskFormatRef);
    expect(required).toMatch(/\*\*Assumptions — verify before relying:\*\*/);
    expect(required).toMatch(/\*\*Carried constraints:\*\*/);
  });

  it('permits an explicit None for both sections', () => {
    const required = requiredSectionsBlock(taskFormatRef);
    const assumptionsIdx = required.indexOf('Assumptions — verify before relying');
    const carriedIdx = required.indexOf('Carried constraints');
    expect(assumptionsIdx).toBeGreaterThan(-1);
    expect(carriedIdx).toBeGreaterThan(-1);
    expect(required.slice(assumptionsIdx, assumptionsIdx + 250)).toMatch(/`None`/);
    expect(required.slice(carriedIdx, carriedIdx + 250)).toMatch(/`None`/);
  });
});

describe('writing-plans SKILL.md — verbatim-reproduction rule', () => {
  it('names both new sections in the hard rule', () => {
    const idx = writingPlans.indexOf('**Hard rule.**');
    expect(idx).toBeGreaterThan(-1);
    const hardRule = writingPlans.slice(idx, idx + 600);
    expect(hardRule).toMatch(/Assumptions/);
    expect(hardRule).toMatch(/Carried constraints/);
  });
});

describe('subagent-driven-development — report files as durable artefacts', () => {
  it('requires the implementer to write its report to a file as its final action', () => {
    expect(sddCombined).toMatch(/final action/i);
    expect(sddCombined).toMatch(/report file|writes? its full report/i);
  });

  it('requires the orchestrator to read the report file rather than re-prompt', () => {
    expect(sddCombined).toMatch(/reads? that file/i);
    expect(sddCombined).toMatch(/re-prompt/i);
  });

  it('requires the carried-constraints list to be re-emitted into each dispatched brief', () => {
    expect(sddCombined).toMatch(/carried-constraints list/i);
    expect(sddCombined).toMatch(/re-emit/i);
    expect(sddCombined).toMatch(/(each|every) (dispatched )?brief/i);
  });
});

describe('SKILL.md byte budget', () => {
  it('no SKILL.md exceeds the 12,288 B budget', () => {
    const files = findSkillFiles(path.join(ROOT, 'skills'));
    expect(files.length).toBeGreaterThan(0);
    const over = files
      .map((f) => ({ f, size: Buffer.byteLength(fs.readFileSync(f)) }))
      .filter(({ size }) => size > SKILL_SIZE_BUDGET);
    expect(over).toEqual([]);
  });
});
