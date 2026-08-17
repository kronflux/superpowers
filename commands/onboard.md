---
description: "Guided setup for this fork's opt-in features: subagent model routing, user-gate enforcement hooks, commit strategy, marketplace auto-update. Asks short questions, writes chosen config immediately. Everything is optional; nothing activates without an explicit yes."
---

# Superpowers Onboarding

Walk the user through this fork's optional features one at a time. For each feature: ask, then immediately write the chosen configuration — no deferred "now apply this yourself" summary.

## Ground rules

- **Assume a clean slate.** Do NOT audit existing configuration beyond what each step needs to do its own job (Feature 2's dedupe check and Feature 4's already-enabled check are the only state reads this command performs — both are required by the step itself, not general auditing). Go straight to the questions.
- **Discrepancy handling:** if a file you are about to write already exists with content that differs from what you are about to write, stop, show the diff (existing vs. proposed), and let the user decide free-form (keep / overwrite / adjust) before writing. This applies to `.superpowers/model-routing.json`, `.superpowers/workflow.json`, `$CLAUDE_CONFIG_DIR/middleware-config.json` (or `~/.claude/middleware-config.json` when no custom config root is active), and any settings file being merged.
- Each feature is optional. Every question includes a way to decline; declining writes nothing and moves to the next feature.
- **NEVER commit anything.** Files are written to the working tree only; committing is the user's call.
- After the last feature, produce the Closing summary (see below) — what was written and where, what was skipped, and how to undo each.

All config-file paths below are relative to the current project root. Hook registrations target the project's `.claude/settings.json` specifically (not a user-level alternative).

## Feature 1: Subagent Model Routing

One-line intro for the user before asking: plan execution dispatches an implementer plus reviewers per task, and by default they all inherit the session model — on a top-priced session that multiplies the most expensive model across tasks that are, by design, often mechanical. Full semantics: `docs/model-routing-flow.md`.

```yaml
AskUserQuestion:
  question: "Enable model routing for plan-execution subagents?"
  header: "Routing"
  options:
    - label: "Guided tiers (recommended)"
      description: "mechanical->haiku, standard->sonnet, advanced->opus, frontier off. Cheap models for routine implementation, mid-tier for integration and reviews, full power where judgment lives."
    - label: "One fixed model"
      description: "Every subagent uses one model you pick next - flat cost cap, no per-task gradation."
    - label: "Skip"
      description: "Keep the default: every subagent inherits the session model. Nothing is written."
```

Before writing the routing file under `.superpowers/` in either branch below: run `git check-ignore -q .superpowers` in the project root. Not ignored → tell the user this file is machine-local by design and offer to append `.superpowers/` to `.gitignore` (decline = write anyway, noting it will show as untracked). Then, if the legacy file `docs/superpowers/model-routing.json` exists: offer to move it to `.superpowers/` instead of writing a second copy — an unmigrated legacy file is shadowed by the canonical one and drifts silently. Never move it without a yes.

- **Guided tiers** → show the user the exact mapping you are about to write and offer to change any tier before writing:

  ```json
  {"schema": 2, "mechanical": "haiku", "standard": "sonnet", "advanced": "opus", "frontier": "off"}
  ```

  Then ask whether to enable the frontier tier:

  ```yaml
  AskUserQuestion:
    question: "Enable the frontier tier (Fable) for exceptional tasks?"
    header: "Frontier"
    options:
      - label: "Off (recommended)"
        description: "advanced/Opus is the ceiling. Handles design judgment, architecture, and broad codebase understanding. No frontier prompts ever."
      - label: "Enable, prompt per task"
        description: "Fable becomes available at 2x the advanced tier. Never automatic - every frontier task asks you first, with the reason and the cost."
  ```

  On **Enable**, set `"frontier": "fable"`. If the user wants a different value for any tier, substitute it before writing — but never set `frontier` to the same model as `advanced` (the config would be rejected as invalid). Write the result to `.superpowers/model-routing.json` (create `.superpowers/` if missing).

