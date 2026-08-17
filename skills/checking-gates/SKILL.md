---
name: checking-gates
description: Use when picking up a user-gate task OR a hook demands re-validation. Runs the "do I know HOW?" self-check; if clear, executes the verification and posts evidence; if not, hands off to specifying-gates. Separate from executing-plans; dormant without the opt-in hook.
---

# Checking User-Thrown Gates

## Why this skill is separate from executing-plans

User-gate enforcement is an **opt-in flow**. When the opt-in hook is not registered, `superpowers:executing-plans` runs unchanged — no extra checks, no extra context, no extra questions. When the hook IS registered, it routes user-gate tasks through this skill. Keeping the decision logic in a separate skill means:

- Users who don't want the flow get zero friction.
- Users who do want it get a focused, scoped handler.
- `superpowers:executing-plans` stays short and readable.

## When to invoke

Any one of:

1. You are about to start a task whose `json:metadata` has `"userGate": true` or whose `tags` contains `"user-gate"` AND the opt-in hook is active (see the README for how to detect this — if you were invoked via `/gate-check`, the hook is active by definition).
2. A hook fired stderr telling you to run `/gate-check <task-id>`.
3. The user manually ran `/gate-check <task-id>`.

If none of these apply, return to `superpowers:executing-plans` without running this skill.


## The three-step process

### Step 1 — Load and classify

1. `TaskGet <task-id>` — read the full description.
2. Parse the `json:metadata` fence.
3. Classify:
   - `requiresUserSpecification: true` → go to Step 2 path A.
   - Concrete `verifyCommand` + every `acceptanceCriteria` names an observable (sensor, HTTP status, file, log line, entity) → go to Step 2 path B.
   - Vague criteria ("it works", "is fine", "as expected", "properly") or missing `verifyCommand` → go to Step 2 path A.

### Step 2 — Route

**Path A — HOW is ambiguous.** Invoke `superpowers:specifying-gates` (or tell the user to run `/specify-gate <task-id>`). Stop. Let that skill lock down the mechanics. When it returns, re-enter this skill from Step 1.

**Path B — HOW is clear.** Continue to Step 3.

### Step 3 — Execute and post evidence

1. Run the `verifyCommand` (or dispatch the subagent with `subagentBrief`). Capture exact output. Per the Adapter Link below, you MAY compute this via `ctx_execute` so the raw flood stays out of context, BUT you MUST then echo the per-criterion evidence into your assistant message (next step) — the gate hooks scan the TRANSCRIPT, not the sandbox.
2. Map each `acceptanceCriteria` entry to an observable in the output.
3. Post one block of text back to the user, using EXACTLY this format (the sibling hooks key off the `AC:` + `PROVEN BY` markers):

   ```
   Gate: <task subject>
   AC: <criterion 1> — PROVEN BY <command or excerpt of output>
   AC: <criterion 2> — PROVEN BY <...>
   ...
   ```

   Post this block as assistant text in the conversation — not only into a ctx sandbox. This is non-negotiable under context-mode.

4. If every criterion passed → `TaskUpdate status=completed`.
5. If any criterion failed → look up `failurePolicy`:
   - `"stop-plan"` → leave the task `in_progress`, surface the failure to the user, stop.
   - `"reopen-continue"` → leave the task `in_progress`, move to the next unblocked task.
   - `"log-continue"` → post the failure inline, mark completed anyway, continue.

## Do-I-know-HOW self-check — the short version

A criterion has a clear HOW when all three hold:

1. **Observable named** — sensor entity, HTTP endpoint, file path, log pattern, entity ID. Not "state", not "result".
2. **Capture method named** — the command, API call, subagent, or direct read that produces the observable.
3. **Pass/fail rule named** — an exact value, regex, or threshold. Not "reasonable" or "correct".

If any of the three is missing for any criterion, HOW is NOT clear → Path A.

**Err on the side of Path A.** Inventing a HOW silently is the exact failure this flow exists to prevent.

## What NOT to do

- Do NOT modify `superpowers:executing-plans`' behavior from inside this skill. This skill is a leaf — it returns control when done.
- Do NOT invoke `EnterPlanMode` or `ExitPlanMode`.
- Do NOT substitute a cheaper verification for the one specified. If you think the spec is wrong, reopen via `/specify-gate` — don't walk around it.
- Do NOT close the task if any criterion lacks concrete evidence. "Looks fine" is not evidence.

## Adapter Link

Tool selection is governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/conductor/routing.md` — declare the job (discovery / symbol-edit / docs / output / dispatch / memory) and follow its chain. Gate evidence per `${CLAUDE_PLUGIN_ROOT}/skills/shared/evidence.md`: `Gate:` and `AC: ... PROVEN BY ...` lines are scanned in the transcript, and evidence left in a sandbox triggers a false-positive block.

## Integration

- **Invoked from:** the PostToolUse / PreToolUse user-gate hook; or `/gate-check` slash command.
- **May hand off to:** `superpowers:specifying-gates` (Path A).
- **Returns to:** `superpowers:executing-plans` (or wherever it was invoked from) after TaskUpdate.
- **References:** `${CLAUDE_PLUGIN_ROOT}/skills/shared/task-format-reference.md` for metadata schema.
