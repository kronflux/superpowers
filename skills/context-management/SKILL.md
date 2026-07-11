---
name: context-management
description: 'Persists durable state across sessions via state.md; generates project-map.md on request. Not for in-session brevity (token-efficiency). Triggers: "save state", "compress context", "map this project", "generate project map", cross-session handoff.'
---

# Context Management

## Adapter Link

This skill writes durable human-curated files (`state.md`, `session-log.md`, `project-map.md`) and probes git state. Per `superpowers:skills/shared/context-mode-adapter.md`: all file writes use **native** Write/Edit and all git state-probes (`git rev-parse`, `git init`) stay **native** in both modes — `ctx_execute*` discard their sandbox filesystem, so writes must not be routed through them. Only the **query** side is data-processing: searching `session-log.md` / `project-map.md` is routed via `ctx_search`/`ctx_execute_file` when context-mode is active, and native grep when inactive (native fallback).

**Overlap with context-mode session memory:** context-mode auto-capture and this skill's curated files are distinct layers with different owners and lifetimes. See [The Four Memory Layers](#the-four-memory-layers) for the authoritative contract — which layer holds what, and when to query each.

## Route first — read this before anything else

| User said | Go to |
|---|---|
| "map this project" / "generate project map" / "create project map" / "update project map" | [Project Map](#project-map) section |
| "save state" / "compress context" / session ending with ongoing work | [Procedure](#procedure) section |
| Starting a task on a project with existing history | Search `session-log.md` first (per Adapter Link), then proceed |

Do not default to `state.md` for a map request. Do not default to `project-map.md` for a save-state request.

---

## Purpose

Claude Code automatically compresses context within a session. This skill owns two of the four memory layers defined below: the session-boundary snapshot (`state.md`) for the *current task* when a session ends mid-work, and durable project memory (`session-log.md`, `known-issues.md`, `project-map.md`) — written manually via this skill, only when there is something worth preserving.

## The Four Memory Layers

| Layer | Store | Owner | Lifetime | Recall |
|---|---|---|---|---|
| In-session auto-capture | context-mode SQLite | context-mode | ~7 days, machine-local | `ctx_search` (`sort:"timeline"` on resume) |
| Session boundary | `state.md` | this skill | until superseded | Read at resume |
| Durable project memory | `session-log.md`, `known-issues.md`, `project-map.md` | this skill | permanent, git-committed | skill-activator grep + `ctx_search` when indexed |
| Assistant memory | harness memory dir | harness | per harness | harness-managed |

**Where to write:** decision made this session that matters later → session-log `[saved]` entry.
Mid-task snapshot before /compact or handoff → state.md. Recurring error + fix → known-issues.md.
Structure/constraints of the repo → project-map.md. Everything else → nowhere (context-mode captures it).

**Promotion protocol:** context-mode wipes auto-captured memory after ~7–14 days and it never leaves
this machine. At every save point, review what auto-capture holds (`ctx_search`, timeline) and promote
decisions worth keeping into `[saved]` entries. Capture is context-mode's job; promotion is yours.

**Indexing step (ctx active):** after writing durable artifacts, `ctx_index` them
(`docs/superpowers/plans`, `docs/superpowers/specs`, `session-log.md`, `known-issues.md`,
`docs/ARCHITECTURE.md`) so future sessions search instead of re-reading. Idempotent (mtime+SHA refresh).

**Resume protocol:** 1) `ctx_search(sort:"timeline")` for the tail of the prior session;
2) Read `state.md`; 3) targeted `ctx_search` of durable artifacts. Only then touch code.

## When to Use

- User explicitly asks to save state or compress context
- Work will continue in a new session and progress must be preserved
- Complex multi-step task has significant accumulated decisions/evidence
- Starting a new task on a project with existing history — search the log first
- Repeated failures suggest the session has accumulated stale/conflicting context

## Procedure

### At the start of any non-trivial task