- **One fixed model** → ask the follow-up below first, then write `{"schema": 2, ...}` with `mechanical`, `standard`, and `advanced` all set to the chosen value and `"frontier": "off"`. Frontier must stay off here: a flat cap has no second tier to gate, and a config where `advanced` and `frontier` name the same model is rejected as invalid.

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
  ```

- **Skip** → write nothing.

After writing the file, tell the user: the routing gates (`hooks/pre-taskcreate-model-tier.js`, `hooks/pre-agent-model-routing.js`) check for this file on every relevant tool call and activate immediately — no restart needed. The tier mapping and rules reach the agent at the session's first `Agent` dispatch, not before. Kill switch at runtime: `SUPERPOWERS_ROUTING_GUARD=0`. Off-switch: delete `.superpowers/model-routing.json` — routing goes fully dormant, byte-identical to never having opted in. (If you also have a legacy `docs/superpowers/model-routing.json`, delete that too; the canonical file takes precedence and deleting only the legacy one leaves routing active.) If you enabled the frontier tier, nothing dispatches to it silently: each qualifying task asks first, states why frontier suits it, and offers advanced as the default. Set `"frontier": "off"` to stop those prompts entirely.

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

1. **Resolve the plugin root, then install the version-stable launcher.** If `CLAUDE_PLUGIN_ROOT` is set in this session's environment, that is the plugin root. Otherwise look under `~/.claude/plugins/cache/superpowers-dev/superpowers/<version>/` (Windows: `%USERPROFILE%\.claude\plugins\cache\superpowers-dev\superpowers\<version>\`) — list the parent directory to find the installed `<version>`. Verify `hooks/examples/post-task-complete-revalidate.sh` (and, if selected, `hooks/examples/stop-revalidate-user-gates.sh`) actually exist under it. If no location resolves, tell the user the install path could not be found and stop this feature without writing anything.

   Call `installGateLauncher(configRoot, pluginRoot)` from `hooks/lib/gate-launcher-install.js`. `configRoot` is `CLAUDE_CONFIG_DIR` if set, else `~/.claude`. This copies the launcher, its resolver, and a fallback copy of both gate scripts to `<configRoot>/`, outside the versioned plugin directory, and returns the launcher's absolute path (`<configRoot>/superpowers-gate-launcher.sh`) — that path, not any path containing `<version>`, is what gets registered below. The launcher resolves the real gate script at run time (`installed_plugins.json`, then a version-sorted cache scan, then its own fallback copy), so a later plugin update never orphans the registration.

2. **Migrate an existing version-pinned registration before deduping.** For each of the project's `.claude/settings.json`, the project's `.claude/settings.local.json`, and the user's `~/.claude/settings.json`: if the file exists, call `migrateGateHookCommand(settingsPath, launcherPath)` from the same module. It rewrites any hook `command` that still points at `hooks/examples/post-task-complete-revalidate.sh` or `hooks/examples/stop-revalidate-user-gates.sh` inside a versioned plugin path to invoke the launcher instead (`bash "<launcherPath>" <script-name>`), leaving every other key untouched, and reports `{changed, path}` (or `state: 'unparseable'`, which per Ground rules means stop and show the diff rather than write). Report each file it actually changed to the user. A settings file with no pinned entry is untouched and not reported.

3. **Dedupe check spans every settings scope.** Before adding an entry for a given script, check whether a hook `command` referencing that script's filename is already registered in ANY of the same three files. If it is already registered anywhere (including by the migration in step 2), do not add it again — report which file already covers it and move on to the next hook (or to the `EnterPlanMode` step if both hooks are already covered).

4. **Merge into the project's `.claude/settings.json`, never overwrite.** Read the file first (resolve a symlink to the real target). Diff-and-confirm per Ground rules if it already exists. Append each new hook entry into the matching array (`hooks.PostToolUse` for the per-task hook, matcher `TaskUpdate`; `hooks.Stop` for the stop hook, no matcher), creating only the missing keys, and write the full merged result back. If an object with the same matcher already exists in that array, push the new command into its `hooks` sub-array instead of creating a sibling matcher object. If the file does not exist, create it containing only the hooks structure being added. Registration shapes (substitute the launcher path from step 1 for `<launcher-path>`):

   ```json
   { "hooks": { "PostToolUse": [ { "matcher": "TaskUpdate",
     "hooks": [ { "type": "command",
       "command": "bash \"<launcher-path>\" post-task-complete-revalidate.sh" } ] } ] } }
   ```

   ```json
   { "hooks": { "Stop": [
     { "hooks": [ { "type": "command",
       "command": "bash \"<launcher-path>\" stop-revalidate-user-gates.sh" } ] } ] } }
   ```

   Windows note (from `hooks/examples/README.md`): if `bash` is not on `PATH` when hooks run, invoke Git Bash explicitly instead of the bare `bash` command, e.g. `"command": "\"C:\\Program Files\\Git\\bin\\bash.exe\" \"<launcher-path>\" post-task-complete-revalidate.sh"`.

5. **Also deny `EnterPlanMode` (pcvelz precedent).** The gate-check flow (`skills/checking-gates/SKILL.md`, `skills/specifying-gates/SKILL.md`) forbids plan-mode detours; block it at the permissions layer too. Merge `{"permissions": {"deny": ["EnterPlanMode"]}}` into the same project `.claude/settings.json` — append `"EnterPlanMode"` to an existing `permissions.deny` array (skip if already present), or create the array if absent. Same read-merge-write, same diff-and-confirm if the file already exists.

6. **Confirm the write.** Re-read `.claude/settings.json`, verify the new entries parse and are present, and report the confirmed absolute path back to the user.

## Feature 3: Commit Strategy

One-line intro: plan execution commits after every task by default — each plan task ends with its own Commit step. Switching to a single commit at the end of the plan gives one reviewable commit per feature instead.

```yaml
AskUserQuestion:
  question: "How should plan execution commit its work?"
  header: "Commits"
  options:
    - label: "Per-task commits (default)"
      description: "Every task ends with its own commit - fine-grained history, per-task rollback. Writes .superpowers/workflow.json with commitStrategy=\"per-task\" so the choice is explicit on disk."
    - label: "Single commit at plan end"
      description: "Tasks leave changes uncommitted; one final plan task commits the full implementation as a single commit. Writes commitStrategy=\"at-end\"."
    - label: "Skip"
      description: "Leave nothing on disk. Behavior stays the per-task default; identical outcome to choosing it explicitly, just without a config file."
