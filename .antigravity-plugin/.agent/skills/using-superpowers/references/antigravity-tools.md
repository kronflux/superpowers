# Antigravity CLI (`agy`) Tool Mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file") using
Claude Code tool names. On Antigravity (`agy`) there is **no `Skill` tool** and there are
**no lifecycle hooks** — resolve every action to the tools below.

## Skill loading

Antigravity has no `Skill` tool. **Invoke a skill by reading its `SKILL.md` with
`view_file`, setting `IsSkillFile: true`** so the harness treats it as a skill load.
Skills live at `.agent/skills/<name>/SKILL.md`; a skill's `references/*.md` sit one level
deep beside it, opened with `view_file` when the `SKILL.md` points to them. There is no
SessionStart hook: bootstrap happens through `gemini-extension.json`
(`contextFileName: GEMINI.md`), which `@`-loads `using-superpowers` at conversation start.

## Action → tool

| Action skills request | Antigravity (`agy`) equivalent |
|----------------------|----------------------|
| Invoke a skill (`Skill` tool) | `view_file` its `SKILL.md` (`IsSkillFile: true`) |
| Dispatch a subagent | `define_subagent` + `invoke_subagent` (see [Subagent support](#subagent-support)) |
| Ask the user a question (`ask_question`) | `ask_question` |
| Task tracking ("create a todo", "mark complete") | a **task artifact** — `write_to_file` with `IsArtifact: true` and `ArtifactType: "task"` (see [Task tracking](#task-tracking)) |
| Read a file (`view_file`) | `view_file` |
| Create a file (`write_to_file`) | `write_to_file` |
| Edit a file (`replace_file_content`) | `replace_file_content` |
| Run a command (`run_command`) | `run_command` |
| Search file contents (`grep_search`) | `grep_search` |
| Find files by name (`find_by_name`) | `find_by_name` |
| Web search (`search_web`) | `search_web` |
| Fetch a URL (`read_url_content`) | `read_url_content` |
| Isolated workspace (`Workspace: "branch"`) | `Workspace: "branch"` on `invoke_subagent` |

Namespaced skill references (`.agent/skills/<name>/SKILL.md`) resolve to
`.agent/skills/<name>/SKILL.md`.

## Subagent support

Dispatch subagents with `define_subagent` followed by `invoke_subagent`, choosing a
built-in `TypeName`: `self` for full-capability implementation work, `research` for
read-only exploration.

**Static vs. dynamic prompt.** A subagent definition carries a *static* `system_prompt`
that is frozen in the context cache when the subagent is defined — put the durable role,
review criteria, and output contract there. Pass the *dynamic*, per-task prompt (the
specific task text and any filled template placeholders) as the message at each
`invoke_subagent` call.

**Workspace isolation.** Run implementers with `Workspace: "branch"` so their edits are
isolated on a branch; run reviewers with `Workspace: "inherit"` so they review the work
in place.

## Task tracking

Antigravity has **no todo tool** (`manage_task` manages background processes —
`list`/`kill`/`status`/`send_input` — it is *not* a checklist). When a skill says to
create a todo list or track tasks, maintain a **task artifact**: a markdown checklist
saved with `write_to_file` (`IsArtifact: true`, `ArtifactType: "task"`), edited with
`replace_file_content` / `multi_replace_file_content` as you go.

At the start of any multi-step task, create the task artifact listing every step of your
plan. As you complete each step, edit the artifact to mark it done (`- [x]`). If the plan
changes, update the checklist. Keep it current — it is your source of truth for what
remains; once the conversation gets long, re-read it before starting each step.
