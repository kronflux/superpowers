---
name: error-recovery
description: 'Maintains project-specific known-issues.md mapping recurring errors to solutions; consulted by systematic-debugging before investigation. Triggers: "save this fix", "remember this error", "known issues", or when systematic-debugging resolves a recurring error.'
---

# Error Recovery Intelligence

Maintain a project-level error→solution mapping to avoid rediscovering known problems.

## Adapter Link

Tool selection is governed by `skills/shared/conductor/routing.md` — declare the job (discovery / symbol-edit / docs / output / dispatch / memory) and follow its chain. Searching `known-issues.md` is a discovery job; the existence check (state-probe) and entry writes always stay native (`ctx_execute*` discard their sandbox filesystem).

Note: partial overlap with context-mode auto-memory — context-mode's FTS5 session memory captures tool outputs automatically and is queryable via `ctx_search`; this skill's `known-issues.md` is the durable, human-curated error→solution record. They are complementary, not redundant: use `ctx_search` for what happened this/last session, `known-issues.md` for the canonical recurring-issue catalog.

## File Location

`known-issues.md` at the project root (same level as `package.json`, `Cargo.toml`, etc.).

## When to Consult

Before starting any debugging investigation:
1. Check if `known-issues.md` exists (native state-probe).
2. Search it for the error message, error code, or failing test name — discovery job (see Adapter Link above).
3. If a match is found, try the documented solution first before full investigation.

## When to Update

After resolving a bug that is likely to recur:
- Environment-dependent errors (missing services, port conflicts, env vars)
- Configuration errors (wrong versions, missing dependencies, build flags)
- Test failures caused by external state (database needs seeding, service needs starting)
- Platform-specific issues (Windows vs. Unix path handling, line endings)
- Errors that took significant investigation to diagnose

**Do NOT record:**
- One-off logic bugs (the fix is in the code; the commit message has the context)
- Errors already documented in the project's README or docs
- Transient network/API failures

## Entry Format

Each entry must be concise and actionable:

```markdown
## [Short description]

**Error:** `exact error message or pattern`
**Cause:** One sentence explaining why this happens.
**Fix:**
```bash
exact command or steps to resolve
```
**Context:** When this typically occurs (e.g., "after fresh clone", "on Windows", "when DB is not running").
```

## File Management

- Keep `known-issues.md` under 50 entries. If it grows beyond that, prune entries that haven't been relevant in months.
- Group entries by category (Environment, Dependencies, Tests, Build, Platform).
- When a known issue is permanently fixed (e.g., the root cause was removed from the codebase), delete the entry.

## Integration

- `.agent/skills/systematic-debugging/SKILL.md` consults this file in Phase 1 (Investigate) before generating hypotheses.
- `.agent/skills/using-superpowers/SKILL.md` reads this file during the entry sequence when it exists.
- After resolving a debugging session, offer to add the error→solution mapping if it meets the "When to Update" criteria. Write entries with native Write/Edit — never route the write through `ctx_execute*`.
