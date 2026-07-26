# Obsidian Adapter (memory / ADR persistence)

Applies to routing.md's "Memory / ADR persistence" row. Source: comparative OFM-vs-ours
review in `.superpowers/research/2026-07-24-fork-delta-audit.md` (`## OFM format review`,
local). Conventions below apply UNCONDITIONALLY — they are already the right shape for
GitHub rendering, grep, and `ctx_search` with zero Obsidian in the loop; vault tooling is
additive on top, never a requirement.

## Authoring conventions

- **ADR files:** `docs/adr/YYYY-MM-DD-<slug>.md`. One ADR = one note. Frontmatter (adopted
  from OFM — hybrid verdict, ADRs are the one file type shaped like a discrete note):
  ```yaml
  ---
  title: <short decision title>
  date: YYYY-MM-DD
  status: proposed | accepted | superseded
  tags: [adr, <area>]
  ---
  ```
- **Memory files** (`state.md`, `session-log.md`, `known-issues.md`, `project-map.md`): no
  frontmatter. They are single fixed-structure, append-only files, not discrete notes — adding
  per-file YAML would burn their hard line/word budgets for no query benefit (verdict: keep
  ours, per the OFM review).
- **Links:** standard relative Markdown links only, never `[[wikilinks]]`. Wikilinks resolve
  only inside a live vault; GitHub renders them as literal bracket text and grep/`ctx_search`
  see no path at all. Our existing relative links already work identically across GitHub,
  terminal, `ctx_search`, and an open vault.
- **Headings/anchors:** plain Markdown headings; cross-file references use GFM-slugified
  anchors (`#some-heading`), matching every existing `skills/**/SKILL.md` cross-reference.
  Do not switch to Obsidian's exact-heading-text anchor resolution — it would break every
  anchor link the moment the doc is read outside a vault.
- **Callouts:** for warnings or critical constraints in ADR/adapter prose (not `session-log.md`
  entries, which stay grep-parsed and fixed-format), use the 5-type blockquote form shared by
  GitHub alerts and Obsidian callouts — `note`, `tip`, `warning`, `important`, `caution` — e.g.
  `> [!warning]` — so the same line renders correctly with or without a vault. Do not use
  Obsidian's broader/custom callout vocabulary; it degrades to plain blockquote text on GitHub.
- **Tags:** frontmatter `tags:` list on ADRs only (e.g. `tags: [adr, conductor]`). Do not use
  inline `#hashtag` markers in prose bodies — the bracket-marker convention already in use
  (`[saved]`, `[superseded by YYYY-MM-DD]`) is the grep-anchored equivalent and stays as-is.
- **Embeds:** none in committed docs. `![[...]]` transclusion has no fallback outside a live
  vault (broken alt-text on GitHub, invisible to grep/`ctx_search`). Reference files by relative
  path in prose instead.

## Vault tooling (optional)

- **obsidian-cli:** gated on the `obsidian-cli` capability (binary on PATH) AND its `vault` flag
  (a `.obsidian` directory found above cwd — see `hooks/lib/capability-registry.js`). Per the
  reference dossier, the CLI drives a **running Obsidian instance** — it is not headless and not
  an MCP server; it does nothing if Obsidian isn't open. Only invoke when both signals are
  present, never uninvited, and demote silently on any call failure per routing.md.
- **`.base` ADR-index view:** strictly vault-detected and opt-in. When both capability signals
  above hold, may offer once to create `docs/adr/index.base` — a table view filtering
  `file.inFolder("docs/adr")`, ordered by `status`, `date`, `tags`. Declined or absent → skip
  silently, no filesystem-only substitute needed since ADRs are already plain browsable files.
- **`.canvas` diagrams:** same gating — optional visual architecture maps inside a detected
  vault only, never a required reading path for architecture docs (those stay in `docs/`).
- **defuddle:** only when the user explicitly wants a clean copy of a web page saved as a vault
  note. `ctx_fetch_and_index` remains the default fetch path per
  `skills/shared/conductor/context-mode-adapter.md` for all other web-content retrieval.
- **basic-memory MCP:** second choice, after obsidian-cli — when obsidian-cli is absent or a call
  fails (routing.md capability chain), it may serve vault search/read for ADR lookup — same
  optional, never-required footing. Absent or the call fails → fall through to plain filesystem,
  same as every other tool in this section.

## Absent

No `obsidian-cli` and no `basic-memory` MCP (routing.md chain) → plain filesystem, per the
Authoring conventions above — no behavior changes, since those conventions were never
conditional on tooling in the first place.