```

Before writing the workflow file under `.superpowers/` in either branch below: run `git check-ignore -q .superpowers` in the project root. Not ignored → tell the user this file is machine-local by design and offer to append `.superpowers/` to `.gitignore` (decline = write anyway, noting it will show as untracked). Then, if the legacy file `docs/superpowers/workflow.json` exists: offer to move it to `.superpowers/` instead of writing a second copy — an unmigrated legacy file is shadowed by the canonical one and drifts silently. Never move it without a yes.

- **Per-task commits** → write `.superpowers/workflow.json`:

  ```json
  {"commitStrategy": "per-task"}
  ```

- **Single commit at plan end** → write `.superpowers/workflow.json`:

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

## Conductor integrations

One-line intro: this fork's conductor layer (`skills/shared/conductor/`) adapts its behavior to optional external tools — CodeGraph (macro discovery), LSP (post-edit diagnostics), Context7 (live docs), and a middleware-exec provider. None of them is required; each adapter falls back to native tools when its capability is absent.

**Detection.** Detection runs `probe()` from `hooks/lib/capability-registry.js` (or, equivalently, reads the session-start `[conductor]` line it feeds) — this is the primary, always-current read. `context-snapshot.json`'s `capabilities` key, when the file already exists, is written by `hooks/lib/session-start-probe.mjs` at session start and MAY corroborate `probe()`'s result; it is an update-when-present artifact, not the first read path, and its absence is never a blocker. For each capability below, offer it only if its `status` is `absent` AND no decline marker for it exists yet in the project root. Never offer a capability already `configured` or `verified` (LSP is the exception to this rule — see its section below, since its `status` is `configured` once any single language is covered and it must still be offered for uncovered languages).

**Decline persistence.** Each capability below has its own marker file, following the convention `hooks/lib/capability-registry.js` already uses for CodeGraph (`.superpowers-no-codegraph`): `.superpowers-no-context7`, `.superpowers-no-middleware`, `.superpowers-no-lsp`. On "no" / "never ask again", create the marker file in the project root and move on; a future `/onboard` run must check for it before asking again. `.superpowers-no-lsp` is the one exception to the empty-file convention: it holds newline-delimited plugin names, so a decline is per-language, and an empty file declines every language. On "yes", proceed with that capability's steps below; no marker is written.

**Never auto-run.** Every install/registration command below is printed for the user to copy-paste and run in their own terminal — never execute it via Bash/PowerShell yourself. Only the local config-file writes explicitly described below (the middleware config copy, decline markers) are things you write directly, the same way Features 1-4 write their own config files.

### CodeGraph

Pitch: repo-wide call-graph and blast-radius answers (`codegraph_impact`, `codegraph_callers`) for "what breaks if I change X" / "what calls Y" questions, instead of manual grep/Read sweeps.

```yaml
AskUserQuestion:
  question: "Install CodeGraph (call-graph macro discovery, adapter: skills/shared/conductor/codegraph.md)?"
  header: "CodeGraph"
  options:
    - label: "Yes, show me the install commands"
      description: "Prints the install script, agent-wiring command, and per-project index command for you to run yourself."
    - label: "No, don't ask again"
      description: "Writes .superpowers-no-codegraph in the project root. Nothing installed."
