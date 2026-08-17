---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
---

# Requesting Code Review

Dispatch a code reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation — never your session's history.

**Core principle:** Review early, review often.

## Adapter Link

Tool selection is governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/conductor/routing.md` — declare the job (discovery / symbol-edit / docs / output / dispatch / memory) and follow its chain. The review scope is derived from `git diff`, which stays native. Evidence handling per `${CLAUDE_PLUGIN_ROOT}/skills/shared/evidence.md`.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Get git SHAs:**
```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**1b. Scope the review (existence-gated):** Check for `context-snapshot.json` at the project root:
- If present: run `git rev-parse HEAD` and compare to `git_hash` in the file.
  - **Hashes match (fresh):** use `changed_files` and `blast_radius` as the review scope. Inject this summary into the code-reviewer prompt: *"Changed files: [list]. Also referenced by: [blast_radius callers]."*
  - **Hashes differ (stale):** note the snapshot is from a previous commit; use `changed_files` as a starting point but do not rely on `blast_radius`.
- If absent: determine scope from `git diff --name-only BASE_SHA..HEAD_SHA` directly.

**2. Dispatch code reviewer subagent** per Agent Dispatch & Fallback below, filling the template at [code-reviewer.md](code-reviewer.md) when using the `general-purpose` fallback.

**Placeholders:**
- `{DESCRIPTION}` - Brief summary of what you built
- `{PLAN_OR_REQUIREMENTS}` - What it should do
- `{BASE_SHA}` - Starting commit
- `{HEAD_SHA}` - Ending commit

**3. Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)

## Agent Dispatch & Fallback

Dispatch review subagents via the Task tool. **Never set the subagent type to Bash** — under context-mode it is upgraded to `general-purpose`, so it is never the right choice here.

**Resolution order:**

1. **Named agents present** — if both `.agent/skills/code-reviewer/SKILL.md` and `.agent/skills/red-team/SKILL.md` are registered, dispatch them **in parallel** (two Task calls in one turn):
   - `.agent/skills/code-reviewer/SKILL.md` for spec/correctness/OWASP/CWE review.
   - `.agent/skills/red-team/SKILL.md` for adversarial breakage analysis (logic, state, concurrency, production-context).
   Pass each the scoped file list, SHA range, description, and requirement reference.
2. **Named agents absent** — fall back to a single `general-purpose` subagent, filling the inline template at [code-reviewer.md](code-reviewer.md) with `{DESCRIPTION}`, `{PLAN_OR_REQUIREMENTS}`, `{BASE_SHA}`, `{HEAD_SHA}`. The red-team pass is skipped in fallback mode unless the change touches state machines, concurrency, or critical data paths — in which case add a second `general-purpose` dispatch carrying the red-team brief inline.

**Detecting presence:** the named agents are resolvable when `agents/code-reviewer.md` and `agents/red-team.md` ship with this plugin and the harness registers them. If a dispatch to a named agent returns an "unknown agent" / unresolved error, treat it as absent and re-dispatch via the `general-purpose` fallback.

**Evidence:** per `${CLAUDE_PLUGIN_ROOT}/skills/shared/evidence.md`. Each review surfaces its `AC: ... PROVEN BY ...` lines and merge-readiness verdict as text in this conversation.

## Security Review (Built-In)

When changes touch security-relevant areas, the code review **must** include a security pass. This is not a separate step — it's part of every review where applicable.

**Triggers automatically when changes touch:**
- Authentication or authorization flows
- Input validation or output encoding
- API endpoints handling user data
- Secrets management or credential handling
- Cryptography, key management, or token generation
- Infrastructure, deployment, or CI/CD configs

**Security checklist:** the canonical checklist lives in `agents/code-reviewer.md` (Review dimensions → Security checklist) — the code-reviewer agent runs it as part of every review.

**Severity enforcement:**
- Critical/High security findings **block merge** until addressed or the user explicitly accepts the risk with documented rationale.
- Medium security findings should be fixed before merge unless explicitly deferred.

## Adversarial Red Team (Optional)

For changes involving complex logic, concurrency, state management, or critical data paths, dispatch `.agent/skills/red-team/SKILL.md` in parallel with the code reviewer.

**Triggers when changes touch:**
- State machines or multi-step workflows
- Concurrent access to shared resources
- Complex business logic with branching conditions
- Data transformation pipelines
- Retry/recovery/rollback logic
- Performance-critical paths handling large inputs

The red team agent finds concrete failure scenarios (specific inputs, race conditions, state corruption, resource exhaustion) that checklist-based review misses. It does NOT duplicate the security review — its focus is adversarial logic analysis, not OWASP/CWE compliance.

**Red team critical findings block merge** alongside security critical findings.

Severity mapping: red-team High→Important, Medium→Minor; merge-blocking = any Critical from either agent.

## Auto-Fix Pipeline

When the red team report contains Critical or High findings, run the auto-fix pipeline. The pipeline is **ASI-guided and iterative** — fix one finding at a time, starting from the red team's designated ASI, then re-assess before proceeding. This prevents fixes from conflicting with each other when findings touch shared code.

**Iteration loop:**

1. **Identify the entry point.** Start with the finding marked **ASI** in the red team summary. If no ASI is marked, start with the highest-severity finding.
2. **Write the failing test.** Flesh out the test skeleton from the red team report into a real test and run it. It MUST fail — this proves the scenario is real. If the test passes, the finding was a false positive; skip it and note it in the triage, then re-identify the next ASI.
3. **Fix the code.** Make the minimum change to pass the test. Do not refactor or improve surrounding code.
4. **Run a targeted re-check.** Re-read only the files touched by the fix and check whether: (a) the fix introduced any new issues, and (b) any previously reported findings are now resolved as a side effect.
5. **Re-assess the remaining findings.** Update your list — remove resolved findings, re-prioritize if the fix changed the risk landscape. Identify the new ASI.
6. **Repeat** from step 2 until no Critical or High findings remain.

**After the loop completes:**
- Run the full test suite one final time to confirm no regressions across all fixes.
- Report: findings fixed, false positives skipped, any regressions introduced and resolved.

**Skip conditions:**
- If the red team report has zero Critical/High findings, skip the pipeline entirely.
- Medium findings are tracked for later, not auto-fixed.
- If the user explicitly says to skip auto-fix, respect that.

## Example

```
[Just completed Task 2: Add verification function]

You: Let me request code review before proceeding.

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code reviewer subagent]
  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types
  PLAN_OR_REQUIREMENTS: Task 2 from .superpowers/plans/deployment-plan.md
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing progress indicators
    Minor: Magic number (100) for reporting interval
  Assessment: Ready to proceed

You: [Fix progress indicators]
[Continue to Task 3]
```

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just review the diff myself instead of dispatching a reviewer" | You're the coordinator — reviewing the diff inline burns the context window you need to keep driving the work. Dispatch a reviewer subagent: the diff and the evaluation live in its context, and only the findings come back to you. |
| "The reviewer needs my whole session history to understand the change" | Hand it precisely crafted context, never your session's history. That keeps the reviewer on the work product, not your thought process. |

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

## Output Requirement

Review must include severity, file references, security findings (if applicable), and merge readiness verdict.

See template at: [code-reviewer.md](code-reviewer.md)
