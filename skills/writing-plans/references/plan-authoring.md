# Plan Authoring Notes

Detail moved out of `SKILL.md` to keep the core lean. Referenced from the "File Structure", "No Placeholders", and "Self-Review" pointers in `SKILL.md`.

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures at every `modelTier`** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- References to types, functions, or methods not defined in any task

**One item is tier-conditional.** "Steps that describe what to do without showing how" is a plan failure only at `mechanical`, where code blocks are required for code steps. At `standard`, `advanced`, and `frontier` describing without showing is the required form — see "Step Content by Tier" below.

## Step Content by Tier

A task's step content is bound to the `modelTier` in its `json:metadata`. Changing the tier after the plan is written requires rewriting that task's steps — escalation is up-only and stops at `advanced`, so a task is never dispatched below the tier its steps were written for.

**`mechanical` — complete, runnable code, unchanged from today:**

````markdown
- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

**`standard`, `advanced`, `frontier` — requirements, interfaces with exact signatures, and verification obligations; implementation excluded:**

````markdown
- [ ] **Step 1: Define the retry policy**

Requirements: retry a failed upstream call up to 3 times with exponential
backoff (base 200ms), give up and raise `UpstreamRetryExhausted` on the
4th failure, and never retry a 4xx response.

Interfaces:
- Produces: `retry_with_backoff(fn: Callable[[], Response], max_attempts: int = 3) -> Response`
- Raises: `UpstreamRetryExhausted(attempts: int, last_error: Exception)`

- [ ] **Step 2: Verify**

`pytest tests/path/test_retry.py -v` — covers exhaustion, a 4xx short-circuit,
and backoff timing within tolerance.

- [ ] **Step 3: Commit**

```bash
git add tests/path/test_retry.py src/path/retry.py
git commit -m "feat: add exponential-backoff retry for upstream calls"
```
````

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Frontier offers

**`"frontier"` is gated and costs 2x `advanced`.** Assign it only when the task shows a documented frontier edge — long-horizon autonomous execution, first-shot build of a fully-specified large system, genuine ambiguity where the model must choose the frame, whole-repo review/debugging including history, wide parallel sub-agent coordination, or dense/degraded visual input. **Inverse test:** if `advanced` has plausibly handled this class of task before, it is not frontier. **Never frontier:** security-focused analysis (the model's classifiers refuse it), zero-data-retention orgs, prefill, latency-sensitive work.

Before creating any frontier task you MUST get user approval, in one `AskUserQuestion` covering every qualifying task, with per-task rationale and per-task approval. Each offer states, in order: (1) the task, named; (2) why frontier is better here, citing the specific qualifying signal against this task's concrete properties — a generic "this is hard" is a contract violation; (3) the cost, plainly, as 2x; (4) the counter-case — what `advanced` would very likely handle adequately and precisely what is at risk if it falls short; (5) two options, `advanced` as the default. The approval option's **label** must contain `FRONTIER-APPROVED:task-<N>` verbatim; the question text and the declining option must NOT contain it, or the token leaks into the transcript without an approval. Put the same token in the task's `frontierConsent` field. Ask before `TaskCreate` so the handoff guard never sees it; a mid-run escalation uses the same contract and must carry the `CLARIFICATION` token.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Scope-reduction scan:** search the plan for "v1", "basic", "simple", "for now", "placeholder", "initial version", "minimal"; verify each was user-sanctioned.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.