Before diving in, search `session-log.md` for history relevant to the current task. Full keyword-search procedure: see [references/details.md](references/details.md#searching-the-log-at-task-start).

### When saving state (explicit invocation)

1. Extract durable artifacts only:
   - Approved design decisions
   - Active plan tasks and their status
   - Verified facts/evidence
   - Open questions/risks

   For the `state.md` vs `plan.md` distinction, see [references/details.md](references/details.md#statemd-vs-planmd).

2. Write `state.md` at the project root with concise sections (use native Write/Edit — see Adapter Link):
   - `Current Goal`
   - `Decisions`
   - `Plan Status`
   - `Evidence`
   - `Open Issues`

3. **Check for superseded entries before appending.** If the new decision *directly contradicts* an old `[saved]` entry, append `[superseded by YYYY-MM-DD]` to that entry's header line — do not delete it. Search method and judgment guidance: see [references/details.md](references/details.md#checking-for-superseded-entries).

4. Append a `[saved]` entry to `session-log.md` (native Write/Edit):

**What belongs here vs state.md:**
- `session-log.md [saved]`: permanent decisions, anti-patterns to avoid, carry-forward open items
- `state.md`: active task status, in-progress plans, checklists, version bump readiness — anything that will be resolved soon

**Never include in a [saved] entry:**
- Test results or verification confirmations ("11/11 tests pass")
- Task checklists, file changelogs, or release notes → use `state.md`
- "How it works" walkthroughs → read the code
- Speculative analysis not approved for implementation → use a design doc in `docs/`
- One-time confirmations ("file deleted", "folder removed")
- Newly discovered permanent architectural constraints → add to `project-map.md` Critical Constraints instead

**Hard limits per component — enforce while writing, not after:**
- Goal: 1 line, ≤15 words
- Decisions: ≤5 bullets for multi-subsystem sessions, ≤3 for single-topic. Each bullet: decision + one-sentence why, ≤25 words total. No prose, no rationale beyond the why.
- Rejected: ≤3 bullets, ≤15 words each. What to avoid — not the full story of why it failed.
- Open: ≤2 items, ≤12 words each.

If a decision doesn't fit in 25 words, the explanation belongs in a design doc. Cut the explanation, not the decision.

Total entry backstop: 250 words / 1500 chars. If exceeded, a bullet violated its limit — find it and cut it. Typical single-topic sessions should target ~120 words; the higher cap exists for multi-subsystem sessions that genuinely touched 5+ areas.

```markdown
## YYYY-MM-DD HH:MM [saved]
Goal: <one line>
Decisions:
- <what was chosen and the one-sentence why — not how it works>
Rejected: <what NOT to try, one line each — the anti-pattern knowledge>
Open: <carry-forward items only>
```

5. After appending the `[saved]` entry, update the stop-hook marker so the decision-log reminder resets (native Bash state-write):
   ```bash
   node -e "require('fs').writeFileSync(require('path').join(process.env.HOME||process.env.USERPROFILE||'.', '.claude','hooks-logs','last-saved-entry.txt'), new Date().toISOString())"
   ```
   This prevents the stop hook from re-firing the decision-log reminder on every subsequent stop in the same session.

6. In a new session, follow the Resume protocol in [The Four Memory Layers](#the-four-memory-layers): timeline search of auto-capture, then `state.md`, then targeted search of durable artifacts. When context-mode is inactive, skip the `ctx_search` steps and search `session-log.md` with native grep (per Adapter Link).

## session-log.md Format and Maintenance

Entry type (`[saved]`), file-management rules (root location, 200-entry cap, superseding via `[superseded by …]`, no trivial sessions), and cross-project recall scope: see [references/details.md](references/details.md#session-logmd-format-and-maintenance).

## Project Map

`project-map.md` is the semantic memory layer — it captures the project's structure, key file purposes, and critical non-obvious constraints so that future sessions can orient without re-globbing or re-reading known files. Generate it once; update it when the project changes.

### When to generate or update

- User says "map this project", "generate project map", or "update project map"
- First time setting up memory on a new project
- After a major refactor where many files moved or changed purpose

### Generation procedure

1. **Check for git** (native state-probe — stays native in both modes):
   ```bash
   git rev-parse --git-dir 2>/dev/null
   ```
   - If git exists → record `git rev-parse HEAD` as the staleness hash.
   - If git does NOT exist → offer: *"No git repository detected. Shall I run `git init`? It enables precise staleness tracking for `project-map.md` — creates a `.git` folder, touches none of your files. If you'd prefer not to, I'll fall back to file timestamp comparison instead, which works fine but is slightly less precise."*
     - User confirms → run `git init --quiet` (native), then proceed with git hash.
     - User declines → use generation timestamp as the staleness marker.

2. **Map the structure:** Glob the project, identify the top-level directories and their purpose. Do not enumerate every file — summarise by directory.

3. **Document key files:** For each file that is load-bearing, non-obvious, or frequently referenced, write one line describing what it does and why it matters. Aim for 10–20 entries. Skip files whose purpose is obvious from their name.

4. **Capture critical constraints:** The highest-value section. These are non-obvious facts that are not visible in the code itself — quoting rules, platform differences, version sync requirements, things that caused bugs before. Pull these from `session-log.md` `[saved]` entries and from `known-issues.md` if they exist (query per Adapter Link).

5. **Identify hot files:** From `session-log.md` history, list the files most frequently appearing in `Files:` lines (query per Adapter Link). These are the ones most likely to need freshness checks on future sessions.

6. **Write `project-map.md` at the project root** with native Write/Edit (see Adapter Link) — same level as `CLAUDE.md` and `package.json`, never in `docs/` or any subdirectory. The session-start hook looks for it with `ls project-map.md 2>/dev/null` from the project root — if it's anywhere else, the hook cannot find it and every future session loses the map. Use this format:

```markdown
# Project Map
_Generated: YYYY-MM-DD HH:MM | Git: <short-hash> | (or: Staleness: timestamps)_

## Directory Structure
<dir>/ — <one-line purpose>
<dir>/ — <one-line purpose>

## Key Files
<path> — <what it does and why it matters>
<path> — <what it does and why it matters>

## Critical Constraints
- <non-obvious fact that would cost time to rediscover>
- <non-obvious fact that would cost time to rediscover>

## Hot Files
<path>, <path>, <path>
```

### Update procedure

When the staleness check in the entry sequence flags changed files:
1. Re-read only the flagged files.
2. Update their entries in the Key Files section (native Edit).
3. Update the git hash / timestamp in the header.
4. If any new critical constraints were discovered this session, add them.

Keep `project-map.md` under 150 lines. If it grows beyond that, it is not a map — it is documentation. Prune file entries for things that are now obvious from context.

## Guardrails

- Do not drop user-provided constraints.
- Do not rewrite requirements; preserve intent.
- If uncertain whether old context matters, keep a short reference in `Open Issues`.
- Keep `state.md` under 100 lines — if it's longer, it's not compressed enough.
