---
title: Four-tier model routing with a gated frontier tier
date: 2026-07-28
status: accepted
tags: [adr, routing]
---

# Four-tier model routing with a gated frontier tier

## Context

The routing config exposed three tiers whose top tier, `frontier`, mapped to the
session model. The model lineup has four capability levels, and the actual
frontier model costs exactly twice the tier below it. Naming the ungated ceiling
"frontier" both misnamed it and left no tier for the model that deserves the name.

## Decision

Four tiers: `mechanical`, `standard`, `advanced`, `frontier`. `advanced` is the
default ceiling and inherits the old `frontier` semantics. `frontier` is optional,
off by default, and reachable only through a per-task user approval corroborated
by a token in a harness-authored tool_result. Existing three-key configs are
normalized at load time and keep behaving identically.

## Consequences

- Existing configs are unaffected; the new tier is inert until opted into.
- A config that maps the legacy `frontier` to a Fable model is rejected as
  ambiguous rather than migrated, because guessing wrong spends 2x silently.
- The consent gate guards the careless path, not a deliberately adversarial
  agent: agent-controlled tool output can forge the transcript token. Hardening
  (matching against the selected option of a real AskUserQuestion result) is
  deferred and documented in docs/model-routing-flow.md.
- Two disqualifiers are doctrine-only: security analysis and reviewer role.
  Neither is reliably detectable in a hook.
