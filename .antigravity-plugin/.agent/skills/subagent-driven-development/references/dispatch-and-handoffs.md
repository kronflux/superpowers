# Dispatch Construction and File Handoffs

Reference for the `subagent-driven-development` skill. See [SKILL.md](../SKILL.md) for the execution flow.

## Constructing Reviewer Prompts

Per-task reviews are task-scoped gates; the broad review happens once, at the final whole-branch review.

- No open-ended directives ("check all uses", "run race tests if useful") without a concrete, task-specific reason.
- Do not ask a reviewer to re-run tests the implementer already ran on the same code — the implementer's report carries that evidence.
- **Never pre-judge findings.** If your prompt contains "do not flag", "don't treat X as a defect", "at most Minor", or "the plan chose" — stop: you are pre-judging, usually to spare yourself a review loop. Let the reviewer raise it and adjudicate in the loop.
- The global-constraints block is the reviewer's attention lens. Copy binding requirements verbatim from the plan's Global Constraints or the spec: exact values, exact formats, stated relationships ("same layout as X", "matches Y"). The template already carries the process rules (YAGNI, test hygiene, review method); this block is what THIS spec demands.
- Hand the reviewer its diff as a file: `scripts/review-package PLAN_FILE BASE HEAD` prints the path it wrote. Without bash, redirect `git log --oneline`, `git diff --stat`, and `git diff -U10` for the range into one uniquely named file. Use the BASE recorded before dispatching the implementer — never `HEAD~1`, which silently truncates multi-commit tasks.
- A dispatch describes one task, not the session's history. Never paste prior-task summaries: one real dispatch reached 42k chars, 99% of it pasted history. A fresh subagent needs its task, the interfaces it touches, and the global constraints.
- Dispatch fix subagents for Critical and Important findings. Record Minor findings in the progress ledger and point the final whole-branch review at that list to triage before merge. A roll-up nobody reads is a silent discard.
- A plan-mandated finding — or any finding conflicting with the plan's text — is the human's decision. Present the finding and the plan text and ask which governs. Do not dismiss it because the plan mandates it, and do not dispatch a contradicting fix without asking.
- The final whole-branch review gets a package too: `scripts/review-package PLAN_FILE MERGE_BASE HEAD`, where MERGE_BASE is the commit the branch started from (`git merge-base main HEAD`), so the final reviewer reads one file instead of re-deriving the branch diff.
- Every fix dispatch carries the implementer contract: re-run the tests covering the change and report results. Name the covering test files — a one-line fix does not need the whole suite. Before re-dispatching the reviewer, confirm the fix report contains the covering tests, the command run, and the output.
- Final-review findings go to ONE fix subagent with the complete list. Per-finding fixers each rebuild context and re-run suites; one session's final-review fix wave cost more than all its tasks combined.

## File Handoffs

Everything pasted into a dispatch, and everything a subagent prints back, stays resident in your context for the rest of the session and is re-read on every later turn. Hand artifacts over as files.

- **Task brief:** `scripts/task-brief PLAN_FILE N` extracts the task's full text to a uniquely named file and prints the path. The dispatch carries: (1) one line on where this task fits; (2) the brief path, introduced as "read this first — it is your requirements, with the exact values to use verbatim"; (3) interfaces and decisions from earlier tasks the brief cannot know; (4) your resolution of any ambiguity you noticed in the brief; (5) the report-file path and report contract. Exact values — numbers, magic strings, signatures, test cases — appear only in the brief.
- **Report file:** named after the brief (`…/task-N-brief.md` → `…/task-N-report.md`) and given in the dispatch prompt. The implementer writes the full report there and returns only status, commits, a one-line test summary, and concerns.
- **Reviewer inputs:** three paths — the brief, the report, and the review package — plus the global constraints binding the task.
- Fix dispatches append their fix report, with test results, to the same report file and return a short summary; re-reviews read the updated file.

## Dispatching with Metadata

Plans from `.agent/skills/writing-plans/SKILL.md` embed a `json:metadata` fence (files, acceptanceCriteria, verifyCommand) at the end of each task. The fence travels inside the brief that `scripts/task-brief` extracts — never paste the task text or bulk metadata into the dispatch prompt. Parse the fence to fill the implementer template's Acceptance Criteria, Files, and Verify Command: one checkbox per criterion, the `files` list, and the exact `verifyCommand`. The brief remains the single source of requirements; the mirrored fields are a checklist, not a second authority.
