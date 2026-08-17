# Controller Operations

Reference for the `subagent-driven-development` skill. See [SKILL.md](../SKILL.md) for the execution flow.

## Pre-Flight Plan Review

Before dispatching Task 1, scan the plan once for conflicts: tasks that contradict each other
or the plan's Global Constraints, or anything the plan explicitly mandates that the review
rubric treats as a defect (an assertion-free test, verbatim duplication of a logic block).

Present every finding as one batched question to your human partner — finding beside the plan
text that mandates it, asking which governs — before execution begins, not one interrupt per
discovery mid-plan. If clean, proceed without comment. The review loop remains the net for
conflicts that only emerge from implementation.

## Model Selection

Use the least powerful model that can handle each role to conserve cost and increase speed.

**Mechanical implementation tasks** (isolated functions, clear specs, 1-2 files): use a fast, cheap model. Most implementation tasks are mechanical when the plan is well-specified.

**Integration and judgment tasks** (multi-file coordination, pattern matching, debugging): use a standard model.

**Architecture and design tasks**: use the most capable available model.
The final whole-branch review is one of these — dispatch it on the most
capable available model, not the session default.

**Review tasks**: choose the model with the same judgment, scaled to the
diff's size, complexity, and risk. A small mechanical diff does not need the
most capable model; a subtle concurrency change does.

**Always specify the model explicitly when dispatching a subagent.** An
omitted model inherits your session's model — often the most capable and
most expensive — which silently defeats this section.

**Turn count beats token price.** Wall-clock and context cost scale with how
many turns a subagent takes, and the cheapest models routinely take 2-3× the
turns on multi-step work — costing more overall. Use a mid-tier model as the
floor for reviewers and for implementers working from prose descriptions.
When the task's plan text contains the complete code to write, the
implementation is transcription plus testing: use the cheapest tier for
that implementer. Single-file mechanical fixes also take the cheapest tier.

**Task complexity signals (implementation tasks):**
- Touches 1-2 files with a complete spec → cheap model
- Touches multiple files with integration concerns → standard model
- Requires design judgment or broad codebase understanding → most capable model

## Handling Implementer Status

Implementer subagents report one of four statuses. Handle each appropriately:

