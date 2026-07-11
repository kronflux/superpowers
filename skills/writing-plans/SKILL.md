---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## CRITICAL CONSTRAINTS — Read Before Anything Else

**You MUST NOT call `EnterPlanMode` or `ExitPlanMode` at any point during this skill.** This skill operates in normal mode. Calling `EnterPlanMode` traps the session in plan mode where Write/Edit are restricted. Calling `ExitPlanMode` breaks the workflow and skips the user's execution choice. If you feel the urge to call either, STOP — follow this skill's instructions instead. Completion is handled by the deterministic Execution Handoff at the end of this skill, not by plan-mode tooling.

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** If working in an isolated worktree, it should have been created via the `superpowers:using-git-worktrees` skill at execution time.

**Save plans to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- (User preferences for plan location override this default)

When the `context-mode` plugin is active (its `ctx_*` MCP tools are present), route data work (analysis reads, count/filter/aggregate greps, unbounded exploratory Bash output) through the ctx tools per `skills/shared/context-mode-adapter.md`. State-probes, mutations, file writes, and git stay native.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## REQUIRED FIRST STEP: Initialize Task Tracking

**BEFORE exploring code or writing the plan, you MUST:**

1. Call `TaskList` to check for existing tasks from brainstorming
2. If tasks exist: you will enhance them with implementation details as you write the plan
3. If no tasks: you will create them with `TaskCreate` as you write each plan task

**Do not proceed to exploration until TaskList has been called.**

```
TaskList
```

## File Structure

Before defining tasks, map which files each task creates/modifies and their single responsibility. File-sizing heuristics and split-by-responsibility rules: `references/plan-authoring.md`.

## Task Right-Sizing

A task is the smallest unit that carries its own test cycle and is worth a
fresh reviewer's gate. When drawing task boundaries: fold setup,
configuration, scaffolding, and documentation steps into the task whose
deliverable needs them; split only where a reviewer could meaningfully
reject one task while approving its neighbor. Each task ends with an
independently testable deliverable.

**Scope test:**
1. Can it be verified independently? (if no → too small)
2. Does it touch more than one concern? (if yes → too big)
3. Would it get its own commit? (if no → merge with adjacent task)

See `skills/shared/task-format-reference.md` for the full granularity guide.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Assumptions:** [List the key assumptions this plan rests on. For each, state what it excludes: "Assumes X — will NOT work if Y."] *(skip only if the plan contains zero conditional logic)*

## Global Constraints

[The spec's project-wide requirements — version floors, dependency limits,
naming and copy rules, platform requirements — one line each, with exact
values copied verbatim from the spec. Every task's requirements implicitly
include this section.]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Goal:** [One sentence — what this task produces]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Security flag:** `none` *(set to `security` if this task handles auth, credentials, input validation,
permissions, crypto, or data access boundaries — triggers pre-implementation security review before dispatch)*

**Interfaces:**
- Consumes: [what this task uses from earlier tasks — exact signatures]
- Produces: [what later tasks rely on — exact function names, parameter
  and return types. A task's implementer sees only their own task; this
  block is how they learn the names and types neighboring tasks use.]

**Acceptance Criteria:**
- [ ] [Concrete, testable criterion]
- [ ] [Another criterion]

**Does NOT cover:** *(required when this task adds a condition, gate, trigger, or any "when X do Y" logic — state the scenarios the condition excludes. If an excluded scenario should be covered, revise this task before implementing.)*

**Verify:** `exact test command` → expected output

**Steps:**

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## No Placeholders

Every step must contain the actual content an engineer needs; placeholder or hand-wave content is a **plan failure**. Full banned-patterns list (TBD/TODO, vague "add error handling", "write tests for the above" without code, "similar to Task N", describe-without-show, undefined-symbol references): `references/plan-authoring.md` → "No Placeholders".

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the plan, run the fresh-eyes checklist against the spec — spec coverage, placeholder scan, type consistency, scope-reduction scan — fixing issues inline. Full checklist: `references/plan-authoring.md`.

## Gate enforcement heads-up (only if user-gate tasks were tagged AND the hook isn't registered)

Show the opt-in heads-up before the Execution Handoff only if some task has `userGate: true` AND the canonical user-gate hook isn't registered in the merged settings files. Otherwise suppress it; never make it an `AskUserQuestion`. Detection command + exact text: `references/user-gate-tagging.md`.

