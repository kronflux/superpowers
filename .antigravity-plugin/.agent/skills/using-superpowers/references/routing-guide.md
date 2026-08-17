# Using Superpowers — Routing Detail

Detail moved out of the session-start core (`SKILL.md`) to keep the always-injected payload small. Read the section a core pointer names; nothing here overrides the core's rules.

## Fresh Project Gate (Entry Sequence step 2)

Evaluate both conditions in order:

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

- **If they confirm:** run `git init --quiet` directly (do not ask again — the user just confirmed), then invoke `.agent/skills/context-management/SKILL.md` for map generation only. Return to the next entry-sequence step when done.
- **If they decline:** write `.superpowers-no-projectmap` to the project root and never offer again; proceed to the next entry-sequence step.

### Step 2b (only when the gate did not fire)

If the request is non-trivial AND `project-map.md` does not exist AND the project has 10+ files, mention once (do not block): *"Note: this project has no project-map.md. Want faster orientation in future sessions? Say 'map this project' and I'll generate one after this task."* Do not repeat this notice within the session.

## Complexity Tiers (Entry Sequence pre-step)

- **Micro** — typo fix, single rename, ≤1-line config change, zero behavioral ambiguity. Skip the entry sequence entirely; just do it. Stretching "simple" past this is a default classification, not something your own judgment can override — per the override-order line, only a user instruction or project context file outranks the skill.
- **Lightweight** — ALL FOUR hold, and you state in one sentence each why: scope ~2 files or fewer; no new condition/gate/trigger; no user-visible change; no migration/data-shape change. Skip brainstorming/planning/worktrees/parallel-dispatch; go straight to implementation; the single required gate is `verification-before-completion`; still invoke a dedicated implementation skill if one exists for the task.
- **Full** — everything else. A **hard override** forces Full immediately regardless of scope: a new condition/gate/trigger, anything the user sees/experiences, an edit to a file other components depend on, or a new path/outcome that didn't exist before. Route: `.agent/skills/brainstorming/SKILL.md` → `.agent/skills/writing-plans/SKILL.md` → dispatch (subagent-driven-development or executing-plans).

## Context-Mode Detection

The session-start hook injects a context-mode-active flag. When active, data-processing work in routed skills is governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/conductor/routing.md` — declare the job and follow its chain; state-probes, mutations, and file writes stay native. When inactive, use native tools.

## Stale Project Map Refresh

Read `project-map.md` to orient without re-globbing known files; when you need a file's actual content, Read it directly. If the session-start hook injected `<project-map-stale>`: with git, `git diff --name-only <map_hash> HEAD`, re-read only changed files, update their Key Files entries and the map header; without git, re-read files newer than the map's timestamp and refresh the header.

## Routing Table Elaboration

- `.agent/skills/premise-check/SKILL.md` — work may not need to exist at all; run before brainstorming or planning.
- `.agent/skills/deliberation/SKILL.md` — complex decision where options or framing are unclear; then brainstorming → writing-plans.
- `.agent/skills/brainstorming/SKILL.md` → `.agent/skills/writing-plans/SKILL.md` — new behavior or architecture that is already well-framed.
- `.agent/skills/systematic-debugging/SKILL.md` → `.agent/skills/test-driven-development/SKILL.md` — any bug or test failure, before proposing fixes.
- `.agent/skills/requesting-code-review/SKILL.md` / `.agent/skills/receiving-code-review/SKILL.md` — code review includes security review.
- `.agent/skills/dispatching-parallel-agents/SKILL.md` — independent parallel tasks outside plan execution.
- `.agent/skills/claude-md-creator/SKILL.md` — CLAUDE.md / AGENTS.md creation or update; never implement these directly.
- `${CLAUDE_PLUGIN_ROOT}/skills/shared/conductor/routing.md` — tool selection for data processing; auto-applied reference, not a Skill-tool invocation.

Internal, never routed directly: `.agent/skills/self-consistency-reasoner/SKILL.md` (invoked by systematic-debugging and verification-before-completion); `.agent/skills/token-efficiency/SKILL.md` (entry-sequence step 1, when available).

Antigravity note: worktree isolation maps to `Workspace: "branch"` on `invoke_subagent` (see AGENTS.md) — the using-git-worktrees skill is not shipped in that profile.
