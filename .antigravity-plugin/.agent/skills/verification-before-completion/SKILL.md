---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

## Overview

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

If context-mode is active, run verification commands via `ctx_execute` per the output-handling job in `skills/shared/conductor/routing.md`, and ECHO the fresh output (exit code, failure count) in-transcript — the completion claim's evidence must be visible in the conversation, not only in a ctx sandbox (§8 gate-evidence rule).

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**
```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## Stub Scan (Implementation Tasks)

When verifying completion of any task that created or modified production code, run a stub scan before claiming done:

```bash
grep -rn "TODO\|FIXME\|placeholder\|NotImplementedError\|raise NotImplementedError" <src-dir> \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.go" --include="*.rs" \
  | grep -v -i "test\|spec\|__tests__"
```

Adjust `<src-dir>` and `--include` patterns to the project's language and source structure. If any match falls in a file this task created or modified: the task is not done. Remove the stub or confirm with your human partner it is intentional before claiming completion.

When context-mode is active, run this stub scan as a discovery job per `skills/shared/conductor/routing.md` (Grep-for-filter → `ctx_execute`); surface any matching file:line in-transcript.

## Configuration Change Verification

When a change affects provider selection, feature flags, environment variables, or credentials:

Do not claim success based on operation success alone. Verify the **outcome reflects the intended change**.

| Change | Insufficient | Required |
|--------|-------------|----------|
| Switch API/LLM provider | Status 200 | Response contains expected provider or model name |
| Enable feature flag | No errors | Feature behavior is actually active |
| Change environment | Deploy succeeds | Logs or env vars reference the new environment |
| Set credentials | Auth succeeds | Authenticated identity or context is correct |

**Gate:**
1. Identify: what should be *different* after this change?
2. Locate: where is that difference observable? (response field, log line, runtime behavior)
3. Run: a command that shows the observable difference.
4. Verify: output contains the expected difference — not just that the operation completed.

## Self-Consistency Verification (optional)

When the verification reasoning is non-trivial (multi-step inference, ambiguous evidence, configuration changes) AND the `.agent/skills/self-consistency-reasoner/SKILL.md` skill is installed, apply multi-path reasoning before declaring the verdict: generate 3 independent reasoning paths (what the evidence proves / what it does not prove / alternative explanations), take the majority verdict, and if there is no majority do not claim completion — state what additional evidence is needed. If the skill is not installed, apply the standard Gate Function.

## When To Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction
- ANY positive statement about work state
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success
- ANY communication suggesting completion/correctness
