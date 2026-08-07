# Superpowers (kronflux fork)

## What this is

A fork of [obra/superpowers](https://github.com/obra/superpowers) (Jesse Vincent / Prime
Radiant) — the skills-based development methodology for coding agents. Upstream is the base;
this fork re-adapts it to be **context-mode-native**: skills, hooks, and memory route data
work through the context-mode plugin's `ctx_*` tools when it is active, and fall back to
native tools otherwise.

Ships via the Claude Code marketplace **`superpowers-dev`** as plugin **`superpowers`**
(`/plugin marketplace add kronflux/superpowers`, `/plugin install superpowers@superpowers-dev`).
Version is authoritative in `package.json` (currently 7.3.0) and mirrored into six other
manifests by the bump script.

## Working in this repo

- `npm test` — skill lint (pretest) + full vitest suite; keep it green before every commit.
  Shell/harness integration suites (`tests/{codex,kimi,pi,opencode,antigravity,claude-code}/`) run separately.
- `npm run compile-hooks` after editing `plugin.universal.mjs`. **NEVER hand-edit
  `hooks/*.json`** — `hooks/hooks.json`, `hooks/codex-hooks.json`, and `hooks/hooks-cursor.json`
  are generated. Edit the manifest source, recompile, commit both.
- Skill edits follow `skills/writing-skills/` — frontmatter contract, eval discipline, no
  behavior-shaping rewrites without evidence.
- **Budgets (enforced):**
  - Skill `description` ≤ 300 B — `tests/lint-skills.mjs` **FAILs** above.
  - `SKILL.md` core ≤ 12,288 B — lint **WARNs** above (split overflow into `references/`).
  - SessionStart payload ≤ 5,232 B — `tests/session-start-payload.test.js` **FAILs** above.
    Any edit to `skills/using-superpowers/SKILL.md` (its body is the payload) MUST re-run that spec.
- Commit style: imperative subject, no attribution trailers (no `Co-Authored-By`, no
  `Generated-with`).

## Directory map

- `skills/` — 27 skills plus `shared/` (cross-skill contracts, incl. the context-mode adapter).
- `hooks/` — lifecycle + safety + routing hooks; `hooks/examples/` = opt-in task-gate hooks (off by default).
- `agents/` — `code-reviewer`, `red-team` subagent definitions.
- `commands/` — slash-command wrappers (`brainstorm`, `write-plan`, `execute-plan`, `onboard`, gate commands).
- `scripts/` — `compile-hooks.mjs`, `sync-to-codex-plugin.sh`, `sync-to-antigravity.sh`, `bump-version.sh`.
- `docs/` — harness/porting/testing docs plus `docs/superpowers/{plans,specs}` committed design history.
- `.superpowers/` — gitignored local scratch: active plans/specs/`.tasks.json` (session artifacts, never committed unless explicitly asked), sdd workspace, brainstorm-server state.
- `tests/` — vitest suites + shell/python integration checks.
- `plugin.universal.mjs` — single source for all hook manifests.
- Harness surfaces: `.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, `.antigravity-plugin`,
  `.opencode`, `.pi`, `GEMINI.md`.

## Load-bearing contracts

- **Conductor:** `skills/shared/conductor/routing.md` is the central tool-selection authority
  (CodeGraph, LSP, Context7, context-mode, middleware-exec); every integration is
  optional and capability-gated. `skills/shared/context-mode-adapter.md` remains the
  single source of truth for native-vs-`ctx_*` routing within that chain.
- **Evidence rule:** gate verification is asserted in-transcript as
  `AC: <criterion> — PROVEN BY <evidence>`. Non-negotiable; hooks and gate skills key on this token.
- **Hooks fail open:** every hook allows the action on any internal fault. Only deliberately
  registered gates (`hooks/examples/`) block.
- **`sp-*` tmpdir namespace:** all plugin tmpfiles use the `sp-` prefix (e.g. `sp-stop-<sessionId>`)
  to avoid colliding with context-mode. No hook uses `PreCompact`; WebFetch is owned by context-mode.
- **Decline markers:** `.superpowers-no-<capability>` files at the project root record a user's
  "no" for a capability offer and are gitignored — they are a local choice, never committed.
  `.superpowers-no-lsp` is newline-delimited plugin names; empty means decline all.
- **Four-layer memory** (auto-capture → `state.md` → durable git-committed artifacts → harness
  memory) is documented in `docs/ARCHITECTURE.md`.
- **Model-tier routing** is opt-in via `.superpowers/model-routing.json` (canonical) → legacy
  `docs/superpowers/model-routing.json` (still read, migration offered) →
  `$CLAUDE_CONFIG_DIR/superpowers/model-routing.json` → `~/.claude/superpowers/model-routing.json`
  (first match wins); see `/onboard`.

## Releases

- Bump every manifest with `scripts/bump-version.sh <version>` — it rewrites all 7 manifests
  (incl. `.kimi-plugin/plugin.json`). **Never hand-bump a version;** drift is caught by
  `tests/version-consistency.test.js`.
- Add a `RELEASE-NOTES.md` entry for the new version.
- Tag the release.

## Contributing upstream

PRs to obra/superpowers follow **their** contributor policy — their PR template, the `dev`
branch, and their agent-disclosure requirements. Fork-specific changes (context-mode
integration, routing, Antigravity overlay, fork identity) stay in this repo. Do **not** open
fork-sync PRs against upstream.
