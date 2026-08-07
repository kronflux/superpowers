---
title: Replace Serena and Obsidian tooling with an LSP capability
date: 2026-08-06
status: accepted
tags: [adr, conductor]
---

## Context

Two conductor capabilities were announced every session and never called. Serena owned the
symbol-precise-edit row but every edit went through native Edit in practice, and its installed
plugin opened a dashboard per project. Obsidian's adapter was three-quarters authoring
conventions that applied unconditionally and one quarter tooling gated on a running Obsidian
GUI. Separately, the CodeGraph init offer never fired: its text lived only in an adapter no
skill opened, and the nudge hook required `indexed === true` — filtering out the unindexed
repos the offer existed for.

## Decision

Remove `serena`, `obsidian-cli`, and `basic-memory` from the capability probe. Rewrite the
symbol-edit row as CodeGraph blast-radius → context-mode search → native Edit. Rename
`obsidian.md` to `doc-format.md`, keeping every authoring convention and deleting the vault
tooling. Add an `lsp` capability with a new post-edit-fast-signal row and a per-language install
offer. Add a `codegraph-init` nudge class that fires on unindexed repos.

## Options considered

- **Delete the symbol-edit row outright.** Smallest diff, but loses the check-references-before-
  changing-a-signature discipline the row encoded.
- **Invest in a real Obsidian workflow.** Rejected: `obsidian-cli` drives a running GUI and is
  inert when Obsidian is closed.
- **Keep Serena, demoted.** Rejected: leaves dead-but-live code the next audit must re-reason
  about.

## Consequences

- LSP exposes no callable tools, so its row is not first-available-wins. Diagnostics are a
  non-authoritative fast signal that never replaces a named verification gate; `lsp.md` states
  this as a hard rule because the failure mode — reporting green off a signal that never looked
  — is worse than the redundant typecheck it replaces.
- `hooks/usage-aggregator.js` stops emitting `serena` and `obsidian` attribution keys but keeps
  tolerating them on read. `claude-usage.jsonl` is append-only and unrotated.
- Removing the references does not close the Serena dashboard. That requires
  `/plugin uninstall serena@claude-plugins-official`, a user action outside this repo.
