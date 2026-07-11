---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

## CRITICAL CONSTRAINTS

**You MUST NOT call `EnterPlanMode` or `ExitPlanMode` during this skill.** This skill operates in normal mode, executing a plan that already exists on disk. Plan mode is unnecessary and dangerous here — it restricts Write/Edit tools needed for implementation.

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** Tell your human partner that Superpowers works much better with access to subagents. The quality of its work will be significantly higher if run on a platform with subagent support (Claude Code, Codex CLI, Codex App, and Copilot CLI all qualify; see the per-platform tool refs in `../using-superpowers/references/`). If subagents are available, use .agent/skills/subagent-driven-development/SKILL.md instead of this skill.

## Tool Selection (context-mode aware)

When the `context-mode` plugin is active (its `ctx_*` MCP tools are present), route data work — web fetches, build-tool runs, unbounded Bash output, analysis reads, and count/filter/aggregate greps — through the ctx tools per `skills/shared/context-mode-adapter.md`. State-probes, mutations, file writes, and git operations stay native in both modes. When surfacing verification or `PROVEN BY` evidence, echo it into the conversation even if computed via ctx tools.

## The Process

### Step 0: Load Persisted Tasks

1. Call `the task.md task list` to check for existing native tasks
2. **CRITICAL - Locate tasks file:** Try `<plan-path>.tasks.json`, if not found glob for matching `.tasks.json`
3. If tasks file exists AND native tasks empty: recreate from JSON using the task.md task list:
   - Include full `description` from .tasks.json (not just subject)
   - Include `metadata` field if present (files, verifyCommand, acceptanceCriteria)
   - Restore `blockedBy` with the task.md task list
4. If native tasks exist: verify they match plan, resume from first `pending`/`in_progress`
5. If neither: proceed to Step 1b to bootstrap from plan

Update `.tasks.json` after every task status change.

### Step 0.5: Verify Workspace (Worktree Default Rule)

Decide worktree need by change type, and never create a duplicate:

1. Run `git worktree list` to see existing worktrees.
2. If a worktree for the plan's branch already exists: **cd into it — do NOT create a new one** (reuse).
3. If on `main`/`master` AND the plan involves code changes: **REQUIRED SUB-SKILL:** Use `.agent/skills/using-git-worktrees/SKILL.md` to ensure an isolated workspace.
4. If already on a feature branch, OR the plan is documentation/config-only: skip worktree setup. Confirm with your human partner that the current branch is appropriate.

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Proceed to task setup

### Step 1b: Bootstrap Tasks from Plan (if needed)

If the task.md task list returned no tasks or tasks don't match plan:

1. Parse the plan document for `## Task N:` or `### Task N:` headers
2. For each task found, use the task.md task list with:
   - subject: The task title from the plan
   - description: Full structured content (Goal, Files, Acceptance Criteria, Verify, Steps) with `json:metadata` code fence at the end containing files, verifyCommand, acceptanceCriteria
   - activeForm: Present tense action (e.g., "Implementing X")
3. **CRITICAL - Dependencies:** For EACH task that has blockedBy in the plan or .tasks.json:
   - Call `the task.md task list` with `taskId` and `addBlockedBy: [list-of-blocking-task-ids]`
   - Do NOT skip this step - dependencies are essential for correct execution order
4. Call `the task.md task list` and verify blockedBy relationships show correctly (e.g., "blocked by #1, #2")

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. **Use metadata for verification:** Parse the `json:metadata` code fence from the task description. Run `verifyCommand` and check each `acceptanceCriteria` before marking complete.
4. **User-thrown gates are non-skippable.** If the task's metadata has `"userGate": true` OR its `tags` array contains `"user-gate"`, you MUST:
   - Execute the gate exactly as specified — no inline shortcut, no cheaper substitute, no "I already verified this informally".
   - Capture concrete output for every entry in `acceptanceCriteria` (command output, entity state, log line, subagent result).
   - If any criterion cannot be proven right now, leave the task `in_progress` and surface the blocker to your human partner. Do NOT close it.
5. Mark as completed
6. **Sync `.tasks.json`:** Read the tasks file, update the task's `"status"` to `"completed"` (or `"in_progress"` in step 1), set `"lastUpdated"` to current ISO timestamp, write back. This keeps the persistence file in sync with native tasks for cross-session resume.

### Step 3: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use .agent/skills/finishing-a-development-branch/SKILL.md
- Follow that skill to verify tests, present options, execute choice

## Engineering Rigor for Complex Tasks

When a task is architectural, high-risk, or touches cross-module boundaries:
- Validate the approach against requirements and constraints before coding.
- Identify edge cases and error paths specific to this task.
- Consider simpler architectures or alternative approaches.
- Ensure changes remain maintainable and don't create hidden coupling.
- If 2 implementation attempts fail, pause and reassess the approach rather than forcing a third attempt.

## Context Hygiene

For each task, keep only:
- Current task details
- Constraints
- Relevant prior decisions
- Verification evidence

Do not carry long historical summaries. Never forward full session history to subagents — construct their prompts from scratch with only the items above.

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **.agent/skills/using-git-worktrees/SKILL.md** - Ensures isolated workspace (creates one or verifies existing)
- **.agent/skills/writing-plans/SKILL.md** - Creates the plan this skill executes
- **.agent/skills/finishing-a-development-branch/SKILL.md** - Complete development after all tasks
