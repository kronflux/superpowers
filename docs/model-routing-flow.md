# Subagent Model Routing — Opt-In Flow

Plan execution fans out: one task dispatches an implementer plus reviewers, review loops re-dispatch, and every dispatch inherits the session model by default. On a top-priced session, the most expensive model multiplies across tasks that are, by the plan's own design, mechanical. Model routing classifies work upfront and routes each dispatch to the cheapest model that can handle it.

## The opt-in switch

One file controls everything: `docs/superpowers/model-routing.json` in the project, with `~/.claude/superpowers/model-routing.json` as a user-level fallback (first file found wins entirely; no merging). File present → routing active. File absent → every routing component is fully dormant and behavior is byte-identical to vanilla. `/onboard` generates the file (lands in a later commit); deleting it switches everything off instantly.

Config schema — map each tier to a model string:

```json
{"schema": 2, "mechanical": "haiku", "standard": "sonnet", "advanced": "opus", "frontier": "off"}
```

`"inherit"` means: no constraint for that tier; dispatches inherit the session model. `"off"` (valid only for `frontier`) means the tier is unreachable. `frontier` is optional; omitting it means `"off"`.

**Legacy configs keep working.** A three-key config (`mechanical`/`standard`/`frontier`, no `schema`, no `advanced`) is normalized at load: its `frontier` becomes `advanced` and the new `frontier` is `"off"` — behavior is byte-identical to before the fourth tier existed. One exception: a legacy config mapping `frontier` to a Fable model is rejected as ambiguous (routing goes dormant, reason logged in `hooks-logs/routing-config.log`) rather than silently promoted to an ungated 2x ceiling. An enabled `frontier` must also name a different model than `advanced`, or the config is rejected.

## Tier semantics

Plan tasks carry `"modelTier"` in their `json:metadata` fence (see `skills/shared/task-format-reference.md`). Abstract tiers, not model names — lineups change, plans survive:

- `"mechanical"` — touches 1-2 files, complete spec with code in the steps, no design judgment. Caveat: this tier's typical model carries a smaller context window; a mechanical task requiring a wide file read is mis-tiered and escalates to `standard`.
- `"standard"` — multi-file coordination, integration concerns, pattern matching, debugging.
- `"advanced"` — design judgment, architecture decisions, broad codebase understanding. **The default ceiling.**
- `"frontier"` — gated, 2x the cost of `advanced`, requires per-task user approval. Qualifies only on a documented frontier edge: long-horizon autonomous execution (hours unattended, no checkpoint); first-shot build of a fully-specified large system; genuine ambiguity where the model must choose the frame; whole-repo review/debugging including history; wide parallel sub-agent coordination; dense or degraded visual input. **Inverse test:** if `advanced` has plausibly handled this class of task before, it is not frontier — difficulty alone never qualifies. **Never frontier:** security-focused analysis (the model's classifiers refuse it, and its bug-finding gains explicitly exclude security work — the `red-team` agent and every security review are permanently non-frontier), zero-data-retention orgs (every request 400s), work needing assistant prefill or disabled thinking, latency-sensitive turns.

**Tie-break: spec completeness wins.** A task whose steps contain the complete code is `mechanical` regardless of file count. Upgrade to `standard` only when the implementer must exercise judgment the steps do not capture. Assign tiers after the Steps are written. A concrete `"model"` pin in the fence overrides the tier.

**Escalation goes up only, transparently, and stops at `advanced`.** An implementer BLOCKED for reasoning depth is re-dispatched one tier higher (`mechanical → standard → advanced`) by updating the task's metadata via TaskUpdate — visible, never a silent workaround, never silently down. `frontier` is reachable only through the approval flow in `skills/writing-plans`, never through escalation.

**Reviewers always run at `standard`.** Spec and code-quality reviewers dispatch while the task is in progress, so the dispatch gate validates against the union of every in-progress task's resolved tier plus `resolve("standard")`. The final whole-plan reviewer runs after all tasks complete — no in-progress task, no constraint.

**Frontier consent.** A dispatch on the frontier model requires two independent signals: `"frontierConsent": "FRONTIER-APPROVED:task-<N>"` in the constraining task's fence, AND the same token in a harness-authored tool_result (the user actually selecting the approval option in an AskUserQuestion). The fence alone is agent-writable and proves nothing by itself; the transcript token is what ties the gate to a real user action. The check runs before the `inherit` stand-down — standing down relaxes tier matching, never consent. The frontier model is never admitted to the general allowed set; only the consent path admits it.

**Consent semantics and honest limits.** Consent is per task, not per dispatch: while an approved frontier task is in progress, its dispatches (including re-dispatches after review) need no fresh approval. The gate is a guardrail against the careless path — no correctly-behaving agent ever emits the token without running the offer. It is NOT tamper-proof against a deliberately adversarial agent: any tool output the agent controls (e.g. a Bash `echo`) lands in a tool_result and can forge the transcript signal, and a token approved for one task, copied into another frontier task's fence, would authorize that task too. A future hardening must match the token against the text of the *selected option* of a real AskUserQuestion result specifically (result provenance alone is insufficient — the harness echoes question text into results); it is deliberately deferred until then. Do not describe this gate anywhere as agent-tamper-proof.

## The five enforcement layers

Skill prose is not enforcement; the flow is delivered by harness-executed layers:

1. **Session notice** (`hooks/session-start`): when the routing file exists, a `<model-routing-active>` block with the project's mapping and the tier rules is injected into session context at startup.
2. **Plan gate** (`hooks/pre-taskcreate-model-tier.js`, PreToolUse on TaskCreate): a plan-shaped task (template headers or numbered subject) missing a valid `modelTier` is denied; the message embeds the tier table and tie-break rule.
3. **Dispatch gate** (`hooks/pre-agent-model-routing.js`, PreToolUse on Agent): while tiered tasks are in progress, an Agent dispatch must use a model from the allowed set. Tasks are keyed by native id from the TaskCreate result, never by creation order. Dispatches whose `subagent_type` is anything other than absent, empty, or `general-purpose` are exempt: custom subagent types carry their own model constraints via task-metadata dispatch validation, and the routing gate governs only general-purpose implementer/reviewer dispatches. **Accepted residual gap.** An implementer dispatch and a reviewer dispatch for the same task are both `general-purpose` carrying the same `model`, so once consent is recorded for a task the hook cannot tell them apart. "Reviewers run at `standard`" is therefore prose-enforced in `subagent-driven-development`, not hook-enforced.
4. **Consent gate** (inside `hooks/pre-agent-model-routing.js`): a dispatch whose `model` equals the configured frontier model is denied unless an in-progress frontier task carries a `frontierConsent` token corroborated by the transcript. Runs before the `inherit` stand-down. The deny message embeds the five-element offer contract.
5. **Handoff guard** (`hooks/pre-askuser-handoff-guard.js`, PreToolUse on AskUserQuestion): after writing-plans creates tasks, only the mandated two-option Execution Handoff (or a question carrying the token `CLARIFICATION`) passes — improvised menus bypass the subagent pipeline where routing operates.

## Kill switch and fail-open guarantees

`SUPERPOWERS_ROUTING_GUARD=0` disables all layers at runtime. Every layer is dormant without the routing file and fails open on any internal error: unparseable config, malformed metadata fences, unknown tier values, missing or unreadable transcripts, malformed transcript lines. Typos must not brick a session. The only non-allow outcome is the explicit, self-teaching deny.