**DONE:** Generate the review package (`scripts/review-package PLAN_FILE BASE HEAD`, from this skill's directory — it prints the unique file path it wrote; BASE is the commit you recorded before dispatching the implementer — never `HEAD~1`, which silently drops all but the last commit of a multi-commit task), then dispatch the task reviewer with the printed path.

**DONE_WITH_CONCERNS:** The implementer completed the work but flagged doubts. Read the concerns before proceeding. If the concerns are about correctness or scope, address them before review. If they're observations (e.g., "this file is getting large"), note them and proceed to review.

**NEEDS_CONTEXT:** The implementer needs information that wasn't provided. Provide the missing context and re-dispatch.

**BLOCKED:** The implementer cannot complete the task. Assess the blocker:
1. If it's a context problem, provide more context and re-dispatch with the same model
2. If the task requires more reasoning, re-dispatch with a more capable model
3. If the task is too large, break it into smaller pieces
4. If the plan itself is wrong, escalate to the human

**Never** ignore an escalation or force the same model to retry without changes. If the implementer said it's stuck, something needs to change.

## E2E Process Hygiene

When dispatching subagents that start background services (servers, databases, queues):

Subagents are stateless — they do not know about processes started by previous subagents. Accumulated background processes cause port conflicts, stale responses, and false test results.

Include in the subagent prompt for any E2E or service-dependent task:

**Unix/macOS:**
```
Before starting any service:
1. Kill existing instances: pkill -f "<service-pattern>" 2>/dev/null || true
2. Verify the port is free: lsof -i :<port> && echo "ERROR: port still in use" || echo "Port free"

After tests complete:
1. Kill the service you started.
2. Verify cleanup: pgrep -f "<service-pattern>" && echo "WARNING: still running" || echo "Cleanup verified"
```

**Windows:**
```
Before starting any service:
1. Kill existing instances: taskkill /F /IM "<process-name>" 2>nul || echo "No existing process"
2. Verify the port is free: netstat -ano | findstr :<port> && echo "ERROR: port still in use" || echo "Port free"

After tests complete:
1. Kill the service you started.
2. Verify cleanup: tasklist | findstr "<process-name>" && echo "WARNING: still running" || echo "Cleanup verified"
```

Exception: persistent dev servers the user explicitly keeps running — document them in `state.md`.

## Durable Progress

Conversation memory does not survive compaction. In real sessions,
controllers that lost their place have re-dispatched entire completed task
sequences — the single most expensive failure observed. Track progress in
a ledger file, not only in todos.

- At skill start, check for a ledger in the plan's own workspace:
  `cat "$(skills/subagent-driven-development/scripts/sdd-workspace PLAN_FILE)/progress.md"`.
  The path is resolved, never literal: two plans running from one repo would
  otherwise share a ledger, which is how six releases ended up inventing
  filename prefixes (`v750-`, `v760-`, ... ) to keep their progress apart.
  Tasks listed there as complete are DONE — do not re-dispatch them; resume
  at the first task not marked complete.
- When a task's review comes back clean, append one line to the ledger in
  the same message as your other bookkeeping:
  `Task N: complete (commits <base7>..<head7>, review clean)`.
- The ledger is your recovery map: the commits it names exist in git even
  when your context no longer remembers creating them. After compaction,
  trust the ledger and `git log` over your own recollection.
- `git clean -fdx` will destroy the ledger (it's git-ignored scratch); if
  that happens, recover from `git log`.

**Carried-constraints list.** Maintain a running list, in the same ledger file, of constraints
established by completed tasks that later tasks must not violate — a naming decision, a schema
shape, an interface signature, an invariant a task's Acceptance Criteria locked in. Append to it
when a task's review confirms the constraint, alongside the ledger's completion line. Re-emit
the current list, verbatim, into every dispatched brief from that point on — a task brief that
does not carry it is the mechanism by which a later task silently violates something an earlier
task established, which is a task-ordering defect, not a review-catchable one: the reviewer sees
only the task it was dispatched for and has no way to know a constraint exists upstream.

## Task Persistence Sync

`<plan-path>.tasks.json` is the plan's durable task record; the native task list is the
harness's live view of it. Both describe the same real work, and both are kept true to it —
never maintained to make a tool look recently used.

### Restoring the task list at entry

Run this before dispatching Task 1, and again on any resume or post-compaction re-entry,
following the procedure [executing-plans Step 0](../../executing-plans/SKILL.md#step-0-load-persisted-tasks)
already defines:

1. Call `TaskList`.
2. Locate `<plan-path>.tasks.json`, or glob for the matching `.tasks.json` when the exact
   name is absent.
3. For each task in that file the native list does not hold, call `TaskCreate` with the full
   `description` (including the `json:metadata` fence), then restore `blockedBy` through
   `TaskUpdate`.

Recreate only what the native list does not already hold — a resumed or post-compaction entry
that already carries the plan's tasks creates no duplicate. With no `.tasks.json` for the plan,
the rebuild creates nothing: a task the plan does not record has no source, and inventing one
is not tracking. Outside a plan under execution this step does not run at all, and creates no
task.

Multi-step work that lives only in a plan file is visible to nothing but the controller holding
it. The restored list is what makes it legible to the operator and to any session that resumes
the plan.

### Syncing after each status change

After marking each task completed via `TaskUpdate`, update the `.tasks.json` file to stay in sync:

1. Read `<plan-path>.tasks.json`
2. Set the task's `"status"` to `"completed"`
3. Set `"lastUpdated"` to current ISO timestamp
4. Write the file back

This ensures cross-session resume works correctly. Without this, a new session loading `.tasks.json` would see completed tasks as `"pending"`.