```

- **Yes** → print, for the user to run themselves (never execute):
  1. Install the CLI — Windows: `irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex`; macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh`. Alternative for either OS if `npm` is already on `PATH`: `npm i -g @colbymchenry/codegraph@latest`.
  2. Wire it into installed agents (Claude Code, Cursor, Codex CLI, etc.), once, machine-wide: `codegraph install`.
  3. Per-project (this repo), builds `.codegraph/` and the initial graph, then auto-syncs on every file change: `codegraph init`. This step is separate from step 2 and is also offered once more, on its own, by the CodeGraph adapter itself (`skills/shared/conductor/codegraph.md`, "Init offer") if skipped here.
- **No** → write `.superpowers-no-codegraph` (empty file) in the project root.

### LSP (language diagnostics)

Pitch: attach a language server so Claude sees type errors and warnings immediately after each
edit, instead of spending a build cycle to discover them. Adapter:
`skills/shared/conductor/lsp.md`.

Determine the project's dominant language from its manifest or file mix, then map it to the
matching official plugin: TypeScript/JavaScript → `typescript-lsp`, Python → `pyright-lsp`,
Rust → `rust-analyzer-lsp`, Go → `gopls-lsp`, Ruby → `ruby-lsp`, Java → `jdtls-lsp`,
Kotlin → `kotlin-lsp`, C# → `csharp-lsp`, C/C++ → `clangd-lsp`, PHP → `php-lsp`,
Lua → `lua-lsp`, Swift → `swift-lsp`, Liquid → `liquid-lsp`. No match → skip this section
silently; there is nothing to offer.

The session line's `lsp diagnostics active` is a **global** signal — true if any installed LSP
plugin covers any language anywhere in the repo — it does NOT mean this particular language is
covered. Check the per-language signal instead: `probe().lsp.extensions`, a lowercased,
dot-prefixed array (e.g. `['.go', '.ts']`) of extensions covered by installed servers. If the
dominant language's extension (e.g. `.py` for Python, `.rb` for Ruby) is already in that array,
skip the offer — a server for that language is already active.

