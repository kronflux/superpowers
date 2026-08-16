---
title: Tier the SessionStart payload by event source
date: 2026-08-14
status: accepted
tags: [adr, context-economy, hooks]
---

## Context

The SessionStart hook emits the body of `skills/using-superpowers/SKILL.md` on
`startup`, `clear` and `compact` alike, reading nothing from stdin to distinguish them. In
one measured session — 1,360 MB across 347,256 records — 403 compaction boundaries
produced 602 payload emissions, roughly 1.4M tokens spent re-injecting a document that
never changed, at the point where context is scarcest.

The harness independently injects the complete skill listing into the system prompt, so the
payload's skill names and descriptions are duplication. Its situation-to-skill mapping and
tier rules are not.

## Decision

Parse `.source` from the hook input. `startup` and `clear` emit the full body; `compact`
emits a delimited compact core of ≤1,200 B carrying the override-order line, the complexity
tiers, the routing table and the skill-files rule. Any parse failure emits the full body.

Delete the Red Flags table and the `<EXTREMELY-IMPORTANT>` block, replacing both with one
line: `Override order: user instruction > project context file > skill > default.` Strip
`<SUBAGENT-STOP>` from the emitted text while keeping it in the file.

Deduplicate emissions with a `spTmp()` marker keyed on session id plus source; a `clear`
emission deletes the marker before writing its own.

## Options considered

- **Emit a one-line pointer on `compact` and `clear`.** Maximum saving, and what the defect
  report proposed. Rejected: it strands a summarized session with no routing at all, and
  the 0.027% Skill-invocation figure it rests on measures how often skills are *invoked*,
  not how often the table is read.
- **Deduplicate only, keep the full injection.** Lowest risk, roughly half the saving,
  leaves the per-compaction cost untouched.
- **Treat `clear` as a continuation, like `compact`.** Rejected during the failure-mode
  check: `/clear` wipes the conversation and the user begins new work, so a cleared session
  would lose the fresh-project gate and the memory reads.

## Consequences

- `hooks/using-superpowers/SKILL.md` acquires delimiter comments that are load-bearing. A
  moved or malformed delimiter silently changes what every session receives, so the payload
  test asserts the core is non-empty, contains the routing table header and the
  override-order line, and is strictly smaller than the full body.
- `references/routing-guide.md` cited the deleted Red Flags table and is rewritten to cite
  the override-order line instead.
- The compact core is a second budgeted artifact. Editing `SKILL.md` now requires
  re-running the payload spec against two ceilings, not one.
- Context-mode's own always-on injection appears 2,163 times in the same corpus where this
  payload appears 602 times. This decision does not touch it; it belongs to
  `mksglu/context-mode`.
