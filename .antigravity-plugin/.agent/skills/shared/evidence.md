# Evidence Contract

What makes a claim about system state admissible. `verification-before-completion` owns the gate at a completion claim; this owns the standard every claim is held to, including the ones no skill is watching.

## The standard

- **Evidence before claims, always.** No "should", "probably", "seems to". A claim that work passes, builds, or is fixed requires the command output that shows it.
- **Reading code proves what it says; running it proves what it does.** A claim about behavior needs the second.
- **Verify against the surface that actually runs.** A test exercising a helper directly does not prove the entry point works. Where a hook, CLI, or handler is the real caller, drive it end to end — the unit test and the integration path can disagree, and only one of them is what ships.
- **Report outcomes faithfully.** Failing tests are reported with their output; skipped steps are named as skipped; partial verification is named as partial.

## Evidence must land in the transcript

A subagent's return is compressed and sandbox output never enters the conversation, so anything computed elsewhere survives only as a summary unless you echo it.

- Output computed via `ctx_execute` / `ctx_execute_file` or `middleware-exec` MUST be echoed into your assistant message. The raw flood staying out of context is the point; the derived evidence staying out of context is the failure.
- Gate lines — `Gate:` and `AC: <criterion> — PROVEN BY <evidence>` — are scanned in the TRANSCRIPT, not the sandbox. Evidence trapped in a sandbox triggers a false-positive block.
- Agent success reports are not evidence. A subagent reporting DONE has given you a claim, not a verification; the command output behind it is what counts.

## Applies to

Every skill that verifies, reviews, gates, or reports completion: `verification-before-completion`, `checking-gates`, `executing-plans`, `subagent-driven-development`, `requesting-code-review`, `receiving-code-review`, `finishing-a-development-branch`, `systematic-debugging`, `test-driven-development`.
