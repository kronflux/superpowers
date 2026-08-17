# User-Gate Detection, Tagging, and Enforcement

Detail moved out of `SKILL.md` to keep the core lean. The full metadata schema for all gate keys lives in `${CLAUDE_PLUGIN_ROOT}/skills/shared/task-format-reference.md` → "User-Thrown Gates". Referenced from the "User-Thrown Gates" and "Gate enforcement note" pointers in `SKILL.md`.

## User-Thrown Gates — Mechanical Detection + Tagging

You MUST run this check for EVERY task you create. It takes seconds and is the cheapest part of the whole user-gate flow.

**Step 1 — Scan for gate-language.** For each of these, search the user's brief AND the task's Goal/Acceptance Criteria, case-insensitive, whole-word where reasonable:

| Bucket | Keywords / patterns |
|--------|---------------------|
| Verbs | `verify`, `prove`, `validate`, `confirm`, `ensure`, `check`, `gate` |
| Nouns | `verification gate`, `acceptance test`, `smoke test`, `end-to-end`, `E2E` |
| Scope | `first on one`, `then all`, `one before the rest`, `before proceeding`, `don't continue until` |
| Proof | `prove it works`, `make sure`, `demonstrate`, `show that` |

**Trigger rule** — a task is a user-thrown gate ONLY if:
- a **Nouns** match is found (these phrases are unambiguous gate nouns), OR
- a **Scope** match is found (commitment to ordering is a gate by itself), OR
- a **Verbs** match co-occurs with EITHER a Scope or a Proof match.

A **Verbs** match ALONE is not enough. Normal work briefs routinely say "validate the output" or "check that imports work" without asking for a gate. If the user wanted a gate, they committed to ordering ("do X before Y", "first on one"), named the artifact ("smoke test", "acceptance test"), or demanded proof ("prove it works", "show that"). One of those MUST be present in addition to the verb.

If no bucket matches, or only Verbs match → regular task, no tagging needed.

**Step 2 — Tag the task.** In the task's `json:metadata` fence:

1. Set `"userGate": true`.
2. Append `"user-gate"` to the `tags` array (create the array if absent).
3. If the user's brief specified the HOW concretely (named a command, entity, subagent, or observable), put it straight into `verifyCommand` and `acceptanceCriteria` — done.
4. If HOW is vague, set `"requiresUserSpecification": true` **only** when the verification sentence names no testable noun (function, command, entity, endpoint, file, log pattern) AND no concrete value (expected result, threshold, example input/output). One foothold — e.g. "verify each op with real inputs" — is enough for the agent to self-solve. The flag is for pure adjectives ("solid", "works", "good", "proper") where any guess is a shot in the dark.

**Step 3 — Add the prose banner** (mandatory whenever `userGate: true`). Near the top of the task description, right under **Goal:**, include verbatim:

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Tasks with declared evidence axes — set `requireEvidenceTokens`.** When a task's close is meaningful only if the coordinator has actually observed two (or more) labeled states, declare the axes in metadata. The `post-task-complete-revalidate` hook refuses the close unless at least one token from each axis appears in the close window. Examples:

- **Empirical refactor / A/B:** either explicit (`"requireEvidenceTokens": [["baseline","old","iter-0"], ["refactored","new","iter-1"]]`) or shortcut (`"requireABCompare": true`).
- **v2→v3 migration verification:** `"requireEvidenceTokens": [["v2","legacy"], ["v3","migrated"]]`.
- **Perf before/after:** `[["slow","unoptimized","p50=X"], ["fast","optimized","p50=Y"]]` — include the literal metric tags you expect the coordinator to post.
- **Multi-arm experiment:** `[["control"], ["variant-a"], ["variant-b"]]` — any number of axes.
- **Security pre/post fix:** `[["vulnerable","CVE-","before-patch"], ["patched","after-patch","hardened"]]`.

Without the axes, "looks good, keep going" closes are legal; with axes, the coordinator must produce evidence from each declared side. Pair with a concrete `verifyCommand` that actually runs both sides when possible (e.g. `diff <(old-cmd) <(new-cmd)`).

