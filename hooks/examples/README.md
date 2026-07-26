# Task-gate hook examples

These 7 hooks enforce task-verification discipline: blockedBy dependency
ordering, subagent dispatch matching a task's declared metadata, evidence
tokens on subagent returns, and evidence re-validation when a user-thrown
gate task is closed or a plan is declared complete.

**All 7 are opt-in.** None of them are registered in `hooks/hooks.json` —
only the plugin's standard hooks auto-register on install. To enable one of
these, add it explicitly to your project's `.claude/settings.json`.

## Hooks

| Hook | Event / Matcher | Blocks what | Disable env |
|------|------------------|-------------|-------------|
| `pre-task-blockedby-enforce.sh` | `PreToolUse` / `TaskUpdate` | Marking a task `in_progress` while any task in its `blockedBy` list is not yet `completed` | `SUPERPOWERS_BLOCKEDBY_GUARD` |
| `pre-agent-task-dispatch-validate.sh` | `PreToolUse` / `Agent` | Dispatching a subagent whose `subagent_type` / `model` / prompt doesn't match the in-progress task's `metadata.subagentType` / `.model` / `.dispatchBrief` | `SUPERPOWERS_DISPATCH_GUARD` |
| `pre-commit-check-tasks.sh` | `PreToolUse` / `Bash` (`git commit`) | Running `git commit` while any native task has status `in_progress` | none — this script has no escape hatch |
| `post-agent-return-validate.sh` | `PostToolUse` / `Agent` | A subagent's return content missing required evidence tokens when the in-progress task carries `metadata.requireEvidenceTokens` or `requireABCompare: true` | `SUPERPOWERS_AGENT_RETURN_GUARD` |
| `post-task-complete-revalidate.sh` | `PostToolUse` / `TaskUpdate` (`status=completed`) | Closing a user-thrown gate task (`metadata.userGate: true` or `tags` contains `"user-gate"`) without restating evidence for its acceptance criteria. Also fires on non-gate closes: any task carrying `requireEvidenceTokens`/`requireABCompare` metadata gets its evidence axes enforced, and non-gate tasks are re-validated silently (no user-facing message) | `SUPERPOWERS_USERGATE_GUARD` |
| `stop-deflection-guard.sh` | `Stop` | Stopping on a low-context deflection phrase (e.g. "next session", "context is full") while measured context usage is below threshold | `SUPERPOWERS_DEFLECTION_GUARD` |
| `stop-revalidate-user-gates.sh` | `Stop` | Claiming a plan/all gates complete when a closed user-gate task has no per-criterion evidence (`AC:` / `PROVEN BY`) in a later message | `SUPERPOWERS_USERGATE_STOP_GUARD` |

All disable envs default to active (`1`); set the listed variable to `0` to
turn the hook off at runtime without unregistering it. `pre-commit-check-tasks.sh`
ships no env-based escape hatch — remove its `hooks.json` entry to disable it.

## Registering a hook

Add an entry under the matching event in your project's `.claude/settings.json`.
Replace `<marketplace>` and `<version>` with your actual plugin install path
— run `ls "$HOME/.claude/plugins/cache"` (or `%USERPROFILE%\.claude\plugins\cache`
on Windows) to find them.

**PreToolUse** — `pre-task-blockedby-enforce.sh`, matcher `TaskUpdate`:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "TaskUpdate",
  "hooks": [ { "type": "command",
    "command": "bash \"$HOME/.claude/plugins/cache/<marketplace>/superpowers/<version>/hooks/examples/pre-task-blockedby-enforce.sh\"" } ] } ] } }
```

**PostToolUse** — `post-task-complete-revalidate.sh`, matcher `TaskUpdate`:

```json
{ "hooks": { "PostToolUse": [ { "matcher": "TaskUpdate",
  "hooks": [ { "type": "command",
    "command": "bash \"$HOME/.claude/plugins/cache/<marketplace>/superpowers/<version>/hooks/examples/post-task-complete-revalidate.sh\"" } ] } ] } }
```

**Stop** — `stop-revalidate-user-gates.sh` (Stop hooks take no matcher):

```json
{ "hooks": { "Stop": [
  { "hooks": [ { "type": "command",
    "command": "bash \"$HOME/.claude/plugins/cache/<marketplace>/superpowers/<version>/hooks/examples/stop-revalidate-user-gates.sh\"" } ] } ] } }
```

**Windows note:** if `bash` is not on `PATH` when hooks run, invoke Git Bash
explicitly instead of relying on the bare `bash` command:

```json
"command": "\"C:\\Program Files\\Git\\bin\\bash.exe\" \"<script>\""
```

## Fail-open, evidence contract

Every hook here fails open: transcript-read errors, missing `jq`, malformed
JSON, or any other internal fault causes the hook to allow the action rather
than block it. Errors never cascade into blocking a session.

The evidence tokens these hooks look for (`AC: <criterion> — PROVEN BY
<evidence>`) are the same contract documented in
`skills/shared/conductor/context-mode-adapter.md`'s Evidence rule and in
`docs/user-gate-flow.md` (the flow doc lands in a later resync commit; until then, pre-resync-main:docs/user-gate-flow.md is the reference).
