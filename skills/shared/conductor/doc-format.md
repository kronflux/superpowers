# Documentation Format (memory / ADR persistence)

Applies to routing.md's "Memory / ADR persistence" row. Source: comparative OFM-vs-ours
review in `.superpowers/research/2026-07-24-fork-delta-audit.md` (`## OFM format review`,
local). These conventions apply UNCONDITIONALLY and depend on no tooling — they are the right
shape for GitHub rendering, grep, and `ctx_search` with zero Obsidian in the loop. A vault user
gets correctly-shaped notes for free; superpowers claims no vault integration.

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

## Persistence

Plain filesystem, per the Authoring conventions above. There is no tool chain for this row and
no capability gate — the conventions were never conditional on tooling in the first place.
