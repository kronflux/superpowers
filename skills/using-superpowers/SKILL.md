---
name: using-superpowers
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first.

Then announce "Using [skill] to [purpose]" and follow the skill exactly. If it has a checklist, create a todo per item.

## Sanctioned Exception (the only one)

A true micro-task — typo fix, single rename, ≤1-line config change with zero behavioral ambiguity — may skip the entry sequence. Anything you have to think about is not micro. Stretching "simple" beyond this list is exactly the rationalization the Red Flags table below rejects.

## Entry Sequence

1. Invoke `superpowers:token-efficiency` when available.
2. **Fresh project gate:** creation intent (build/create/make/implement/scaffold/set up/write/generate/develop/start) + no `project-map.md`/`.superpowers-no-projectmap` at root → pause, give the pitch in routing-guide.md, wait; decline writes the marker — never re-offer.
3. Memory: read `state.md`, `known-issues.md`, `project-map.md` if present; decision-heavy session end → `[saved]` entry via `superpowers:context-management`; `<project-map-stale>` → refresh per routing-guide.md.
4. Route via the table.

## Routing Guide

Skills: `superpowers:<name>` via Skill tool. Detail: `references/routing-guide.md`.

|Situation|Skill|
|---|---|
|Work may be unnecessary|premise-check|
|Unclear decision space|deliberation → brainstorming|
|New behavior/architecture|brainstorming → writing-plans|
|Define acceptance gates|specifying-gates|
|Verify acceptance gates|checking-gates|
|Plan execution, same session|subagent-driven-development|
|Plan execution, new session|executing-plans|
|Risky work, isolation|using-git-worktrees|
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
|Context-mode data work|context-mode-adapter.md (auto)|

## Skill Priority

When multiple skills apply, process skills come first — they set the approach, then implementation skills (frontend-design, etc.) carry it out. Brainstorming and systematic-debugging are Superpowers' most common process skills, but the rule holds for any of them.

- "Let's build X" → superpowers:brainstorming first, then implementation skills.
- "Fix this bug" → superpowers:systematic-debugging first, then domain skills.

## Red Flags

These thoughts mean STOP—you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Skill Files

Never Read a skill file to "check" it — invoke it via the Skill tool. Exception: `skills/shared/*.md` are reference documents; Read/link them freely.

## Platform Adaptation

Read your harness file in `references/`: codex-tools.md, pi-tools.md, antigravity-tools.md, copilot-tools.md, gemini-tools.md.

## User Instructions

User instructions (CLAUDE.md/AGENTS.md, direct requests) override skills; skills override defaults. Skip a skill only when your human partner explicitly says so.
