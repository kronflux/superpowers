---
description: "Guided setup for this fork's opt-in features: subagent model routing, user-gate enforcement hooks, commit strategy, marketplace auto-update. Asks short questions, writes chosen config immediately. Everything is optional; nothing activates without an explicit yes."
---

# Superpowers Onboarding

Walk the user through this fork's optional features one at a time. For each feature: ask, then immediately write the chosen configuration — no deferred "now apply this yourself" summary.

## Ground rules

- **Assume a clean slate.** Do NOT audit existing configuration beyond what each step needs to do its own job (Feature 2's dedupe check and Feature 4's already-enabled check are the only state reads this command performs — both are required by the step itself, not general auditing). Go straight to the questions.
- **Discrepancy handling:** if a file you are about to write already exists with content that differs from what you are about to write, stop, show the diff (existing vs. proposed), and let the user decide free-form (keep / overwrite / adjust) before writing. This applies to `docs/superpowers/model-routing.json`, `docs/superpowers/workflow.json`, and any settings file being merged.
- Each feature is optional. Every question includes a way to decline; declining writes nothing and moves to the next feature.
- **NEVER commit anything.** Files are written to the working tree only; committing is the user's call.
- After the last feature, produce the Closing summary (see below) — what was written and where, what was skipped, and how to undo each.

All config-file paths below are relative to the current project root. Hook registrations target the project's `.claude/settings.json` specifically (not a user-level alternative).

## Feature 1: Subagent Model Routing

One-line intro for the user before asking: plan execution dispatches an implementer plus reviewers per task, and by default they all inherit the session model — on a frontier-priced session that multiplies the most expensive model across tasks that are, by design, often mechanical. Full semantics: `docs/model-routing-flow.md`.

```yaml
AskUserQuestion:
  question: "Enable model routing for plan-execution subagents?"
  header: "Routing"
  options:
    - label: "Guided tiers (recommended)"
      description: "mechanical->haiku, standard->sonnet, frontier->session model. Cheap models for routine implementation, mid-tier for integration and reviews, full power only where judgment lives."
    - label: "One fixed model"
      description: "Every subagent uses one model you pick next - flat cost cap, no per-task gradation."
    - label: "Skip"
      description: "Keep the default: every subagent inherits the session model. Nothing is written."
```

- **Guided tiers** → show the user the exact mapping you are about to write and offer to change any tier before writing:

  ```json
  {"mechanical": "haiku", "standard": "sonnet", "frontier": "inherit"}
  ```

  If the user wants a different value for any tier, substitute it before writing. Write the result to `docs/superpowers/model-routing.json` (create `docs/superpowers/` if missing — that is intentional).

- **One fixed model** → ask the follow-up below first, then write the same three-tier structure with every tier set to the chosen value:

  ```yaml
  AskUserQuestion:
    question: "Which model should every subagent use?"
    header: "Model"
    options:
      - label: "haiku"
        description: "Cheapest and fastest. Fine when plans are well-specified."
      - label: "sonnet"
        description: "Mid-tier reasoning at mid-tier price. The balanced cap."
      - label: "opus"
        description: "Frontier reasoning. Caps cost only on sessions running an even higher-tier model."
      - label: "fable"
        description: "Highest capability and price. Only useful as a cap if your session model is above it."
  ```

- **Skip** → write nothing.

After writing the file, tell the user: the routing gates (`hooks/pre-taskcreate-model-tier.js`, `hooks/pre-agent-model-routing.js`) check for this file on every relevant tool call and activate immediately — no restart needed. From the next session on, `hooks/session-start` injects a `<model-routing-active>` notice with the tier mapping and rules. Kill switch at runtime: `SUPERPOWERS_ROUTING_GUARD=0`. Off-switch: delete `docs/superpowers/model-routing.json` — routing goes fully dormant, byte-identical to never having opted in.

## Feature 2: User-Gate Enforcement Hooks

One-line intro: when the user asks for a verification gate ("make sure X works before proceeding"), these opt-in hooks force re-validation with captured evidence when such a task closes or the plan is declared complete — without them, gate tags (`userGate: true`, `tags: ["user-gate"]`) stay inert metadata. Full flow: `docs/user-gate-flow.md`; hook contract and registration snippet shapes: `hooks/examples/README.md`.