```yaml
AskUserQuestion:
  question: "Install <plugin> for inline diagnostics after each edit?"
  header: "LSP"
  options:
    - label: "Yes"
      description: "Prints the /plugin install command for you to run. Nothing is executed here."
    - label: "No"
      description: "Appends <plugin> to .superpowers-no-lsp in the project root. Nothing configured."
```

- **Yes** → print for the user to run themselves:

  ```text
  /plugin marketplace add anthropics/claude-plugins-official
  /plugin install <plugin>@claude-plugins-official
  ```

  Skip the `marketplace add` line if `claude-plugins-official` is already registered (check via
  `/plugin`).

  Then state the limit plainly: diagnostics are a fast first signal, never a substitute for the
  project's own typecheck or test gate (`skills/shared/conductor/lsp.md`).
- **No** → append `<plugin>` on its own line to `.superpowers-no-lsp` in the project root,
  creating the file if absent. Declining one language does not silence the others.

### Context7

Pitch: current API surface for version-sensitive external libraries (renamed params, new hooks, breaking changes since training data) during design/planning/dependency work.

```yaml
AskUserQuestion:
  question: "Set up Context7 (live docs lookup, adapter: skills/shared/conductor/context7.md)?"
  header: "Context7"
  options:
    - label: "Yes, show me the setup commands"
      description: "Prints the plugin-install command (recommended) and the non-plugin setup command for you to run yourself."
    - label: "No, don't ask again"
      description: "Writes .superpowers-no-context7 in the project root. Nothing configured."
```

