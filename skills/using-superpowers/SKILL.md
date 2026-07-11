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

Runs for every non-micro request.

0. **Detect context-mode.** The session-start hook injects a context-mode-active flag. When active, data-processing work in routed skills follows `skills/shared/context-mode-adapter.md` — prefer ctx tools per the mapping; state-probes, mutations, and file writes stay native. When inactive, use native tools.
1. Invoke `superpowers:token-efficiency` when available (it ships with this plugin's engineering-skills set); if absent, this step is a no-op.
2. **Fresh project gate** — evaluate both conditions in order:
   - The user's request contains creation/build intent: any of "build", "create", "make", "implement", "scaffold", "set up", "write", "generate", "develop", "start"
   - Filesystem check: gate fires only if neither `project-map.md` nor `.superpowers-no-projectmap` exists at the project root

   If both are true, **pause before proceeding** and tell the user exactly this:

   > Before I start: this directory has no memory files set up yet. That matters for how well I perform across sessions.
   >
   > **Without setup, every future session on this project starts from scratch:**
   > - I re-explore the project structure even if I mapped it last session
   > - I re-read files I already understood
   > - I may re-propose already-rejected approaches
   > - I lose the "why" behind every decision the moment the session ends
   >
   > **A ~30-second setup changes that permanently:**
   > - `git init` — enables staleness tracking so I only re-read files that actually changed *(creates `.git` only, nothing else)*
   > - `project-map.md` — I read this at every future session start instead of re-exploring blind
   > - `session-log.md` — auto-captures what was built and decided, so future sessions start with the prior session's constraints already applied
   >
   > **Set this up before we build, or start immediately?**

   Wait for the user's answer before continuing.
   - **If they confirm:** run `git init --quiet` directly (do not ask again — the user just confirmed), then invoke `superpowers:context-management` for map generation only. Return to step 3 when done.
   - **If they decline:** write `.superpowers-no-projectmap` to the project root and never offer again; proceed to step 3.

   **Step 2b** (only when step 2 did not fire):
   If the request is non-trivial AND `project-map.md` does not exist AND the project has 10+ files, mention once (do not block): *"Note: this project has no project-map.md. Want faster orientation in future sessions? Say 'map this project' and I'll generate one after this task."* Do not repeat this notice within the session.
3. If resuming work from a prior session, read `state.md` if it exists. Before ending any session where significant decisions were made (design choices, rejected approaches, non-obvious constraints discovered), invoke `superpowers:context-management` to write a `[saved]` entry.
4. If `known-issues.md` exists at the project root, read it to avoid rediscovering known error→solution mappings.
5. If `project-map.md` exists at the project root, read it to orient without re-globbing known files; when you need a file's actual content, Read it directly. If the session-start hook injected `<project-map-stale>`: with git, `git diff --name-only <map_hash> HEAD`, re-read only changed files, update their Key Files entries and the map header; without git, re-read files newer than the map's timestamp and refresh the header.
6. Route via the Routing Guide below.

## Routing Guide

| Situation | Skill |
|---|---|
| Work may not need to exist at all | `superpowers:premise-check` (before brainstorming/planning) |
| Complex decision, unclear options or framing | `superpowers:deliberation` → brainstorming → writing-plans |
| New behavior or architecture (well-framed) | `superpowers:brainstorming` → `superpowers:writing-plans` |
| Defining acceptance criteria | `superpowers:specifying-gates` |
| Verifying acceptance criteria with evidence | `superpowers:checking-gates` |
| Plan execution, same session | `superpowers:subagent-driven-development` |
| Plan execution, separate session | `superpowers:executing-plans` |
| Risky work needing branch isolation | `superpowers:using-git-worktrees` |
| Bug or test failure | `superpowers:systematic-debugging` → `superpowers:test-driven-development` |
| Completion claim | `superpowers:verification-before-completion` |
| Branch integration | `superpowers:finishing-a-development-branch` |
| Code review (includes security) | `superpowers:requesting-code-review` / `superpowers:receiving-code-review` |
| Independent parallel tasks outside plan execution | `superpowers:dispatching-parallel-agents` |
| Cross-session state persistence | `superpowers:context-management` |
| Recurring error→fix tracking | `superpowers:error-recovery` |
| Restructuring without behavior change | `superpowers:refactoring` |
| Performance issues | `superpowers:performance-investigation` |
| Dependency updates, CVEs, migrations | `superpowers:dependency-management` |
| UI/frontend implementation | `superpowers:frontend-design` |
| CLAUDE.md / AGENTS.md creation or update | `superpowers:claude-md-creator` (never implement directly) |
| Data processing under context-mode | `skills/shared/context-mode-adapter.md` (auto-applied) |

Internal, never routed directly: `superpowers:self-consistency-reasoner` (invoked by systematic-debugging and verification-before-completion); `superpowers:token-efficiency` (step 1, when available).

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

If your harness appears here, read its reference file for special instructions:

- Codex: `references/codex-tools.md`
- Pi: `references/pi-tools.md`
- Antigravity: `references/antigravity-tools.md`
- Copilot CLI: `references/copilot-tools.md`
- Gemini CLI: `references/gemini-tools.md` (via GEMINI.md)

## User Instructions

User instructions (CLAUDE.md, AGENTS.md, GEMINI.md, etc, direct requests) take precedence over skills, which in turn override default behavior. Only skip skill workflows or instructions when your human partner has explicitly told you to.
