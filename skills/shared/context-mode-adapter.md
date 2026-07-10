# Context-Mode Adapter (single source of truth)

Route data work through ctx tools when the context-mode plugin is active; use native tools otherwise.
State-probes, mutations, file writes, and git operations stay NATIVE in both modes.

## Detection
Authoritative: the `mcp__plugin_context-mode_context-mode__ctx_*` tools are invocable this session.
Advisory only (may be true while tools are absent): `installed_plugins.json` contains
`context-mode@context-mode`; `~/.claude/context-mode/` exists.
**Failure path:** if a `ctx_*` call fails to resolve, run ToolSearch once for it; if still absent,
fall back to the native tool for the remainder of the session.

## Routing table (ctx active)
| Native intent | Use instead |
|---|---|
| WebFetch / `curl`·`wget` to stdout / inline HTTP in scripts | `ctx_fetch_and_index` → `ctx_search`, or `ctx_execute` (WebFetch is hard-denied by context-mode) |
| Bash whose expected output is unbounded or unpredictable (builds, test runs, full logs) | `ctx_execute` / `ctx_batch_execute` |
| Bash with short, fixed output (`git status` on clean tree, `--version`, `rev-parse`) | native Bash |
| Read to analyze/summarize/extract | `ctx_execute_file` |
| Read to Edit (exact bytes needed) | native Read |
| Grep to count/filter/aggregate | `ctx_execute` |
| Log/memory queries; resume recall | `ctx_search` (`sort:"timeline"` for cross-session) |
| SDD `task-brief` / `review-package` analysis | `ctx_execute_file` on the handoff file; only flagged hunks via native Read |

Worked examples — unbounded: `npm test`, `git log --stat`, `gradle build` → ctx.
Bounded: `git rev-parse HEAD`, `node -e "console.log(1)"`, `wc -l file` → native.

## Throttle rule
context-mode blocks after ~8 searches/60s. Batch every question set into ONE
`ctx_search(queries: [...])` call. Never loop single queries; never retry a throttled call in-turn.

## Pointer-swap rule
`ctx_execute` output >100KB (or >5KB when `intent` is set) returns indexed-section pointers,
not raw stdout. Either cap at the source (`… 2>&1 | tail -30`) or follow the pointer with one
targeted `ctx_search`. Regardless: echo the decisive pass/fail line natively (Evidence rule).

## Evidence rule (gate compatibility — non-negotiable)
Verification computed via ctx tools MUST surface `AC: <criterion> — PROVEN BY <evidence>`
lines in the conversation itself. Gate hooks scan the transcript, not the sandbox.

## File writes
`ctx_execute`/`ctx_execute_file` run in a discarded sandbox — file writes always use native
Write/Edit. This includes plans, specs, configs, and code.
