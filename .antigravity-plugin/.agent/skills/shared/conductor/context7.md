# Context7 Adapter (live-docs provider chain)

Applies when the session `[conductor]` line lists `context7` or `docfork`.

## When to fetch live docs

Reach for live docs during design, planning, and dependency work when the API is
version-sensitive: external framework/package interfaces that shift between releases (renamed
parameters, new hooks, deprecated flags, breaking changes since training data). Skip live
lookups for language stdlib and well-known stable APIs — behavior there doesn't drift, and a
round trip adds latency without adding information. Touchpoints: brainstorming (evaluating a
library option), writing-plans (annotating a task with the exact current API surface),
dependency-management (checking a changed API's current signature).

## Provider chain

1. **Context7** — resolve-then-query, two calls. Skip the resolve step only if the user
   already supplied a `/org/project[/version]` ID:
   - `resolve-library-id` with `query` (what's being looked up, used for ranking) and
     `libraryName` (the official library name) → returns a Context7-compatible library ID.
   - `query-docs` with `libraryId` (the exact ID from the resolve step, e.g.
     `/vercel/next.js` or `/vercel/next.js/v14.3.0-canary.87`) and `query` (single-concept
     lookup string).
2. **Any other configured docs MCP** — `docfork` is the known example; the pattern is
   generic. Follow the same shape (resolve/identify the library, then query its docs) using
   whatever tool names that MCP exposes.
3. **`ctx_fetch_and_index`** when context-mode is active (fetch the doc page, index it, then
   `ctx_search` the relevant section); **native web fetch** when context-mode is inactive.

Fall through the chain on failure per `routing.md`: demote the failed tool for the session,
try the next link, never surface the failure to the user.

## Absent

No docs MCP configured and context-mode inactive: fall back to native web fetch. If that is
also unavailable (offline), state the uncertainty explicitly rather than guessing at current
API shape.

## Out of scope

Private/internal package docs (no public registry entry) — none of these providers resolve
them. Use whatever internal documentation the project already keeps instead.
