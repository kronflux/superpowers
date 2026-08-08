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
- **`<tmpdir>/sp/` namespace:** every plugin tmpfile lives under one directory and is named
  only via `spTmp()` from `hooks/lib/sp-tmp.js` — never `os.tmpdir()` directly. That confinement
  is what lets `hooks/lib/tmp-reaper.js` reap by enumerating a directory we own instead of
  pattern-matching the shared temp root. Aged entries are swept at SessionStart (7 days, override
  `SUPERPOWERS_TMP_RETENTION_DAYS`, `0` disables); per-session ephemeral state is cleared at
  SessionEnd, except the usage offset, which must survive for `claude-usage.jsonl` to stay
  accurate. Enforced by `tests/tmp-namespace.test.js`, scoped to `hooks/` and `tests/` —
  `scripts/middleware-exec.mjs` creates its CLI-subprocess working directory directly under the
  bare temp root and is a deliberate, documented gap outside that scan. No hook uses
  `PreCompact`; WebFetch is owned by context-mode. The same reaper also sweeps
  `.superpowers/sdd/<plan>/` plan workspaces on that same retention window (also overridable via
  `SUPERPOWERS_TMP_RETENTION_DAYS`), with one exception: a workspace whose plan still has a
  `pending` or `in_progress` task in `<plan>.md.tasks.json` is never reaped, regardless of age.
  This is a deliberate deviation from upstream's `2026-07-06-sdd-plan-scoped-workspace` design
  (mirrored only in `../_reference/`, not this fork's `docs/superpowers/`), which specified
  deleting the workspace at finish: deletion at finish destroys reports and review packages at
  the moment they are most wanted, and three reporting defects on 2026-08-08 were caught only by
  re-reading reports after their tasks had already closed — evidence delete-at-finish would have
  erased.
- **Decline markers:** `.superpowers-no-<capability>` files at the project root record a user's
  "no" for a capability offer and are gitignored — they are a local choice, never committed.
  `.superpowers-no-lsp` is newline-delimited plugin names; empty means decline all.
- **Four-layer memory** (auto-capture → `state.md` → durable git-committed artifacts → harness
  memory) is documented in `docs/ARCHITECTURE.md`.
- **Model-tier routing** is opt-in via `.superpowers/model-routing.json` (canonical) → legacy
  `docs/superpowers/model-routing.json` (still read, migration offered) →
  `$CLAUDE_CONFIG_DIR/superpowers/model-routing.json` → `~/.claude/superpowers/model-routing.json`
  (first match wins); see `/onboard`.
- **Statusline:** `/superpowers:statusline` (`skills/statusline/SKILL.md`) is the only way to
  activate the conductor statusline — a plugin can ship `agent`/`subagentStatusLine` but not
  `statusLine` itself, so the interview writes the user's own `.claude/settings.json`. Two
  modes: default (conductor segments only, for a ccstatusline Custom Command widget) and
  `--full` (adds a model + context-% prefix, standalone). Config lives at
  `.superpowers/statusline.json`; the interview installs a version-stable launcher
  (`hooks/lib/statusline-install.js`) outside the versioned plugin directory so a plugin update
  never breaks the pointer in `.claude/settings.json`. **Fail-silent:** `scripts/statusline.mjs`
  never throws past its top-level handler — any internal fault prints an empty line and exits 0,
  since this renders on every assistant message and a visible failure would put a stack trace
  across the prompt line.
- **Comments:** state present-state behavior, inputs, outputs, and side effects only — version
  control already holds the development history, and narration belongs in the commit message.
  Two banned classes: development narration (`fixed X`, `added X`, `expanded X`, `adjusted X`,
  `improved X`, `tested X`, `X happened`, `adding X for X reason`, `a later review found`,
  `previously`, `used to`, `turned out`) and impermanence (`TODO`, `FIXME`, `WIP`, `temporary`,
  `for now`, `hack`, `still adjusting`, `so we can test`).
  ```
  BAD:  // Fixed crash on empty payload
  GOOD: // Returns null if the payload is empty

  BAD:  # Added retry logic to handle unstable network
  GOOD: # Executes network request with 3 exponential backoff retries

  BAD:  # Mocking the auth payload here so we can test the frontend locally
  GOOD: # Generates a static JWT payload for unauthenticated sessions
  ```
  Enforced two ways: `tests/lint-comments.mjs` scans this repo's own source, and a `PreToolUse`
  gate denies writes introducing a violation in any project — disabled per-project by
  `.superpowers-no-comment-gate`, matching the decline-marker convention above.
- **Commit messages** carry what changed; they do not carry how you got there. A comment says
  what the code does, a commit says what changed, neither says what you did to arrive at it.
  "History belongs in the commit message" does not mean anything goes there. Banned: internal
  counts (`23 patterns`, `11 categories`) which are stale within a week and describe the
  implementation rather than the change; planning-document structure (`all eleven taxonomy
  categories from the design spec`, `per the plan's task 3`) which the reader of `git log` in
  two years cannot resolve; process verbs about yourself (`derive`, `adopt`, `grows`,
  `iterate on`, `revisit`); and measurement as achievement (`with measured coverage`, `now
  fully tested`) — testing is how a change was made trustworthy, not part of the change.
  ```
  BAD:  feat: derive full 11-category comment pattern set with measured coverage
  GOOD: feat: detect temporal comparison, troubleshooting anecdote, and ticket references

  BAD:  Grows NARRATION to 23 patterns across all eleven taxonomy categories.
  GOOD: Comments naming a change and its cause are now detected. Bare sentence-initial
        verbs stay undetected: they cannot be distinguished from present-state usage.
  ```
  The good version still gives the limitation and the reason — as properties of the software,
  not as things you discovered. Reviewed, not gated: a commit-msg hook fires after the work is
  done and is trivially bypassed.

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
