# CodeGraph Adapter (macro discovery)

Applies when the session `[conductor]` line lists `codegraph`.

## When present

For "how does X work", "what calls/uses Y", flow tracing ("how does X reach Y"),
area surveys, and blast-radius questions: call `codegraph_explore` FIRST — one call
returns the relevant symbols' verbatim source grouped by file, call paths, and a
blast-radius summary, including dynamic-dispatch hops grep cannot follow. Do not run
Grep/Read sweeps for questions it answers. Its output is pre-digested: never route it
through middleware-exec for summarization.

- writing-plans: annotate each plan task's Files/Interfaces with symbol paths and the
  blast-radius result for the symbols it touches.
- refactoring / systematic-debugging: establish the dependency picture with one
  `codegraph_explore` call before proposing moves or fixes.

The index auto-syncs on file changes — it is never stale; do not perform staleness
checks or manual re-syncs before calling `codegraph_explore`.

## Init offer (once per project)

Present but no `.codegraph/` and no `.superpowers-no-codegraph` marker: offer ONCE —
"CodeGraph is installed but this project isn't indexed. Run `codegraph init` (creates
./.codegraph/, builds the graph, auto-syncs afterwards)?" On decline, write the
`.superpowers-no-codegraph` marker and never re-offer. NEVER run `codegraph init`
uninvited.

## Absent / failed

Follow the routing.md chain: context-mode search, then native Grep/Read. A failed
`codegraph_explore` call demotes CodeGraph for the session — fall through silently.
