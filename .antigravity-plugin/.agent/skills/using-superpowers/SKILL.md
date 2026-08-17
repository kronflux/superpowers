---
name: using-superpowers
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions
---

<!-- compact-core:start -->
Override order: user instruction > project context file > skill > default.

## Complexity Tiers

Classify before the Entry Sequence (criteria: `references/routing-guide.md`): **Micro** (typo/rename/1-line, zero ambiguity) skips entry entirely; **Lightweight** (bounded scope, no new gate, no user-visible change, no migration) skips straight to implementation with one gate (`verification-before-completion`); **Full** (everything else, incl. any hard override) runs `brainstorming` → `writing-plans` → dispatch. Anything you have to think about is not micro.

## Routing Guide

Skills: `.agent/skills/<name>/SKILL.md` via view_file on the SKILL.md. Detail: `references/routing-guide.md`.

|Situation|Skill|
|---|---|
|Work may be unnecessary|premise-check|
|Unclear decision space|deliberation → brainstorming|
|New behavior/architecture|brainstorming → writing-plans|
|Define acceptance gates|specifying-gates|
|Verify acceptance gates|checking-gates|
|Plan execution, same session|subagent-driven-development|
|Plan execution, new session|executing-plans|
|Risky work, isolation|Workspace: "branch" on invoke_subagent (see AGENTS.md)|
|Bug or test failure|systematic-debugging → test-driven-development|
|Completion claim|verification-before-completion|
|Branch integration|finishing-a-development-branch|
|Code review (incl. security)|requesting- / receiving-code-review|
|Independent parallel tasks|dispatching-parallel-agents|
|Cross-session state|context-management|
|Recurring error→fix|error-recovery|
|Restructure, same behavior|refactoring|
|Performance issues|performance-investigation|
|Deps, CVEs, migrations|dependency-management|
|UI/frontend work|frontend-design|
|CLAUDE.md/AGENTS.md work|claude-md-creator|
|Data-work tool selection|routing.md (auto)|

## Skill Files

Never Read a skill file to "check" it — invoke it via view_file on the SKILL.md. Exception: `${CLAUDE_PLUGIN_ROOT}/skills/shared/*.md` are reference documents; Read/link them freely.
<!-- compact-core:end -->

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first.

Then follow the skill exactly. If it has a checklist, create a todo per item. Do not open with "I'm using X" — the harness already shows which skill is active, and `${CLAUDE_PLUGIN_ROOT}/skills/shared/output-contract.md` governs what the first line carries instead.

## Entry Sequence

1. Invoke `.agent/skills/token-efficiency/SKILL.md` when available.
2. **Fresh project gate:** creation intent (build/create/make/implement/scaffold/set up/write/generate/develop/start) + no `project-map.md`/`.superpowers-no-projectmap` at root → pause, give the pitch in routing-guide.md, wait; decline writes the marker — never re-offer.
3. Memory: read `state.md`, `known-issues.md`, `project-map.md` if present; decision-heavy session end → `[saved]` entry via `.agent/skills/context-management/SKILL.md`; `<project-map-stale>` → refresh per routing-guide.md.
4. Route via the table.

## Skill Priority

Process skills come first, then implementation skills carry it out — e.g. "Let's build X" → brainstorming first; "Fix this bug" → systematic-debugging first.

## Platform Adaptation

Read your harness file in `references/`: codex-tools.md, pi-tools.md, antigravity-tools.md, copilot-tools.md, gemini-tools.md.

## User Instructions

User instructions (CLAUDE.md/AGENTS.md, direct requests) override skills; skills override defaults. Skip a skill only when your human partner explicitly says so.