```yaml
AskUserQuestion:
  question: "Enable enforcement hooks for user-thrown verification gates?"
  header: "Gates"
  options:
    - label: "Yes, both hooks (recommended)"
      description: "Per-task close enforcement (post-task-complete-revalidate.sh) + end-of-plan stop enforcement (stop-revalidate-user-gates.sh). They compose."
    - label: "Per-task hook only"
      description: "Only re-validate when an individual gate task is closed (post-task-complete-revalidate.sh)."
    - label: "Skip"
      description: "Gate tagging stays inert metadata. Nothing is written."
```

On any non-skip answer:

1. **Resolve the real script paths before writing anything.** If `CLAUDE_PLUGIN_ROOT` is set in this session's environment, the scripts live under `${CLAUDE_PLUGIN_ROOT}/hooks/examples/`. Otherwise look under `~/.claude/plugins/cache/superpowers-dev/superpowers/<version>/hooks/examples/` (Windows: `%USERPROFILE%\.claude\plugins\cache\superpowers-dev\superpowers\<version>\hooks\examples\`) — list the parent directory to find the installed `<version>`. Verify `post-task-complete-revalidate.sh` (and, if selected, `stop-revalidate-user-gates.sh`) actually exist at the resolved path. If no location resolves, tell the user the install path could not be found and stop this feature without writing anything.

2. **Dedupe check spans every settings scope.** Before adding an entry for a given script, check whether a hook `command` referencing that script's filename is already registered in ANY of: the project's `.claude/settings.json`, the project's `.claude/settings.local.json`, or the user's `~/.claude/settings.json`. If it is already registered anywhere, do not add it again — report which file already covers it and move on to the next hook (or to the `EnterPlanMode` step if both hooks are already covered).

3. **Merge into the project's `.claude/settings.json`, never overwrite.** Read the file first (resolve a symlink to the real target). Diff-and-confirm per Ground rules if it already exists. Append each new hook entry into the matching array (`hooks.PostToolUse` for the per-task hook, matcher `TaskUpdate`; `hooks.Stop` for the stop hook, no matcher), creating only the missing keys, and write the full merged result back. If an object with the same matcher already exists in that array, push the new command into its `hooks` sub-array instead of creating a sibling matcher object. If the file does not exist, create it containing only the hooks structure being added. Registration shapes (substitute the resolved path from step 1 for `<resolved-path>`):

   ```json
   { "hooks": { "PostToolUse": [ { "matcher": "TaskUpdate",
     "hooks": [ { "type": "command",
       "command": "bash \"<resolved-path>/post-task-complete-revalidate.sh\"" } ] } ] } }
   ```

   ```json
   { "hooks": { "Stop": [
     { "hooks": [ { "type": "command",
       "command": "bash \"<resolved-path>/stop-revalidate-user-gates.sh\"" } ] } ] } }
   ```

   Windows note (from `hooks/examples/README.md`): if `bash` is not on `PATH` when hooks run, invoke Git Bash explicitly instead of the bare `bash` command, e.g. `"command": "\"C:\\Program Files\\Git\\bin\\bash.exe\" \"<resolved-path>\\post-task-complete-revalidate.sh\""`.

4. **Also deny `EnterPlanMode` (pcvelz precedent).** The gate-check flow (`skills/checking-gates/SKILL.md`, `skills/specifying-gates/SKILL.md`) forbids plan-mode detours; block it at the permissions layer too. Merge `{"permissions": {"deny": ["EnterPlanMode"]}}` into the same project `.claude/settings.json` — append `"EnterPlanMode"` to an existing `permissions.deny` array (skip if already present), or create the array if absent. Same read-merge-write, same diff-and-confirm if the file already exists.

5. **Confirm the write.** Re-read `.claude/settings.json`, verify the new entries parse and are present, and report the confirmed absolute path back to the user.

## Feature 3: Commit Strategy

One-line intro: plan execution commits after every task by default — each plan task ends with its own Commit step. Switching to a single commit at the end of the plan gives one reviewable commit per feature instead.

```yaml
AskUserQuestion:
  question: "How should plan execution commit its work?"
  header: "Commits"
  options:
    - label: "Per-task commits (default)"
      description: "Every task ends with its own commit - fine-grained history, per-task rollback. Writes docs/superpowers/workflow.json with commitStrategy=\"per-task\" so the choice is explicit on disk."
    - label: "Single commit at plan end"
      description: "Tasks leave changes uncommitted; one final plan task commits the full implementation as a single commit. Writes commitStrategy=\"at-end\"."
    - label: "Skip"
      description: "Leave nothing on disk. Behavior stays the per-task default; identical outcome to choosing it explicitly, just without a config file."
```

- **Per-task commits** → write `docs/superpowers/workflow.json`:

  ```json
  {"commitStrategy": "per-task"}
  ```

