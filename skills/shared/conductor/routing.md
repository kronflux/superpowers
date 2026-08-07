# Conductor Routing

Central tool-selection authority. Skills declare a job type and follow that row's chain
left→right: use the first capability whose status is not `absent`, per the session
`[conductor]` line (`probe()`'s live detection, authoritative for the session); `context-snapshot.json.capabilities`
mirrors it only when that file already exists in the project. On tool failure, demote it for
the session and continue down the chain. Presence is advisory — failure is graceful, never
an error surfaced to the user. Mechanics per tool live in the adapter files in this directory.

## Job Taxonomy

| Job | Chain (first available wins) | Adapter |
|---|---|---|
| Macro discovery / flow tracing / blast-radius | CodeGraph `codegraph_explore` → context-mode search → native Grep/Read | [codegraph.md](codegraph.md) |
| Symbol-precise edit (rename, replace body, references) | CodeGraph blast-radius → context-mode search → native Edit | [codegraph.md](codegraph.md) |
| Post-edit fast signal | LSP diagnostics, THEN the project's own gate — see below | [lsp.md](lsp.md) |
| External framework/API docs | Context7 → other docs MCP (e.g. docfork) → ctx_fetch_and_index / web | [context7.md](context7.md) |
| Output handling (logs, tests, terminal dumps) | context-mode (unchanged contract) | [context-mode-adapter.md](context-mode-adapter.md) |
| Mechanical subagent work (log digests, boilerplate) | middleware-exec → Claude mechanical tier → existing methodology | [middleware.md](middleware.md) |
| Memory / ADR persistence | filesystem, per the authoring contract | [doc-format.md](doc-format.md) |

**The post-edit row is the one exception to first-available-wins.** Every other row means "use
the first available and stop". This one does not: LSP diagnostics and the project's gate are
sequential and both apply. Reading a diagnostic never satisfies a gate. See [lsp.md](lsp.md).

## Verified vs configured

Hooks detect `configured` only. A capability becomes trustworthy (`verified`) after its
first successful tool call this session; any failure demotes it — fall through the chain
silently.

## Delegation announcements

Whenever work leaves the primary session — an Agent dispatch under a routed tier, or any
`middleware-exec` run — announce it in the response text, one line, before the results:

    [conductor] <task or job> -> <model or tier> (external|subagent)

Examples: `[conductor] task 3 implementer -> haiku (subagent)`,
`[conductor] extract-log-error -> openrouter/qwen-72b (external)`.
For external runs, the announcement after completion MUST carry the run's cost, taken from
the `[middleware] done` banner: `[conductor] summarize-test-failure -> openrouter/qwen-72b
(external) — 812/54 tokens, 2.1s` (http transports report exact prompt/completion tokens;
cli transports report `promptBytes/outputBytes bytes` instead — they carry no token counts).
One line per delegation; no announcement for work done in the primary context. Logs remain
the ground truth (`hooks-logs/routing-dispatch.log`, `hooks-logs/middleware-usage.jsonl`);
the announcement exists so the human can see delegation and its cost without opening tool
output.
