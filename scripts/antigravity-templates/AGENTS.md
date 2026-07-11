# Superpowers on Antigravity (Gemini)

This profile ports the Superpowers skill library to Antigravity. Antigravity has
**no lifecycle hooks** — there is no SessionStart event to inject a bootstrap. Instead
this profile loads as the extension context (`gemini-extension.json` set
`contextFileName: GEMINI.md`, and `GEMINI.md` `@`-loads `using-superpowers`), and the
skills auto-guide the agent from that entry point onward.

Bootstrap: `@./skills/using-superpowers/SKILL.md`

## How skills work here

- **Invoking a skill = reading its `SKILL.md` with `view_file`** (set `IsSkillFile: true`).
  There is no `Skill` tool on Antigravity. Skills live at `.agent/skills/<name>/SKILL.md`.
- After reading a `SKILL.md`, **follow it exactly**. If it has a checklist, track the steps
  in a `task.md` artifact.
- A skill's `references/*.md` files sit **one level deep** under the skill directory
  (`.agent/skills/<name>/references/<file>.md`); open them with `view_file` when the
  `SKILL.md` points to them.

## Tool substitution contract

Skills are written using Claude Code tool names. On Antigravity, map each to its native
equivalent:

| Claude Code action / tool | Antigravity equivalent |
|---|---|
| `Skill` tool (invoke a skill) | `view_file` the skill's `SKILL.md` (set `IsSkillFile: true`) |
| SessionStart hook (bootstrap) | none exist — `contextFileName` → `GEMINI.md` `@`-loads `using-superpowers` |
| `Task` / Agent dispatch (subagent) | `define_subagent` + `invoke_subagent`. The static `system_prompt` is frozen in the context cache (durable role, review criteria, output contract); pass the dynamic, per-task prompt at each `invoke_subagent`. Run implementers with `Workspace: "branch"`, reviewers with `Workspace: "inherit"`. |
| `AskUserQuestion` | `ask_question` |
| `TaskCreate` / `TodoWrite` (task tracking) | a `task.md` artifact — `write_to_file` with `IsArtifact: true` and `ArtifactType: "task"`, updated with `replace_file_content` |
| `Read` | `view_file` |
| `Write` | `write_to_file` |
| `Edit` | `replace_file_content` |
| `Bash` | `run_command` |
| `Grep` | `grep_search` |
| `Glob` | `find_by_name` |
| `WebSearch` | `search_web` |
| `WebFetch` | `read_url_content` |
| `EnterWorktree` (isolated workspace) | `Workspace: "branch"` on `invoke_subagent` |

Namespaced skill references (`superpowers:<name>`) resolve to
`.agent/skills/<name>/SKILL.md`.
