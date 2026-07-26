# Conductor Routing

Central tool-selection authority. Skills declare a job type and follow that row's chain
left→right: use the first capability whose status is not `absent` (see the session
`[conductor]` line / `context-snapshot.json.capabilities`); on tool failure, demote it for
the session and continue down the chain. Presence is advisory — failure is graceful, never
an error surfaced to the user. Mechanics per tool live in the adapter files in this directory.

## Job Taxonomy

| Job | Chain (first available wins) | Adapter |
|---|---|---|
| Macro discovery / flow tracing / blast-radius | CodeGraph `codegraph_explore` → context-mode search → native Grep/Read | [codegraph.md](codegraph.md) |
| Symbol-precise edit (rename, replace body, references) | Serena symbol tools → native Edit | [serena.md](serena.md) |
| External framework/API docs | Context7 → other docs MCP (e.g. docfork) → ctx_fetch_and_index / web | [context7.md](context7.md) |
| Output handling (logs, tests, terminal dumps) | context-mode (unchanged contract) | [context-mode-adapter.md](context-mode-adapter.md) |
| Mechanical subagent work (log digests, boilerplate) | middleware-exec → Claude mechanical tier → existing methodology | [middleware.md](middleware.md) |
| Memory / ADR persistence | Obsidian-valid markdown always; obsidian-cli / Basic Memory MCP when present → filesystem | [obsidian.md](obsidian.md) |

## Memory — STRICT PROHIBITION

Serena's memory tools (`write_memory`, `read_memory`, `list_memories`, `delete_memory`,
`rename_memory`, `edit_memory` — and any variant) MUST NEVER be used. The four-layer
memory + ADR layer is the sole memory system. A second store is split-brain memory.

## Verified vs configured

Hooks detect `configured` only. A capability becomes trustworthy (`verified`) after its
first successful tool call this session; any failure demotes it — fall through the chain
silently.
