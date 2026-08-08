---
name: token-efficiency
description: 'Always-on operational standard: concise responses, parallel tool execution, no redundant work, exploration tracking, proactive context compression. Distinct from context-management (cross-session state). Applied automatically at session start.'
---

# Token Efficiency

Core operating standard for all sessions. Apply permanently from activation.

## Adapter Link

Tool selection is governed by `skills/shared/conductor/routing.md` — declare the job (discovery / symbol-edit / docs / output / dispatch / memory) and follow its chain. Direct fetch directives are hard-blocked when context-mode is active. Writes, mutations, and state-probes stay native regardless of job.

## Response Rules

Response shape — ordering, ranking, questions, forbidden language, and the pre-send check — is governed by `skills/shared/output-contract.md` and is not restated here. That contract exists because density and decidability are different objectives: output can be dense, filler-free, and still impossible for the reader to act on.

The one rule specific to token cost rather than readability: prefer structured output (JSON/YAML) when the result feeds a downstream step rather than a human reader.

## Tool Execution Rules

1. Batch independent tool calls in a single response — never serialize calls that can run in parallel.
2. Never shell out to Bash `ls` or `find` to locate files — use Glob for a known name or pattern, and the Adapter Link chain when the question is about structure rather than a path.
3. Match read scope to the task: a targeted search locates known content (a function, a config value, an error handler); a full read is needed when the task requires knowing what a file covers (scope assessment, gap analysis, systemic recommendations). Partial reads cannot prove absence.
4. Read returns at most 2,000 lines per call. Above that, page with `offset` and `limit` — never assume a single read covered the file.

## Exploration Tracking

Maintain a mental index of this session's exploration. Before every Read, Grep, Glob, or ctx analysis call, check it and skip the call if you already hold the result. Track, per category:

- **Files read** — path, plus whether you or any tool modified it since the read.
- **Searches performed** — pattern, directory scope, result summary.
- **Directory structures explored** — which directories you have listed or globbed.

| Situation | Action |
|---|---|
| File read, unmodified since | Do NOT re-read — use what you already know |
| File read, but YOU edited it since | Re-read that file |
| File read, but another tool or agent may have changed it | Re-read — external changes invalidate your knowledge |
| Path already confirmed to exist | Do NOT verify it again |
| Identical search pattern and scope | Do NOT re-run — reuse the previous results |
| Similar but broader search pattern | Run it — it may surface new results |
| Context compression occurred (earlier turns disappeared) | You keep your own reasoning and summaries; re-read only for exact content (line numbers, precise syntax) you genuinely cannot recall. When context-mode is active, prior decisions, errors, and captured outputs are searchable — query `ctx_search` (`sort:"timeline"`) before re-fetching |

## Agent & External Content Rules

1. **Agent results are compressed.** A subagent's full context — file reads, web fetches, reasoning — is reduced to a summary on return. Never dispatch an agent to fetch and return raw content, local or web-fetched: the content stays in its context and only the summary survives.
2. **Use agents for conclusions, not data relay.** Good: "analyze the test failures in X and recommend fixes." Bad: "fetch files A, B, C and return their contents." Content you need in your own context you pull in yourself, as a discovery job per the Adapter Link above.
3. **For local files, pull them in yourself.** Never dispatch an agent to read project files and report back — you lose the actual content and pay for the round trip. Read them as a discovery job.
4. **Verbatim URL content needs the right fetch path.** Fetch as a discovery job — raw page bytes never enter context when ctx tools are used. Do not assume read_url_content returns raw text; when context-mode is inactive it may return an AI-generated summary, so name the verbatim section explicitly.
5. **project-map.md is orientation, not understanding.** It gives directory purposes, key file roles, and constraints — never the logic inside a file. To modify, compare, or debug, read the file itself as a discovery job.

## Proactive Compaction Breakpoints

Break at logical seams rather than letting auto-compaction fire mid-task. Auto-compaction at 95% context fill destroys the most recent content — exactly the variable names, discovered paths, and evidence gathered just before implementation. A deliberate break at 50% keeps all of it.

| Transition | Break? | Reason |
|---|---|---|
| Research → Planning | Yes | Exploration context is bulky; the plan is the distilled output |
| Planning → Implementation | Yes | Plan is in files/the task.md task list; free context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; break if switching focus |
| After a failed approach | Yes | Dead-end reasoning pollutes the next attempt |
| Debugging → next feature | Yes | Debug traces are noise for unrelated work |
| **Mid-implementation** | **No** | Losing variable names, discovered paths, and partial state mid-task is costly |

**To break:** invoke `.agent/skills/context-management/SKILL.md` to write `state.md` with discovered facts, then start fresh with only `state.md` as input. Save *before* compacting, never after.

**What survives compaction** (re-injected automatically by the session-start hook):

| Survives | Lost |
|---|---|
| `CLAUDE.md` and `project-map.md` | Intermediate reasoning and analysis |
| Last 2 `[saved]` entries from `session-log.md` | File contents previously read into context |
| `known-issues.md` and `context-snapshot.json` | Tool call history |
| `state.md` (if written before compacting) | Multi-step conversation context |
| Git state, files on disk | Variable names, paths, facts not saved to `state.md` |

Because `project-map.md` and session-log entries survive automatically, `state.md` needs only task-specific working state, not the whole project picture.

## Context Rules

Invoke `.agent/skills/context-management/SKILL.md` when state must cross sessions: the user asks to save or compress, work continues in a new session, or accumulated decisions must survive a restart. Within a session Claude Code compresses automatically — do not invoke it merely because the session is long.

## Bash Output Compression (smart-compress)

When context-mode is active, noisy commands run through `ctx_batch_execute` / `ctx_execute` so only derived results enter context, and the bash-compress hook yields to that routing. This section applies when context-mode is **inactive**: the smart-compress hook then filters noisy Bash output before it enters your context, marking it `[compressed: 120->4 lines | git-status]`.

- **Tier 1 (near-lossless):** git add/commit/push/pull/clone/fetch, npm/pip/cargo install — reduced to one-line summaries.
- **Tier 2 (smart filtering):** git status (hint lines removed), git log (truncated), passing tests and successful builds (summary only), lint output (grouped by severity), large ls/find results (truncated).
- **NEVER compressed:** `git diff` (any variant, since every line matters for review), file reads (content was explicitly requested), commands with user-applied pipes (`| grep`, `| awk`, `| sed`), commands with `--verbose` or `--debug`, HTTP responses (API output should not be truncated), any command that fails (non-zero exit — error output passes through raw), and output shorter than 200 characters.
- **Adaptive re-run:** the same command run twice within 60 seconds passes through uncompressed the second time, for when the compressed output was insufficient.
- **Disable:** set `SP_NO_COMPRESS=1`, or create `.sp-no-compress` in the project root.

## Front-Loading

Before starting a multi-step task, identify every piece of missing information and request it all at once, rather than discovering gaps one at a time mid-task.

## Anti-Patterns

- Reading a file to confirm it exists
- Re-reading a file you already read and have not modified
- Re-running a search you already ran this session
- Re-exploring directory structure you already mapped
- Running the same check twice
- Generating reasoning that restates the user's message
- Splitting one turn's worth of work across multiple turns

## Activation

Active silently for the entire session. No confirmation output.
