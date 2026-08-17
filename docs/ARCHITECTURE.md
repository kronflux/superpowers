# Superpowers Architecture (kronflux fork)

How the fork's runtime pieces fit together: the hook lifecycle, the manifest compile pipeline,
the four-layer memory model, the context-mode coexistence contract, the per-harness surfaces,
and the test suites that guard each. Headings are kept search-friendly for `ctx_index`.

## Runtime data flow

The plugin is driven by lifecycle hooks. Each fires on a harness event and is registered from
`plugin.universal.mjs`. All hooks **fail open** — any internal fault allows the action.

### SessionStart

- `hooks/session-start` (via `hooks/run-hook.cmd`) injects the `using-superpowers` SKILL.md
  **body** into session context. `awk` strips the YAML frontmatter so only the payload body is
  sent (`hookSpecificOutput.additionalContext`, ~5.2 KB — see Context economy).
- If `.superpowers/model-routing.json` (canonical) → legacy `docs/superpowers/model-routing.json`
  → `$CLAUDE_CONFIG_DIR/superpowers/model-routing.json` → `~/.claude/superpowers/model-routing.json`
  resolves (first match wins), the tier mapping and rules reach the agent at the session's first
  `Agent` dispatch (`hooks/pre-agent-model-routing.js`), not here — a session that never
  dispatches a subagent never receives them. A legacy project config still triggers a
  `<model-routing-legacy>` migration offer here, since that concerns configuration rather than
  dispatch. Absent config → byte-identical output with no block.
- `hooks/context-engine.js` runs on SessionStart (claude-code and codex) for context-mode
  detection and session bookkeeping.
- `hooks/lib/config-dir.js` (`CLAUDE_CONFIG_DIR` → `~/.claude`) is the shared config-root
  resolver and now governs every user-level artifact: routing config, middleware config,
  capability detection, and hook telemetry.

### UserPromptSubmit

`hooks/skill-activator.js` assembles injected context from three sources, each scored:

1. **Skill hints** — rules-scored against `hooks/skill-rules.json`; intent patterns weighted
   higher. Never dropped (score `Infinity`).
2. **Memory recall** — keyword grep of `session-log.md`, ≤2 deduped `[saved]` entries.
3. **Known-issues recall** — matches from `known-issues.md`.

Blocks are sorted by score and passed through `capInjection` at `INJECTION_CAP_BYTES = 4000`;
memory and known-issues are shed lowest-relevance-first while skill hints are preserved. A
**context-pressure gate** hard-blocks injection at `CONTEXT_WINDOW_SIZE * 0.60`
(`CONTEXT_WINDOW_SIZE` = `SUPERPOWERS_CONTEXT_WINDOW` env or 200000).

### PreToolUse

Ordered chain, each self-gating:

1. **Safety pair** — `hooks/safety/block-dangerous-commands.js` and
   `hooks/safety/protect-secrets.js` deny destructive commands and secret exposure.
2. **Bash compression** — `hooks/bash-compress-hook.js` trims noisy output, but **yields
   (`returns {}`) when context-mode is active** — context-mode owns Bash routing in that mode.
   Honors `SP_NO_COMPRESS=1` and `.sp-no-compress`.
3. **Routing gates** (active only when model-routing is opted in and tiered tasks exist):
   `pre-taskcreate-model-tier.js` (TaskCreate — plan tasks need a valid `modelTier`),
   `pre-agent-model-routing.js` (Agent — general-purpose dispatch must use an allowed model),
   `pre-askuser-handoff-guard.js` (AskUserQuestion — only the mandated Execution Handoff passes).

### PostToolUse

`hooks/track-edits.js` and `hooks/track-session-stats.js` record edit and session telemetry
(skill invocations, injected bytes).

### Stop

`hooks/stop-reminders.js` emits a session summary including the **hook-injected-context byte
line** (`hook-injected context this session: <N>KB`). Guarded per-session by a
`<tmpdir>/sp/stop-<sessionId>.lock` file so it fires once, never a global lock.

### SubagentStop

`hooks/subagent-guard.js` validates subagent returns (e.g. required evidence tokens).

## Compile pipeline

Hook manifests are **generated, never hand-edited**.

- `plugin.universal.mjs` is the single source. Each entry:
  `{ event, matcher?, command, async?, platforms }`.
- `scripts/compile-hooks.mjs` validates every entry (valid event, non-empty command), then
  builds all outputs and writes them **all-or-nothing**:
  - `claude-code` → `hooks/hooks.json`
  - `codex` → `hooks/codex-hooks.json`
  - `cursor` → `hooks/hooks-cursor.json`
- Run via `npm run compile-hooks`. **Byte-idempotence** (recompiling produces identical bytes)
  is asserted by `tests/compile.test.js` and `tests/compile-manifests.test.js`.

## Four-layer memory

Full protocol lives in `skills/context-management/SKILL.md`; summary:

