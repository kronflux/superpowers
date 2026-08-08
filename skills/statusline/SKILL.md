---
name: statusline
description: "Interview installing the conductor statusline: widget vs standalone mode, segments, separator. Writes .superpowers/statusline.json, installs the version-stable launcher, patches .claude/settings.json, and reports the .gitignore outcome truthfully. Re-run to amend, not restart blank."
---

# Conductor Statusline

Installs the conductor statusline (`hooks/lib/statusline-*.js`, `scripts/statusline.mjs`, `scripts/statusline-launcher.mjs`). This skill is the only route to it: a plugin may ship `agent` and `subagentStatusLine` in its manifest but not `statusLine`, so the target must be the user's own `.claude/settings.json`.

**Does NOT install or configure ccstatusline.** Step 7 prints how to point that tool's Custom Command widget at the launcher, then stops.

## 1. Read existing config first — never start blank

Read `<cwd>/.superpowers/statusline.json`, the file `loadConfig()` in `hooks/lib/statusline-config.js` reads. If it parses, show its `mode`, `segments`, and `separator` and use them as the defaults below, framed as "amend this?" rather than a fresh start. If absent or unreadable, use the schema defaults: `mode: "widget"`, all four segment ids, `separator: " · "`.

## 2. The interview

Ask in order, options defaulted from step 1 on a re-run:

**Mode:**
```yaml
AskUserQuestion:
  question: "How will this statusline be consumed?"
  header: "Mode"
  options:
    - label: "ccstatusline widget"
      description: "Emits only the four conductor segments. Paste the launcher command into a ccstatusline Custom Command widget; ccstatusline renders model, context %, and styling around it. mode: widget."
    - label: "Standalone (--full)"
      description: "No third-party install: prefixes model name and context-window percentage ahead of the same conductor segments. mode: full."
```

**Segments** (multi-select; all four preselected on a first run):
```yaml
AskUserQuestion:
  question: "Which segments should render?"
  header: "Segments"
  multiSelect: true
  options:
    - label: "capabilities"
      description: "Which conductor tools are active this session (codegraph/context7/lsp/middleware short codes)."
    - label: "delegation"
      description: "Most recent model-routing dispatch for this session (model + blocked/routed marker). Middleware-exec runs never appear here: middleware-exec is a standalone CLI with no session in scope, so its records carry no session identity to match against yours — that cost stays in /superpowers:usage."
    - label: "plan"
      description: "Progress on the newest .tasks.json under .superpowers/plans/ (done/total)."
    - label: "usage"
      description: "This session's cache-read and output token totals from claude-usage.jsonl."
```
An empty selection — every segment off — is a valid choice; write it as-is, do NOT substitute the defaults.

**Separator:**
```yaml
AskUserQuestion:
  question: "Separator between segments?"
  header: "Separator"
  options:
    - label: "· (default)"
      description: "\" · \" — the schema default."
    - label: "|"
      description: "\" | \""
    - label: "Custom"
      description: "Ask for a literal string next."
```

## 3. Write the config

Write `<cwd>/.superpowers/statusline.json`:
```json
{"segments": ["..."], "separator": "...", "mode": "widget"}
```
`SEGMENT_IDS` in `hooks/lib/statusline-config.js` is `['capabilities', 'delegation', 'plan', 'usage']` — the four valid ids. Write only the chosen ids, in that order.

## 4. Install the launcher

Call `installLauncher(configRoot, sourcePath)` from `hooks/lib/statusline-install.js`. `sourcePath` is this plugin's `scripts/statusline-launcher.mjs` — resolve via `CLAUDE_PLUGIN_ROOT` if set, otherwise under `<configRoot>/plugins/cache/superpowers-dev/superpowers/<version>/scripts/` (list the parent to find the installed `<version>`). `configRoot` is `CLAUDE_CONFIG_DIR` if set, else `~/.claude`. `installLauncher` copies the file to `<configRoot>/superpowers-statusline.mjs` and returns that absolute path.

**Why a launcher rather than `scripts/statusline.mjs` directly:** it sits OUTSIDE the versioned plugin directory and re-resolves the highest installed version's `scripts/statusline.mjs` on every invocation, which is what makes the install survive a plugin update. Pointing `settings.json` at `.../superpowers/<version>/scripts/statusline.mjs` breaks on the next update, and breaks invisibly — nothing surfaces the failure.

## 5. Patch settings.json

Call `patchSettings(cwd, command)` with `command` = `node "<launcher path>"`, appending ` --full` when mode is full. It reports `{changed: true|false}`, or `{changed: false, state: 'unparseable'}`.

- **`changed: true`**, or **`changed: false`** with no `state` — proceed to step 6. `changed: false` means an identical block was already present, not a failure; say so rather than reporting an error.
- **`state: 'unparseable'`** — `<cwd>/.claude/settings.json` exists but is not valid JSON, so `patchSettings` refused rather than replacing it with a fresh object containing only `statusLine`, which would discard the user's permissions, hooks, and model on a single typo. **Stop here.** Do NOT retry, do NOT repair the file yourself, and do NOT continue to steps 6 or 7 as though the install succeeded — a statusline pointing at settings that were never patched is worse than a clean refusal. Name the exact path (`<cwd>/.claude/settings.json`), say it has a syntax error the user must fix first, and end the interview.

## 6. gitignore — report the state hit, never assume

Call `ensureGitignored(cwd)` and report which of its four states applied. Do NOT collapse them — they mean different things:

- **`already`** — an existing `.gitignore` rule already covers `.claude/`. Nothing written. Say so.
- **`added`** — no rule existed and `.claude/` was untracked, or `cwd` is not a git repo; a `.claude/` line was appended. Say so and show the line.
- **`tracked`** — `.claude/` is already tracked by git. **No rule was written.** A `.gitignore` rule never untracks an already-tracked path, so writing one would change nothing while implying the job was done. Say this plainly, then offer `git rm --cached -r .claude` as **their** decision to run in their own terminal — NEVER run it yourself.
- **`unknown`** — `cwd` is a git repo but the tracked-files probe failed (lock contention, permissions, timeout), so whether `.claude/` is tracked is undetermined. **No rule was written.** Report this as **inconclusive** — NOT as success and NOT as `tracked`. Say the check could not complete and that the tool cannot confirm whether `.claude/` is safe to ignore. Do NOT claim a rule was added.

## 7. Point at ccstatusline (print only; do not install)

When mode is `widget`: print the absolute launcher path and tell the user to set their ccstatusline Custom Command widget's command to `node "<launcher path>"`. Printing this is the entire scope of this step — do NOT install, configure, or invoke ccstatusline.

## Contract this skill must not violate

- **Fail-silent, not fail-loud.** Every artifact this installs (`statusline.mjs`, the launcher) prints an empty line and exits 0 on any internal fault — never a stack trace across the user's prompt line, since the statusline renders on every assistant message. This skill's interview steps may report errors in chat; the installed artifacts must NOT.
- **The launcher exists for version stability** across plugin updates — NEVER repoint `settings.json` at a versioned plugin path directly.
- `.superpowers/statusline.json` is the only state this skill owns; re-running reads it back and offers to amend rather than discarding prior choices.