- **Yes** → print, for the user to run themselves (never execute):

  **Plugin install (recommended):** verified against Context7's own published docs (`_reference/context7/docs/clients/claude-code.mdx`, "Installing the Plugin") — bundles the MCP server (`resolve-library-id`, `query-docs`) with a documentation-lookup skill, a `docs-researcher` agent, and the `/context7:docs` command:
  ```shell
  /plugin marketplace add upstash/context7
  /plugin install context7@context7-marketplace
  ```
  Once installed, its files resolve under this harness's standard plugin-cache layout: `$CLAUDE_CONFIG_DIR/plugins/cache/context7-marketplace/context7/<version>/` first, `$HOME/.claude/plugins/cache/context7-marketplace/context7/<version>/` as fallback when no custom config root is active. Without an API key the plugin works anonymously at lower rate limits; to use a personal plan, create a key at the Context7 dashboard (`https://context7.com/dashboard`) and export it before launching Claude Code: `export CONTEXT7_API_KEY="your-api-key"` (restart Claude Code after setting it). Note: this fork's own profile also has Context7 pre-registered under Anthropic's curated `claude-plugins-official` marketplace (verified live in `installed_plugins.json` as `context7@claude-plugins-official`) — if that marketplace is already added, `/plugin install context7@claude-plugins-official` is the shortcut; otherwise use the upstream-published commands above.

  **Alternative (non-plugin install):** `npx ctx7 setup --claude` (Node.js >= 18; authenticates via OAuth, generates an API key, and wires Claude Code — CLI+Skills or MCP mode, user's choice in the prompt). Removal later: `npx ctx7 remove`. If the user prefers manual MCP wiring instead of either route above, tell them the two values it would need — server `https://mcp.context7.com/mcp`, API key passed via a `CONTEXT7_API_KEY` header — and point them to Context7's own docs for the exact config file syntax rather than writing `.mcp.json` yourself.
- **No** → write `.superpowers-no-context7` (empty file) in the project root.

### Middleware (middleware-exec)

What it's for: `middleware-exec` offloads mechanical, non-judgment text processing — log/error digests, test-failure summaries, test-scaffolding boilerplate — to a cheap or local model, so the session model's tokens aren't spent on it. It is **unconfigured by default** in this fork; nothing installs or activates it automatically. While unconfigured, that mechanical work does not go unhandled — it simply falls back to the Claude mechanical-tier subagent via the existing `modelTier` routing (see `skills/shared/conductor/middleware.md`, "Fallback policy"), which still works but spends session-model (or routed-tier) tokens instead of a cheaper external one. Context-heavy digests (summarizing large logs or search results into the conversation) stay opt-in through the existing `ctx_search`/`ctx_execute` methodology either way — middleware is never a substitute for that, configured or not.

```yaml
AskUserQuestion:
  question: "Set up middleware-exec (cheap-model text processing, currently unconfigured)?"
  header: "Middleware"
  options:
    - label: "Yes"
      description: "Copies the example config to the active config root and asks which provider you use."
    - label: "No, don't ask again"
      description: "Writes .superpowers-no-middleware in the project root. Stays unconfigured; mechanical work keeps falling back to Claude model tiers."
```

- **Yes** →
  1. Ask which provider, per the choices documented in `docs/middleware-config.example.json`:
     ```yaml
     AskUserQuestion:
       question: "Which provider does middleware-exec call?"
       header: "Provider"
       options:
         - label: "openrouter"
           description: "Routes through OpenRouter's API."
         - label: "ollama"
           description: "Local Ollama server."
         - label: "litellm"
           description: "Self-hosted LiteLLM proxy."
         - label: "cli (agy / opencode / claude)"
           description: "Drive a local CLI agent instead of an HTTP endpoint. No API key needed if the CLI is already authenticated. Each call runs in a throwaway directory."
     ```
  2. Copy target is the active config root, never a hardcoded path: `$CLAUDE_CONFIG_DIR/middleware-config.json` if `CLAUDE_CONFIG_DIR` is set in this session's environment, otherwise `~/.claude/middleware-config.json`. State this explicitly to the user: **under a custom config root (e.g. a multi-profile launcher), nothing is written to `~/.claude` — the active profile's config root is the only write target.** Copy `docs/middleware-config.example.json` to that target (Ground rules diff-and-confirm applies if the destination already exists), setting `active_provider` to the chosen value.
     - For `openrouter`/`ollama`/`litellm`: set `active_model` to that provider's example `model` (e.g. `openai/gpt-4o-mini` for openrouter). Ask for the API key's environment-variable name (default: the example's `api_key_env` for that provider, e.g. `OPENROUTER_API_KEY`); substitute if the user gives a different name, then have them `export` it in their shell profile — never ask for or write the raw key, only its env-var name.
     - For `cli`: write an endpoint using the `agy` preset (see the example's `agy-cli` entry) and set `active_provider` to it. No `api_key_env` is required. Tell the user the preset can be swapped to `opencode` or `claude` by changing the `preset` field; full schema and hazards are documented in `skills/shared/conductor/middleware.md`, "Transports".
- **No** → write `.superpowers-no-middleware` (empty file) in the project root.

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

- **Routing** — delete `.superpowers/model-routing.json` to fully deactivate. (If you also have a legacy `docs/superpowers/model-routing.json`, delete that too; the canonical file takes precedence.)
- **Gate hooks** — remove the hook entries you added from `hooks.PostToolUse` / `hooks.Stop` and the `"EnterPlanMode"` entry from `permissions.deny`, all in the project's `.claude/settings.json`.
- **Commit strategy** — delete `.superpowers/workflow.json`, or remove its `commitStrategy` key.
- **Auto-update** — set `extraKnownMarketplaces["superpowers-dev"].autoUpdate` back to `false` (or remove the key) in the settings file you wrote it to.
- **CodeGraph** — nothing written by this offer besides an optional `.superpowers-no-codegraph` decline marker (delete it to be asked again); the CLI/agent-wiring/index steps are all run by the user outside this flow.
- **LSP** — nothing written besides an optional `.superpowers-no-lsp` decline list; delete a line from it to be asked about that language again.
- **Context7** — nothing written by this offer besides an optional `.superpowers-no-context7` decline marker; `npx ctx7 remove` undoes the setup command itself.
- **Middleware** — delete `middleware-config.json` from wherever it was written (`$CLAUDE_CONFIG_DIR/` if a custom config root was active, else `~/.claude/`); delete `.superpowers-no-middleware` to be asked again.

Do not commit. Do not re-ask any question already answered in this run.