- **Single commit at plan end** → write `docs/superpowers/workflow.json`:

  ```json
  {"commitStrategy": "at-end"}
  ```

- **Skip** → write nothing.

This switch has no session-start notice wired up in this build (unlike Feature 1's routing notice), and no skill in this build reads the file yet — it is a declared placeholder for future plan-execution consumers. Say so plainly to the user when offering it. Off-switch: delete the file, or remove the `commitStrategy` key.

## Feature 4: Plugin Auto-Update

One-line intro: third-party marketplaces do NOT auto-update by default, so new `superpowers-dev` releases won't reach this install on their own — you'd have to run `/plugin marketplace update` by hand each time. Enabling auto-update lets the harness refresh the marketplace and its plugins at startup.

**This feature is the one exception to the clean-slate rule** — it checks current state before asking, because proposing a change that is already in place is noise. Auto-update is marketplace-level (there is no per-plugin toggle) and lives in settings wherever the marketplace is registered — almost always user-level `~/.claude/settings.json`.

1. **Detect.** Read `~/.claude/settings.json` (resolve a symlink to the real target) and inspect `extraKnownMarketplaces["superpowers-dev"].autoUpdate`. If the marketplace entry is not there, check the project's `.claude/settings.json` too. Then:
   - `true` → already enabled: tell the user, write nothing, move on.
   - `false` or the key absent → not enabled; ask.
   - the marketplace entry is in neither file → it is not registered in settings; say so and skip this feature. Do NOT invent a marketplace entry.

2. **Ask** (only when not already enabled):

   ```yaml
   AskUserQuestion:
     question: "Enable auto-update for the superpowers-dev marketplace? New releases would then install at the next startup."
     header: "Auto-update"
     options:
       - label: "Yes, enable auto-update (recommended)"
         description: "Sets autoUpdate=true on the marketplace entry in settings.json."
       - label: "No"
         description: "Leave it off - stay on the current version until you run /plugin marketplace update manually. Nothing is written."
   ```

3. **Yes** → set `extraKnownMarketplaces["superpowers-dev"].autoUpdate = true` in the file where that entry lives. Read-merge-write (resolve the symlink, edit the real target); never drop the entry's other keys (e.g. `source`) or any other marketplace entry. Re-read to confirm the value is `true`, report the absolute path written, and tell the user it takes effect at the next startup — no in-session restart.

4. **No** → write nothing.

## Final step: remove the upstream double-install (optional)

This fork (`superpowers@superpowers-dev`) is a drop-in replacement for the original `obra/superpowers`. Having both installed at once leaves every shared skill and command doubled under two namespaces and makes session-start skill loading ambiguous.

Check `/plugin` for installed plugins. If only `superpowers@superpowers-dev` is present: say nothing, skip this step entirely, and proceed to Closing.

If both `superpowers@superpowers-marketplace` (upstream obra) and `superpowers@superpowers-dev` (this fork) are installed simultaneously: explain the conflict in one short paragraph — both plugins are active, they ship overlapping skill and command names, and this fork supersedes upstream — then ask:

```yaml
AskUserQuestion:
  question: "Remove the upstream obra/superpowers plugin to clear the duplicate entries?"
  header: "Double-install"
  options:
    - label: "Yes, remove upstream"
      description: "Uninstall superpowers@superpowers-marketplace via /plugin and, if its marketplace has no other installed plugins afterward, remove that marketplace too."
    - label: "No, leave both installed"
      description: "Keep both active - clean this up later via /plugin."
```

- **Yes** → carry out the removal via the `/plugin` interface in-context: uninstall `superpowers@superpowers-marketplace`, then, if its marketplace now has no other installed plugins, remove the marketplace as well. Confirm each step back to the user.
- **No** → acknowledge and move on.

## Closing

Report in one block, per feature: configured or skipped, the exact absolute path written (if any), and a one-line undo:

- **Routing** — delete `docs/superpowers/model-routing.json` to fully deactivate.
- **Gate hooks** — remove the hook entries you added from `hooks.PostToolUse` / `hooks.Stop` and the `"EnterPlanMode"` entry from `permissions.deny`, all in the project's `.claude/settings.json`.
- **Commit strategy** — delete `docs/superpowers/workflow.json`, or remove its `commitStrategy` key.
- **Auto-update** — set `extraKnownMarketplaces["superpowers-dev"].autoUpdate` back to `false` (or remove the key) in the settings file you wrote it to.

Do not commit. Do not re-ask any question already answered in this run.