## Execution Handoff

<HARD-GATE>
STOP. You are about to complete the plan. DO NOT call EnterPlanMode or ExitPlanMode. Both are FORBIDDEN — EnterPlanMode traps the session, ExitPlanMode skips the user's execution choice. Do NOT call AskUserQuestion either; completion is deterministic per the Selection Logic below.
</HARD-GATE>

After saving the plan and completing self-review, auto-select the execution approach using the logic below, then output the ready message and **stop**. Do not invoke any execution skill until the user replies.

### Selection Logic (evaluate in order)

1. Current context window ≥ 60% full → **Subagent-Driven** (offload context pressure)
2. Task count ≥ 5 → **Subagent-Driven** (fresh context per task)
3. Tasks have heavy inter-task state sharing (each task depends on runtime state from the previous) → **Inline**
4. Default → **Subagent-Driven**

### Ready Message

```
Plan saved to `docs/superpowers/plans/<filename>.md`. Ready to execute with **[Subagent-Driven / Inline Execution]** (<N> tasks[, <one-word reason>]). Reply to start, or say "inline" / "subagent" to switch.
```

**Stop here.** Do not invoke any execution skill until the user replies.

### On User Reply

**If Subagent-Driven:**
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review

**If Inline Execution:**
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Continuous execution with checkpoints for review

---

## Native Task Integration Reference

Use Claude Code's native task tools (v2.1.16+) to create structured tasks alongside the plan document.

### Creating Native Tasks

For each plan task, create a native task. Embed metadata as a `json:metadata` fence at the END of the description — the only way it survives TaskGet (the `metadata` param is accepted but not returned).

#### User-Thrown Gates — detection + tagging

Run gate-detection on EVERY task. The keyword buckets, the trigger rule (real gate vs. bare verb), and the tagging steps — set `"userGate": true`, append `"user-gate"` to `tags`, set `"requiresUserSpecification": true` when the HOW is vague, add the NON-SKIPPABLE banner, declare `requireEvidenceTokens` axes — plus the AC / per-task-isolation self-checks are in `references/user-gate-tagging.md`. Do NOT ask gate questions during write-plan; a vague HOW routes to `/specify-gate` via `requiresUserSpecification: true`. Full schema (six gate keys): `skills/shared/task-format-reference.md` → "User-Thrown Gates".

#### TaskCreate description — full structured body, not a summary

**Hard rule.** Every TaskCreate `description` MUST contain, verbatim, the same **Goal / Files / Acceptance Criteria / Verify** sections you wrote into the plan `.md` for that task. Do NOT condense into a one-sentence summary. Do NOT move the AC to "see the plan doc". Do NOT omit `**Verify:**`. The description MUST end with the `json:metadata` code fence. (Rationale + post-TaskCreate self-check: `references/native-task-mechanics.md`.)

```yaml
TaskCreate:
  subject: "Task N: [Component Name]"
  description: |
    **Goal:** [From task's Goal line]

    **Files:**
    [From task's Files section]

    **Acceptance Criteria:**
    [From task's Acceptance Criteria]

    **Verify:** [From task's Verify line]

    **Steps:**
    [Key actions from task's Steps — abbreviated]

    ```json:metadata
    {"files": ["path/to/file1.py"], "verifyCommand": "pytest tests/path/ -v", "acceptanceCriteria": ["criterion 1", "criterion 2"], "modelTier": "mechanical"}
    ```
  activeForm: "Implementing [Component Name]"
```

**`modelTier`** — capability tier for routing: `"mechanical"` | `"standard"` | `"frontier"`. Resolved at dispatch via `docs/superpowers/model-routing.json` (absent → inert metadata); a concrete `model` pin overrides it. Tier definitions: `skills/shared/task-format-reference.md`.

### Native task mechanics

Embedded-metadata rationale, `blockedBy` dependencies, and `status` updates during execution: `references/native-task-mechanics.md`.

---

## Task Persistence

At plan completion, write `<plan>.md.tasks.json` next to the plan `.md` (both co-located in `docs/superpowers/plans/`). Schema, worked example, and the resume command (`/superpowers:executing-plans <plan-path>`): `references/native-task-mechanics.md`.
