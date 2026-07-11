# Subagent Model Routing — Opt-In Flow

Plan execution fans out: one task dispatches an implementer plus reviewers, review loops re-dispatch, and every dispatch inherits the session model by default. On a frontier-priced session, the most expensive model multiplies across tasks that are, by the plan's own design, mechanical. Model routing classifies work upfront and routes each dispatch to the cheapest model that can handle it.

## The opt-in switch

One file controls everything: `docs/superpowers/model-routing.json` in the project, with `~/.claude/superpowers/model-routing.json` as a user-level fallback (first file found wins entirely; no merging). File present → routing active. File absent → every routing component is fully dormant and behavior is byte-identical to vanilla. `/onboard` generates the file (lands in a later commit); deleting it switches everything off instantly.

Config schema — map each tier to a model string:

```json
{"mechanical": "haiku", "standard": "sonnet", "frontier": "inherit"}
```

`"inherit"` means: no constraint for that tier; dispatches inherit the session model.

## Tier semantics

Plan tasks carry `"modelTier"` in their `json:metadata` fence (see `skills/shared/task-format-reference.md`). Abstract tiers, not model names — lineups change, plans survive:

- `"mechanical"` — touches 1-2 files, complete spec with code in the steps, no design judgment.
- `"standard"` — multi-file coordination, integration concerns, pattern matching, debugging.
- `"frontier"` — design judgment, architecture decisions, broad codebase understanding.

**Tie-break: spec completeness wins.** A task whose steps contain the complete code is `mechanical` regardless of file count. Upgrade to `standard` only when the implementer must exercise judgment the steps do not capture. Assign tiers after the Steps are written. A concrete `"model"` pin in the fence overrides the tier.

**Escalation goes up only, transparently.** An implementer BLOCKED for reasoning depth is re-dispatched one tier higher (`mechanical → standard → frontier`) by updating the task's metadata via TaskUpdate — visible, never a silent workaround, and never silently down.

**Reviewers always run at `standard`.** Spec and code-quality reviewers dispatch while the task is in progress, so the dispatch gate validates against the union of every in-progress task's resolved tier plus `resolve("standard")`. The final whole-plan reviewer runs after all tasks complete — no in-progress task, no constraint.

## The four enforcement layers

Skill prose is not enforcement; the flow is delivered by harness-executed layers:

1. **Session notice** (`hooks/session-start`): when the routing file exists, a `<model-routing-active>` block with the project's mapping and the tier rules is injected into session context at startup.
2. **Plan gate** (`hooks/pre-taskcreate-model-tier.js`, PreToolUse on TaskCreate): a plan-shaped task (template headers or numbered subject) missing a valid `modelTier` is denied; the message embeds the tier table and tie-break rule.
3. **Dispatch gate** (`hooks/pre-agent-model-routing.js`, PreToolUse on Agent): while tiered tasks are in progress, an Agent dispatch must use a model from the allowed set. Tasks are keyed by native id from the TaskCreate result, never by creation order. Dispatches whose `subagent_type` is anything other than absent, empty, or `general-purpose` are exempt: custom subagent types carry their own model constraints via task-metadata dispatch validation, and the routing gate governs only general-purpose implementer/reviewer dispatches.
4. **Handoff guard** (`hooks/pre-askuser-handoff-guard.js`, PreToolUse on AskUserQuestion): after writing-plans creates tasks, only the mandated two-option Execution Handoff (or a question carrying the token `CLARIFICATION`) passes — improvised menus bypass the subagent pipeline where routing operates.

## Kill switch and fail-open guarantees

`SUPERPOWERS_ROUTING_GUARD=0` disables all layers at runtime. Every layer is dormant without the routing file and fails open on any internal error: unparseable config, malformed metadata fences, unknown tier values, missing or unreadable transcripts, malformed transcript lines. Typos must not brick a session. The only non-allow outcome is the explicit, self-teaching deny.
