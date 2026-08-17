import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Task 6 (skill-semantics-routing): Assumptions and Carried constraints become
// required task-brief sections, and implementer reports become durable file
// artefacts the orchestrator reads instead of re-eliciting.
//
// Task 3 (skill-semantics-routing): plan step content is bound to the task's
// modelTier, and the tier-to-step-format invariant is stated.
//
// Task 5 (skill-semantics-routing): a Lightweight classification is
// re-checked at verification-before-completion and escalation is a decision
// point, never a silent re-route or a de-escalation.

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
const planAuthoring = fs.readFileSync(
  path.join(ROOT, 'skills/writing-plans/references/plan-authoring.md'),
  'utf8'
);
const routingGuide = fs.readFileSync(
  path.join(ROOT, 'skills/using-superpowers/references/routing-guide.md'),
  'utf8'
);
const verificationBeforeCompletion = fs.readFileSync(
  path.join(ROOT, 'skills/verification-before-completion/SKILL.md'),
  'utf8'
);

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

describe('writing-plans — step content conditional on modelTier', () => {
  const writingPlansAndReference = writingPlans + '\n' + planAuthoring;

  it('states the complete-code requirement for mechanical', () => {
    expect(writingPlansAndReference).toMatch(/`mechanical`[\s\S]{0,120}complete,? runnable code/i);
  });

  it('states the requirements-and-interfaces form for standard, advanced, and frontier, with implementation excluded', () => {
    expect(writingPlansAndReference).toMatch(/`standard`\/`advanced`\/`frontier`|standard.{0,10}advanced.{0,10}frontier/i);
    expect(writingPlansAndReference).toMatch(/requirements/i);
    expect(writingPlansAndReference).toMatch(/exact-signature interfaces|interfaces with exact signatures/i);
    expect(writingPlansAndReference).toMatch(/verification obligations/i);
    expect(writingPlansAndReference).toMatch(/implementation[\s\S]{0,40}excluded/i);
  });

  it('states the tier-to-step-format invariant', () => {
    const idx = writingPlans.indexOf('**Invariant:**');
    expect(idx).toBeGreaterThan(-1);
    const block = writingPlans.slice(idx, idx + 400);
    expect(block).toMatch(/step format is bound to the `modelTier`/);
    expect(block).toMatch(/rewriting that task's steps/);
    expect(block).toMatch(/stops at `advanced`/);
  });
});

describe('No Placeholders — tier-conditional carve-out', () => {
  it('keeps TBD/TODO and the other banned patterns as failures at every tier', () => {
    expect(writingPlans).toMatch(/plan failure at every tier/);
    expect(planAuthoring).toMatch(/plan failures at every `modelTier`/);
    for (const pattern of [/TBD/, /TODO/, /appropriate error handling/i, /write tests for the above/i, /similar to Task N/i]) {
      expect(planAuthoring).toMatch(pattern);
    }
    expect(planAuthoring).toMatch(/not defined in any task/);
  });

  it('carves out describe-without-show only, and only for non-mechanical tiers', () => {
    expect(writingPlans).toMatch(/Describe-without-show is a failure only at `mechanical`/);
    expect(planAuthoring).toMatch(/failure only at `mechanical`/);
    expect(planAuthoring).toMatch(/describing without showing is the required form/i);
  });
});

describe('routing-guide.md — escalation triggers', () => {
  it('names all four escalation triggers', () => {
    const idx = routingGuide.indexOf('### Escalation triggers');
    expect(idx).toBeGreaterThan(-1);
    const block = routingGuide.slice(idx, idx + 900);
    expect(block).toMatch(/scope grows past two files/i);
    expect(block).toMatch(/new condition, gate, or trigger/i);
    expect(block).toMatch(/user-visible change/i);
    expect(block).toMatch(/migration or data-shape change/i);
  });
});

describe('tier re-assessment — decision point, not a re-route', () => {
  it('names verification-before-completion as where the re-check runs', () => {
    expect(routingGuide).toMatch(/`verification-before-completion` runs the re-check/);
    expect(verificationBeforeCompletion).toMatch(/Tier Escalation Check/);
    expect(verificationBeforeCompletion).toMatch(/routing-guide\.md/);
  });

  it('states escalation as a decision point: stop, report, ask — not an automatic re-route', () => {
    const combined = routingGuide + '\n' + verificationBeforeCompletion;
    expect(combined).toMatch(/decision point, not a re-route/i);
    expect(combined).toMatch(/reports? which condition failed/i);
    expect(combined).toMatch(/asks? whether to continue/i);
  });

  it('excludes de-escalation: escalation is one-directional', () => {
    const combined = routingGuide + '\n' + verificationBeforeCompletion;
    expect(combined).toMatch(/one-directional/i);
    expect(combined).toMatch(/nothing de-escalates|never re-classified back down/i);
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
