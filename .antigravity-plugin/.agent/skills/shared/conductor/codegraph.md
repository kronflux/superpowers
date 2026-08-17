# CodeGraph Adapter (macro discovery)

Applies when the session `[conductor]` line lists `codegraph`.

## When present

Pick the tool by question shape. Each returns only what its question needs; the narrow tools
answer in a few hundred bytes where `codegraph_explore` returns tens of kilobytes.

| Question | Tool |
|---|---|
| What breaks if I change X | `codegraph_impact` — transitive, and it resolves symbols reached only by reference (`.map(fn)`), which grep cannot follow |
| What calls X / what does X call | `codegraph_callers`, `codegraph_callees` |
| X is known by name; I need its source and trail | `codegraph_node` — one symbol's source with caller/callee trail, or a file read back with line numbers and its dependents |
| I don't know the name yet | `codegraph_search` to locate, then `codegraph_node` on the result |
| Everything above returned nothing | `codegraph_explore` |

`codegraph_explore` is the fallback, not the opener. It answers a whole area in one call and
returns verbatim source, which is why its own tool description recommends it first — but its
retrieval is unreliable on concept-shaped questions, and the cost is paid whether the answer is
right or wrong. Reach for it when a located symbol is not enough to understand the area, or when
`codegraph_search` finds nothing.

Do not run Grep/Read sweeps for questions these tools answer. Their output is pre-digested:
never route it through middleware-exec for summarization.

- writing-plans: annotate each plan task's Files/Interfaces with symbol paths, and the
  `codegraph_impact` result for the symbols it touches.
- refactoring / systematic-debugging: establish the dependency picture with `codegraph_impact`
  before proposing moves or fixes.

The index auto-syncs on file changes — it is never stale; do not perform staleness
checks or manual re-syncs before calling.

## Init offer (once per project)

Present but no `.codegraph/` and no `.superpowers-no-codegraph` marker: offer ONCE —
"CodeGraph is installed but this project isn't indexed. Run `codegraph init` (creates
./.codegraph/, builds the graph, auto-syncs afterwards)?" On decline, write the
`.superpowers-no-codegraph` marker and never re-offer. NEVER run `codegraph init`
uninvited.

## Index present, MCP tools unavailable

`.codegraph/` present but no `codegraph_*` tools exposed: the CLI prints the same output —
`codegraph impact <symbol>`, `codegraph callers <symbol>`, `codegraph node <name>`,
`codegraph query "<search>"` (the CLI name for `codegraph_search`), `codegraph explore "<query>"`.
This path takes precedence over Grep/Read sweeps; an unavailable MCP surface does not mean an
unavailable index.

## Scope

A repository's `codegraph.json` decides what is indexed. Where it admits generated or minified
files, they carry enough symbols to dominate `codegraph_explore` ranking while leaving
`codegraph_search` unaffected — another reason to locate by name first. Reading that file is
how to explain a result that does not match the repository's own source.

## Absent / failed

No `.codegraph/`, or no CodeGraph at all: follow the routing.md chain — context-mode search,
then native Grep/Read. A failed call demotes CodeGraph for the session — fall through silently.
