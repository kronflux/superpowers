---
name: output-style
description: "Installs the shipped Signal output style (output-styles/signal.md) and sets outputStyle in settings. Reads any existing selection first and requires confirmation before replacing it. Scope: user-global (default), project, or project-local. Never injects at SessionStart."
---

# Output Style

Installs `output-styles/signal.md` — this plugin's shipped answer-shape style — as a Claude Code output style, then points `outputStyle` at it in a settings file the operator chooses. An installed style is loaded into the system prompt and reaches the model on every turn without any skill being invoked; a shared contract document like `${CLAUDE_PLUGIN_ROOT}/skills/shared/output-contract.md` only reaches the model when a skill reads it.

**One style ships.** Signal is the only maintained preset. Its rules already carry ASD-STE100 plain-language principles and the density and decidability requirements that make output usable to a reader who cannot parse a wall of text. This skill installs that one style; it does not run a custom-style interview.

## 1. Determine the scope — ask before writing

The style **document** is config-dir scoped and its target never changes: `<configDir()>/output-styles/signal.md`, regardless of which scope is chosen below. The **selection** (`outputStyle` in a settings file) is scope-dependent, and the three scopes are genuinely different things, not three ways to say the same thing:

- **User-global** — `<configDir()>/settings.json` (typically `~/.claude/settings.json`). Applies to every project on this machine. **Default; recommend this** — it is the only scope that stops the operator from repeating this setup per project.
- **Project** — `<projectRoot>/.claude/settings.json`. Applies to this project only, and is typically committed, so it also applies for anyone who checks the repo out.
- **Project-local** — `<projectRoot>/.claude/settings.local.json`. Applies to this project only, on this machine only — the conventional home for a machine-local override that should not travel with the repo.

```yaml
AskUserQuestion:
  question: "Where should the outputStyle selection be set?"
  header: "Scope"
  options:
    - label: "User-global (recommended)"
      description: "<configDir()>/settings.json. Every project on this machine picks it up — stops repeating this setup per project."
    - label: "Project"
      description: "<projectRoot>/.claude/settings.json. This project only; typically committed, so it applies to anyone who checks the repo out."
    - label: "Project-local"
      description: "<projectRoot>/.claude/settings.local.json. This project only, this machine only — for a selection that should not travel with the repo."
```

## 2. Read the existing settings file — never overwrite silently

Resolve the target settings file for the chosen scope (paths above; `configDir()` is exported by `hooks/lib/config-dir.js`). Read it if it exists and parse it as JSON.

- **File absent, or parses with no `outputStyle` key** — nothing to confirm. Continue to step 3.
- **File parses and `outputStyle` is already `"Signal"`** — nothing to confirm; the write in step 4 is a no-op (`patchSettings` reports `changed: false`). Continue to step 3.
- **File parses and `outputStyle` holds a different value** — report the current value and the path it came from, and require explicit confirmation before replacing it:

  ```yaml
  AskUserQuestion:
    question: "outputStyle is currently \"<value>\" in <path>. Replace it with \"Signal\"?"
    header: "Confirm"
    options:
      - label: "Yes, replace it"
        description: "Overwrites the outputStyle selection at <path>."
      - label: "No, stop"
        description: "Leaves the existing selection untouched. Nothing is written."
  ```
  On "No, stop": report the path and the value left in place, and end here. Do not write the style document either — an install nobody selected is not a partial success.
- **File exists but is not valid JSON** — do not attempt to read `outputStyle` out of it, and do not repair it. Report the exact path and that it has a syntax error to fix first, then stop. `patchSettings` in step 4 would refuse the same file the same way, so there is nothing left to do in this run.

## 3. Write the style document

Read `${CLAUDE_PLUGIN_ROOT}/output-styles/signal.md` (resolve via `CLAUDE_PLUGIN_ROOT` if set, otherwise under `<configRoot>/plugins/cache/superpowers-dev/superpowers/<version>/output-styles/` — list the parent to find the installed `<version>`). Create `<configDir()>/output-styles/` if it does not exist — it does not exist by default on a fresh install — and write the file to `<configDir()>/output-styles/signal.md`, byte-for-byte.

## 4. Patch the settings file

Call `patchSettings` from `hooks/lib/statusline-install.js` with key `'outputStyle'` and value `'Signal'`:

- **User-global** — `patchSettings(null, 'outputStyle', 'Signal', { settingsDir: configDir() })`, targeting `<configDir()>/settings.json` directly. Do NOT pass `configDir()` as `projectDir` under the default join: its basename is usually `.claude`, and `patchSettings` refuses that shape as `nested-claude-dir` rather than writing a `<configDir()>/.claude/settings.json` nobody reads.
- **Project** — `patchSettings(projectRoot, 'outputStyle', 'Signal')`, targeting `<projectRoot>/.claude/settings.json`.
- **Project-local** — `patchSettings(projectRoot, 'outputStyle', 'Signal', { filename: 'settings.local.json' })`, targeting `<projectRoot>/.claude/settings.local.json`.

`patchSettings` always returns `{ changed, path, state }`, `path` the absolute settings file involved in every branch — present, refused, or unchanged.

- **`changed: true`**, or **`changed: false`** with no `state` — proceed to step 5. `changed: false` with no `state` means `outputStyle` already held `"Signal"` — say so; it is not a failure.
- **`state: 'unparseable'`** — the settings file is not valid JSON. Stop; do not retry and do not repair it yourself. Report the exact path and that it needs a syntax fix first. Step 2 should already have caught this for the common case; if it is reached anyway, the response is identical.
- **`state: 'nested-claude-dir'`** — only reachable for Project/Project-local scope, when `projectRoot` itself is already named `.claude`. Stop and correct the path rather than nesting a `.claude/.claude/`.

## 5. Report

State, in every branch, the absolute path of the style document (written, or "already present, byte-identical") and the absolute path of the settings file (patched, or left untouched, with the reason). Never claim the selection is active without having confirmed the settings write actually landed at that path.

## Never do this

- **Never inject the style, or any part of it, at `SessionStart`.** The entire value of an installed style over a `SessionStart` payload is that it costs nothing per turn once installed; injecting its content back in at `SessionStart` reproduces the exact per-turn token cost this skill exists to avoid — the same cost Anthropic's own `explanatory-output-style` plugin warns about in its own README by injecting anyway. This skill writes files and patches settings; it does not touch any hook, and no hook should be added on its behalf.
- **Never replace an existing `outputStyle` without the confirmation in step 2.**
- **Never run a custom-style interview.** One style ships; Signal already carries those requirements.