| Layer | Store | Owner | Recall |
|---|---|---|---|
| In-session auto-capture | context-mode SQLite | context-mode | `ctx_search` (`sort:"timeline"` on resume) |
| Session boundary | `state.md` | context-management skill | read at resume |
| Durable project memory | `session-log.md`, `known-issues.md`, `project-map.md` | context-management skill | skill-activator grep + `ctx_search` |
| Assistant memory | harness memory dir | harness | harness-managed |

- **Promotion:** context-mode wipes auto-capture after ~7-14 days; at each save point, promote
  decisions worth keeping into `session-log.md` `[saved]` entries.
- **Indexing:** after writing durable artifacts (plans, specs, `session-log.md`,
  `docs/ARCHITECTURE.md`), `ctx_index` them so future sessions search instead of re-reading.
- **Resume:** `ctx_search(sort:"timeline")` for the prior-session tail → read `state.md` →
  targeted `ctx_search` of durable artifacts, then touch code.

## ADR layer

A fifth layer, additive to the four above: `docs/adr/` holds architecture decision records for
designs that are irreversible or architectural. Written by `brainstorming` on design approval,
recalled by the context-management skill. Format is owned by
`skills/shared/conductor/doc-format.md`. Optional — no `docs/adr/` convention or a user decline
skips the write silently; never a blocker.

## Coexistence contract

Superpowers and context-mode run side by side without collision:

- **Yield rules:** `bash-compress-hook` yields when context-mode is active; context-mode owns
  Bash routing and WebFetch (WebFetch is hard-denied by context-mode).
- **`sp-*` namespace:** every plugin tmpfile uses the `sp-` prefix; stop locks are per-session
  (`<tmpdir>/sp/stop-<sessionId>.lock`), never a global lock.
- **No `PreCompact`:** no hook registers the PreCompact event (asserted by
  `tests/coexistence.test.js`); compaction memory is context-mode's job.
- **Evidence-in-transcript:** gate verification is asserted as
  `AC: <criterion> — PROVEN BY <evidence>`; the same token is read by gate hooks and skills.

## Harness surfaces

Each harness gets only what it can execute:

- **Claude Code** — full hook set + skills + `commands/` + `agents/` (`.claude-plugin/`).
- **Codex** — SessionStart (context-engine), UserPromptSubmit (skill-activator), PreToolUse
  (block-dangerous-commands), Stop (stop-reminders) + skills; manifest declares `hooks: {}` to
  avoid auto-discovery re-registration (`.codex-plugin/`).
- **Cursor** — SessionStart bootstrap hook only + skills (`.cursor-plugin/`, `hooks-cursor.json`).
- **Kimi Code** — skills-only manifest, no hooks (`.kimi-plugin/`).
- **OpenCode** — bootstrap injected by `.opencode/plugins/superpowers.js` + skills.
- **Pi** — `.pi/extensions/superpowers.ts` injects the bootstrap at start and post-compaction;
  Pi has native skills, so no Skill-tool shim.
- **Gemini / Antigravity** — `GEMINI.md` context file + a transformed profile synced into
  `.antigravity-plugin` by `scripts/sync-to-antigravity.sh`; skills + bootstrap, no live hooks.

## Testing map

One line each — which suite guards which subsystem:

- `tests/session-start-payload.test.js` — SessionStart payload ≤ 5,232 B, routing block absent.
- `tests/lint-skills.mjs` — skill `description` ≤ 300 B (FAIL), `SKILL.md` ≤ 12,288 B (WARN), ref depth.
- `tests/version-consistency.test.js` — version identical across all 7 manifests.
- `tests/compile.test.js`, `tests/compile-manifests.test.js` — manifest compile + byte-idempotence.
- `tests/coexistence.test.js` — `sp-` namespace, no PreCompact, per-session locks.
- `tests/safety-hooks.test.js` — dangerous-command and secret blocking.
- `tests/bash-compress-hook.test.js`, `tests/compression-rules.test.js` — compression + context-mode yield.
- `tests/context-engine.test.js`, `tests/ctx-detect.test.js` — context-mode detection.
- `tests/skill-activator.test.js` — skill hints, memory recall, injection cap, pressure gate.
- `tests/model-routing.test.js` — the three routing gates and session notice.
- `tests/gate-evidence-in-transcript.test.js` — evidence-token contract.
- `tests/subagent-guard.test.js` — SubagentStop validation.
- `tests/track-hooks.test.js` — track-edits / track-session-stats telemetry.
- `tests/antigravity-profile.test.js` — Antigravity overlay profile.
- `tests/code-review-fallback.test.js` — code-review agent fallback.
- `tests/skills-new-fetch-lint.test.js`, `tests/skills-new-frontmatter.test.js` — new-skill lint.
- `tests/claude-agents-sync.test.js` — `CLAUDE.md` and `AGENTS.md` are byte-identical.
