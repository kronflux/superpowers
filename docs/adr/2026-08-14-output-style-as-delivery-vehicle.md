---
title: Deliver response shape as an output style, not a shared contract
date: 2026-08-14
status: accepted
tags: [adr, output-contract, context-economy]
---

## Context

`skills/shared/output-contract.md` states how work is reported to a human, but it only
reaches the model when a skill reads it. Across 49,895 subagent turns the string
`output-contract` appears once. The same rules were therefore restated in the operator's
`CLAUDE.md`, in this repo's `CLAUDE.md`, and in a hand-written output style — three copies
of one ruleset, each drifting independently.

A Claude Code output style is loaded into the system prompt, applies on every turn without
any skill being invoked, survives compaction at no cost, and is restated by the harness as
the conversation runs. Anthropic's own `explanatory-output-style` plugin distributes a
style as a SessionStart injection instead, and ships a token-cost warning in its README.

## Decision

Ship `output-styles/signal.md` as a plugin asset and add a `superpowers:output-style`
skill that writes it to `<configDir()>/output-styles/` and sets `outputStyle` in a settings
file whose scope the user picks, defaulting to user-global. The skill never injects at
SessionStart.

`output-contract.md` shrinks to the delta. Voice, answer shape, language rules, formatting,
forbidden language, overrides and the pre-send check move to the style and are deleted from
the contract. What remains is what the style cannot reach: the precedence statement, the
exhaustive-result rule, the structured-returns carve-out, the relative-scope convention,
the no-skill-preamble rule, and the requirement that dispatch briefs inline shape rules.

Style sections in this repo's `CLAUDE.md` are removed and replaced with a pointer, so
installing the style collapses three copies rather than adding a fourth.

## Options considered

- **Render the contract into a style on install, keeping both complete.** Rejected: two
  complete documents is the duplication this decision exists to remove.
- **Delete the contract entirely once the style ships.** Rejected: a subagent's system
  prompt is its agent definition, so the style never reaches one — measured at 0 of 49,895
  turns — and the six non-Claude-Code overlays this fork ships have no output-style
  mechanism at all.
- **Ship four presets (Signal, ASD-STE100, ADHD-summary, ELI5).** Rejected: four documents
  to keep consistent with one contract, only one of them load-bearing. Variants are an
  interview branch that writes a custom style instead.

## Consequences

- The shipped style needs four amendments before it is safe. Its five-item list cap would
  truncate review findings and test failures, which are exhaustive results rather than
  advisory lists. Its clarifying-question rule and its single-recommendation rule contradict
  the five interview-shaped skills (`brainstorming`, `deliberation`, `specifying-gates`,
  `statusline`, `onboard`). It has no structured-returns carve-out, so a turn producing
  machine-consumed JSON would be pushed toward prose.
- Neither vehicle reaches subagents today. `subagent-driven-development` and
  `dispatching-parallel-agents` must inline shape rules into the briefs they construct;
  editing either document cannot fix this.
- Installing a style requires writing a user settings file, so `patchSettings` must return
  the path it wrote and must report an existing `outputStyle` before replacing it.
- The style bans em dashes, which existing repository prose uses heavily. New prose is
  constrained; existing prose is not rewritten, so the two coexist.
