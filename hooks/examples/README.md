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

A literal `<version>` in a registered command breaks silently the next time
the plugin auto-updates — version directories accumulate side by side
(`6.6.2`, `7.0.0`, `7.1.0`, ...) and a pinned path starts pointing at a stale
or missing copy. `scripts/resolve-plugin-script.sh` is the durable
registration form: given a hook script's path relative to the version
directory, it resolves the config root (`$CLAUDE_CONFIG_DIR`, falling back to
`$HOME/.claude`), picks the highest installed version under it via `sort -V`,
and `exec`s the hook script from there. Only the shim's own bootstrap
path — below — ever needs a literal `<version>`; the hook script it launches
is re-resolved on every run, so plugin auto-updates don't break it. Run
`ls "$CLAUDE_CONFIG_DIR/plugins/cache"` (or `ls "$HOME/.claude/plugins/cache"`
if `CLAUDE_CONFIG_DIR` is unset; on Windows,
`%USERPROFILE%\.claude\plugins\cache`) to find your `<marketplace>` and
current `<version>`:

**PreToolUse** — `pre-task-blockedby-enforce.sh`, matcher `TaskUpdate`:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "TaskUpdate",
  "hooks": [ { "type": "command",
    "command": "bash \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache/<marketplace>/superpowers/<version>/scripts/resolve-plugin-script.sh\" hooks/examples/pre-task-blockedby-enforce.sh" } ] } ] } }
```

**PostToolUse** — `post-task-complete-revalidate.sh`, matcher `TaskUpdate`:

```json
{ "hooks": { "PostToolUse": [ { "matcher": "TaskUpdate",
  "hooks": [ { "type": "command",
    "command": "bash \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache/<marketplace>/superpowers/<version>/scripts/resolve-plugin-script.sh\" hooks/examples/post-task-complete-revalidate.sh" } ] } ] } }
```

**Stop** — `stop-revalidate-user-gates.sh` (Stop hooks take no matcher):

```json
{ "hooks": { "Stop": [
  { "hooks": [ { "type": "command",
    "command": "bash \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache/<marketplace>/superpowers/<version>/scripts/resolve-plugin-script.sh\" hooks/examples/stop-revalidate-user-gates.sh" } ] } ] } }
```

The `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` expansion above requires the
command to run through a shell — true here since the command already starts
with `bash`. It still leaves a literal `<version>` in the shim's own
bootstrap path; that segment needs re-editing on a plugin major-version
bump or marketplace migration, but every hook script the shim launches after
that resolves fresh, with no further edits.

If you'd rather skip the shim, register the hook script directly the same
way, leading with `$CLAUDE_CONFIG_DIR` and falling back to `$HOME/.claude`:

```json
"command": "bash \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache/<marketplace>/superpowers/<version>/hooks/examples/pre-task-blockedby-enforce.sh\""
```

**Windows note (single quotes):** inline single-quoted Bash such as
`bash -c '...'` cannot be registered on Windows — Windows argv parsing does
not honor single quotes, so the command splits apart before Bash ever sees
it. Register a shim *file* by quoted path instead (as in the examples
above), never an inline single-quoted script body.

**Windows note (WSL bash):** if `bash` on `PATH` resolves to WSL's bash, it
cannot read Windows-style paths (`C:\...`) — it only sees its own Linux
filesystem view. Invoke Git Bash explicitly instead of relying on the bare
`bash` command:

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
