# Native Task Mechanics

Detail moved out of `SKILL.md` to keep the core lean. Referenced from the "Native Task Integration Reference" pointers in `SKILL.md`. The metadata format spec itself (json:metadata fence, `modelTier`) stays in `SKILL.md`; this file holds the surrounding mechanics.

## Why Embedded Metadata

The `metadata` parameter on the task.md task list is accepted but **not returned by the task.md task list**. Embedding it as a `json:metadata` code fence in the description ensures:
- the task.md task list returns the full metadata (it's part of the description)
- Cross-session resume can parse it from .tasks.json
- Subagent dispatch can extract it for implementer prompts

See `skills/shared/task-format-reference.md` for the full metadata schema.

## the task.md task list description — why the full body, and the self-check

**Why it matters.** Both execution paths (`executing-plans` and `subagent-driven-development`) read the task description via the task.md task list and pass it to the implementing subagent. A one-sentence description makes the subagent improvise AC. The plan `.md` is not a fallback — the task.md task list does not read it.

**Self-check before finishing the skill.** After the task.md task list for every task, open the task description (via the task.md task list or by reading `<plan>.tasks.json`) and confirm all four section headers (`**Goal:**`, `**Files:**`, `**Acceptance Criteria:**`, `**Verify:**`) AND the `json:metadata` fence are present. If any section is missing → the task.md task list the description to the full block.

## Setting Dependencies

After all tasks created, set blockedBy relationships:

```
the task.md task list:
  taskId: [task-id]
  addBlockedBy: [prerequisite-task-ids]
```

## During Execution

Update task status as work progresses:

```
the task.md task list:
  taskId: [task-id]
  status: in_progress  # when starting

the task.md task list:
  taskId: [task-id]
  status: completed    # when done
```

## Task Persistence

At plan completion, write the task persistence file **in the same directory as the plan document**.

If the plan is saved to `.superpowers/plans/2026-01-15-feature.md`, the tasks file MUST be saved to `.superpowers/plans/2026-01-15-feature.md.tasks.json`.

```json
{
  "planPath": ".superpowers/plans/2026-01-15-feature.md",
  "tasks": [
    {
      "id": 0,
      "subject": "Task 0: ...",
      "status": "pending",
      "description": "**Goal:** ...\n\n**Files:**\n...\n\n```json:metadata\n{\"files\": [\"path/to/file.py\"], \"verifyCommand\": \"pytest tests/ -v\", \"acceptanceCriteria\": [\"criterion 1\"]}\n```"
    },
    {
      "id": 1,
      "subject": "Task 1: ...",
      "status": "pending",
      "blockedBy": [0],
      "description": "**Goal:** ...\n\n```json:metadata\n{\"files\": [], \"verifyCommand\": \"\", \"acceptanceCriteria\": []}\n```"
    }
  ],
  "lastUpdated": "<timestamp>"
}
```

Both the plan `.md` and `.tasks.json` must be co-located in `.superpowers/plans/`.

## Resuming Work

Any new session can resume by running:
```
/.agent/skills/executing-plans/SKILL.md <plan-path>
```

The skill reads the `.tasks.json` file and continues from where it left off.
