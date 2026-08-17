---
name: using-superpowers
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions
---

<!-- compact-core:start -->
Override order: user instruction > project context file > skill > default.

## Complexity Tiers

Micro (typo/1-line): skip entry. Lightweight (bounded, no new gate/visible/migration): one gate, `verification-before-completion`. Full (else, incl hard override): `brainstorming` → `writing-plans` → dispatch.

## Routing Guide

|Situation|Skill|
|---|---|
|Maybe unneeded|premise-check|
|Unclear options|deliberation|
|New behavior|brainstorming|
|Define gates|specifying-gates|
|Verify gates|checking-gates|
|Same session|subagent-driven-development|
|New session|executing-plans|
|Risky work|using-git-worktrees|
|Bug/test|systematic-debugging|
|Completion|verification-before-completion|
|Branch merge|finishing-a-development-branch|
|Code review|requesting-/receiving-code-review|
|Parallel|dispatching-parallel-agents|
|Cross-session|context-management|
|Recurring|error-recovery|
|Restructure|refactoring|
|Perf|performance-investigation|
|Deps/CVEs|dependency-management|
|UI/frontend|frontend-design|
|CLAUDE.md|claude-md-creator|
|Data tool|routing.md (auto)|

## Skill Files

Invoke via the Skill tool, never Read to check; `skills/shared/*.md` are references.
<!-- compact-core:end -->

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first.

Then follow the skill exactly. If it has a checklist, create a todo per item. Do not open with "I'm using X" — the harness already shows which skill is active, and `skills/shared/output-contract.md` governs what the first line carries instead.

## Entry Sequence

1. Invoke `superpowers:token-efficiency` when available.
2. **Fresh project gate:** creation intent (build/create/make/implement/scaffold/set up/write/generate/develop/start) + no `project-map.md`/`.superpowers-no-projectmap` at root → pause, give the pitch in routing-guide.md, wait; decline writes the marker — never re-offer.
3. Memory: read `state.md`, `known-issues.md`, `project-map.md` if present; decision-heavy session end → `[saved]` entry via `superpowers:context-management`; `<project-map-stale>` → refresh per routing-guide.md.
4. Route via the table.

Full tier criteria and routing detail: `references/routing-guide.md`.

## Skill Priority

Process skills come first, then implementation skills carry it out — e.g. "Let's build X" → brainstorming first; "Fix this bug" → systematic-debugging first.

## Platform Adaptation

Read your harness file in `references/`: codex-tools.md, pi-tools.md, antigravity-tools.md, copilot-tools.md, gemini-tools.md.

## User Instructions

User instructions (CLAUDE.md/AGENTS.md, direct requests) override skills; skills override defaults. Skip a skill only when your human partner explicitly says so.