**Banner ↔ metadata invariant — both paths must agree.** The banner goes inside the SAME the task.md task list `description` string as the `json:metadata` fence, not only in the plan `.md`. If you are writing both a plan document AND creating native tasks, the banner must appear in BOTH places for the same task, OR in NEITHER. Self-check before moving on: for each task, the plan doc section and the the task.md task list description must both either have `userGate: true` + banner + fence, or have none of them.

**Step 4 — Check acceptance criteria operational specificity.** Each criterion MUST name an observable. Vague ("integration works", "it passes") is not acceptable — rewrite to "sensor X reports idle", "HTTP 200 from `/health`", "setup.done file present", etc. If you cannot make a criterion operational, set `requiresUserSpecification: true` and let `/specify-gate` collect the real answer.

**Step 5 — Per-task isolation self-check.** For every task where you set `userGate: true` and DIDN'T set `requiresUserSpecification: true`, re-read ONLY that task's **Goal** sentence in isolation — pretend no other task exists. Does that sentence alone name an observable, a capture method, AND a pass/fail value? If no to any of the three, set `requiresUserSpecification: true` even if you already filled in a `verifyCommand` from context. Borrowing concreteness from sibling tasks is the failure mode this catches. Example: a plan with per-op tasks saying "verify add(3,2)==5" (concrete) and a final task saying "make sure the whole thing works" (vague) — the per-op tasks anchor; the final task fails this check and MUST carry `requiresUserSpecification: true`.

**Tag liberally when a real gate signal is present.** The three shades of gate (strict user gate / strict agent gate / gray in-between) all get the same tag — if the trigger rule above matches, err on the side of tagging. But do not read a gate into normal verbs: "validate", "check", "verify" on their own describe routine work, not user-thrown gates. Over-tagging on real signals is harmless (extra metadata). Over-tagging on bare verbs produces the banner flood that makes every task look high-ceremony and drowns the real gates.

**Do NOT ask the user questions during write-plan.** The opinionated default is "tag it and move on". Users who wanted questions said "brainstorm". If the user's brief is vague about a gate's HOW, the flag `requiresUserSpecification: true` routes the question to execute time where `/specify-gate` handles it in 3-5 short multiple-choice prompts.

See `${CLAUDE_PLUGIN_ROOT}/skills/shared/task-format-reference.md` → "User-Thrown Gates" for the full metadata schema with all six gate-related keys (`userGate`, `tags`, `requiresUserSpecification`, `gateScope`, `failurePolicy`, `subagentBrief`), and `docs/user-gate-flow.md` for the end-to-end flow.

## Gate enforcement note (only when user-gate tasks were tagged AND hooks not yet registered)

If the plan contains any task with `userGate: true`, check whether the user already opted in (scans the three user-editable settings files Claude Code merges — project `settings.local.json` + `settings.json`, and user `~/.claude/settings.json`; missing files silently skipped). This is a file-state probe, so it stays native per the context-mode-adapter "state-probes stay native" rule:

```bash
for f in .claude/settings.local.json .claude/settings.json ~/.claude/settings.json; do
  [ -f "$f" ] && grep -q "post-task-complete-revalidate.sh" "$f" && echo FOUND && break
done
```

If the loop prints `FOUND` (the canonical user-gate hook is registered in any of those files) → **suppress the heads-up entirely**. They already enabled it.

Otherwise, show this short heads-up before the Execution Handoff (substitute {N} and the task numbers):

> Heads up — I tagged {N} task(s) as user-gate (Tasks #X, #Y, …). The plan runs end-to-end as-is. If you'd like automatic close-time enforcement, the JSON snippets are in `README.md` — paste them into `.claude/settings.json` (or `settings.local.json`). Happy to walk you through it; just say the word.

Internal reference (do NOT show): README sections `#force-re-validation-on-user-thrown-gate-close` + `#re-validate-gates-on-plan-complete-claims` in `~/.claude/plugins/marketplaces/superpowers-marketplace/README.md`. Hooks: `hooks/examples/{post-task-complete-revalidate,stop-revalidate-user-gates}.sh`. Design doc: `docs/user-gate-flow.md`.

Suppress entirely if no user-gate tasks were tagged. Do NOT turn this into an `ask_question`.
