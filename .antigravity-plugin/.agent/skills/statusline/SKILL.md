---
name: statusline
description: "Interview installing the conductor statusline: widget vs standalone mode, segments, separator. Writes .superpowers/statusline.json, installs the version-stable launcher, patches .claude/settings.json, and reports the .gitignore outcome truthfully. Re-run to amend, not restart blank."
---

# Conductor Statusline

Installs the conductor statusline built from `hooks/lib/statusline-*.js` and
`scripts/statusline.mjs` / `scripts/statusline-launcher.mjs`. This skill is the only way a
user reaches it: a Claude Code plugin may ship `agent` and `subagentStatusLine` in its own
manifest but not `statusLine` itself — the target must be the user's own `.claude/settings.json`,
and this is what writes it.

**Does NOT install or configure ccstatusline.** Step 7 prints how to point that tool's Custom
Command widget at the launcher, then stops.

## 1. Read existing config first — never start blank

Read `<cwd>/.superpowers/statusline.json` (same file `loadConfig()` in
`hooks/lib/statusline-config.js` reads). If it parses, show its current `mode`, `segments`,
`separator` to the user and use them as the defaults for the questions below, framed as
"amend this?" — not a fresh start. If absent or unreadable, use the schema defaults
(`mode: "widget"`, `segments`: all four ids below, `separator: " · "`).

## 2. The interview

Ask in order, options defaulted from step 1 on a re-run:

**Mode:**
```yaml
ask_question:
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
ask_question:
  question: "Which segments should render?"
  header: "Segments"
  multiSelect: true
  options:
    - label: "capabilities"
      description: "Which conductor tools are active this session (codegraph/context7/lsp/middleware short codes)."
    - label: "delegation"
      description: "Most recent model-routing dispatch for this session (model + blocked/routed marker). Middleware-exec runs never appear here: middleware-exec is a standalone CLI with no session in scope, so its records carry no session identity to match against yours — that cost stays in /.agent/skills/usage/SKILL.md."
    - label: "plan"
      description: "Progress on the newest .tasks.json under .superpowers/plans/ (done/total)."
    - label: "usage"
      description: "This session's cache-read and output token totals from claude-usage.jsonl."
```
An empty selection — every segment off — is a real, valid choice; write it as-is, do not
substitute the defaults.

**Separator:**
```yaml
ask_question:
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
`SEGMENT_IDS` (from `hooks/lib/statusline-config.js`) is
`['capabilities', 'delegation', 'plan', 'usage']` — the four valid ids. Write only the chosen
ids, in that order.

## 4. Install the launcher

Call `installLauncher(configRoot, sourcePath)` from `hooks/lib/statusline-install.js`.
`sourcePath` is this plugin's `scripts/statusline-launcher.mjs` — resolve it via
`CLAUDE_PLUGIN_ROOT` if set in this session's environment, otherwise under
`<configRoot>/plugins/cache/superpowers-dev/superpowers/<version>/scripts/` (list the parent to
find the installed `<version>`). `configRoot` is `CLAUDE_CONFIG_DIR` if set, else `~/.claude`.
`installLauncher` copies the file to `<configRoot>/superpowers-statusline.mjs` and returns that
absolute path.

**Why a separate launcher, not `scripts/statusline.mjs` directly:** the launcher is copied
OUTSIDE the versioned plugin directory and re-resolves the highest installed plugin version's
`scripts/statusline.mjs` at every invocation — this is what gives the install version stability
across plugin updates. Pointing `settings.json` straight at
`.../superpowers/<version>/scripts/statusline.mjs` breaks silently on the next update, and a
broken statusline is invisible: nothing surfaces the failure to the user.

## 5. Patch settings.json

Call `patchSettings(cwd, command)`, `command` = `node "<launcher path>"` (append ` --full` when
mode is full). It reports `{changed: true|false}`, or `{changed: false, state: 'unparseable'}`.

- **`changed: true`** or **`changed: false`** with no `state` — proceed to step 6.
  `changed: false` means an identical block was already present, not a failure; say so rather
  than reporting an error.
- **`state: 'unparseable'`** — `<cwd>/.claude/settings.json` exists but is not valid JSON, so
  `patchSettings` refused to touch it rather than replace it with a fresh object containing only
  `statusLine` (that would silently discard the user's entire settings file — permissions,
  hooks, model, everything — on a single JSON typo). **Stop here.** Do not retry the call, do
  not offer to rewrite or repair the file yourself, and do not continue to steps 6 or 7 as
  though the install succeeded — a statusline pointing at settings that were never patched is
  worse than a clean refusal. Tell the user, naming the exact path
  (`<cwd>/.claude/settings.json`), that the file has a syntax error they need to fix before the
  statusline can be installed, then end the interview.

## 6. gitignore — report the state hit, never assume

Call `ensureGitignored(cwd)` and report exactly which of its four states applied. Do not
collapse them into one message — they mean different things:

- **`already`** — `.claude/` is already covered by an existing `.gitignore` rule. Nothing
  written. Say so.
- **`added`** — no rule existed and `.claude/` was not tracked, or `cwd` is not a git repo at
  all; a `.claude/` line was appended to `.gitignore`. Say so and show the line that was added.
- **`tracked`** — `.claude/` is already tracked by git. **No rule was written.** A `.gitignore`
  rule never untracks a path already tracked, so writing one here would change nothing while
  implying the job was done. Tell the user this plainly, then offer `git rm --cached -r .claude`
  as **their** decision to run in their own terminal — never run it yourself.
- **`unknown`** — `cwd` is a git repo but the tracked-files probe itself failed (lock
  contention, permissions, timeout), so whether `.claude/` is tracked could not be determined.
  **No rule was written.** Report this as **inconclusive**, not as success and not as `tracked`
  — say plainly that the check could not complete and what that means (the tool cannot confirm
  whether `.claude/` is safe to ignore). Do not claim a rule was added.

## 7. Point at ccstatusline (print only; do not install)

When mode is `widget`: print the absolute launcher path and tell the user to open
ccstatusline's Custom Command widget configuration and set its command to
`node "<launcher path>"`. Do not install, configure, or invoke ccstatusline — printing this is
the entire scope of this step.

## Contract this skill must not violate

- **Fail-silent, not fail-loud.** Every artifact this installs (`statusline.mjs`, the launcher)
  prints an empty line and exits 0 on any internal fault — never a stack trace across the
  user's prompt line, since the statusline renders on every assistant message. This skill's own
  interview steps may report errors in-chat; the installed artifacts themselves must not.
- **The launcher exists for version stability** across plugin updates — never repoint
  `settings.json` at a versioned plugin path directly.
- `.superpowers/statusline.json` is the only state this skill owns; re-running reads it back
  and offers to amend rather than discarding the user's prior choices.
