# Superpowers (kronflux fork)

Superpowers is a complete software-development methodology for coding agents, built on a set of
composable skills plus the bootstrap instructions that make sure your agent uses them. The
concept, the skills library, and the workflow are the work of
[obra/superpowers](https://github.com/obra/superpowers) (Jesse Vincent / Prime Radiant).

This is a **fork**. It tracks upstream and re-adapts the methodology to be
**context-mode-native**: skills, hooks, and memory route their data work through the
context-mode plugin's `ctx_*` tools when it is active, and fall back to native tools otherwise.
It adds safety hooks, opt-in verification gates, model-tier routing, a four-layer memory
architecture, and a measured context-economy budget on top of the upstream base.

## How it works

It starts the moment you fire up your coding agent. As soon as it sees you're building
something, it *doesn't* jump into writing code — it steps back and asks what you're really
trying to do. Once it has teased a spec out of the conversation, it shows it to you in chunks
short enough to actually read. After you sign off, it writes an implementation plan clear
enough for an enthusiastic junior engineer to follow, emphasizing true red/green TDD, YAGNI,
and DRY. When you say "go", it launches a subagent-driven-development process — agents work
each task, review each other's work, and continue. The skills trigger automatically, so you
don't need to do anything special.

## Installation

### Claude Code (primary)

Register the fork's development marketplace, then install the plugin:

```bash
/plugin marketplace add kronflux/superpowers
/plugin install superpowers@superpowers-dev
```

The plugin's SessionStart hook loads the `using-superpowers` bootstrap, so skills are active
from the first message.

### Other harnesses

The fork ships harness overlays that install from this repository. Install Superpowers
separately for each harness you use.

- **Antigravity** — `agy plugin install https://github.com/kronflux/superpowers`
- **Kimi Code** — `/plugins install https://github.com/kronflux/superpowers` (details:
  [docs/README.kimi.md](docs/README.kimi.md))
- **OpenCode** — fetch and follow
  `https://raw.githubusercontent.com/kronflux/superpowers/refs/heads/main/.opencode/INSTALL.md`
  (details: [docs/README.opencode.md](docs/README.opencode.md))
- **Pi** — `pi install git:github.com/kronflux/superpowers`, or `pi -e /path/to/superpowers`
  for local development
- **Codex** — the Codex plugin tree is produced from this repo by
  `scripts/sync-to-codex-plugin.sh` (`.codex-plugin/` manifest)
- **Cursor** — `.cursor-plugin/` manifest; install from the fork repo
- **Gemini CLI / Antigravity** — `GEMINI.md` + `gemini-extension.json`

Porting details for every harness live in `docs/porting-to-a-new-harness.md`.

## What's inside

27 skills (plus `shared/` contracts). The agent checks for a relevant skill before any task —
these are mandatory workflows, not suggestions.

**Core workflow**

- **using-superpowers** — Use when starting any conversation
- **brainstorming** — You MUST use this before any creative work
- **deliberation** — Use BEFORE brainstorming for complex architecture/tech/design decisions with unclear options or framing
- **writing-plans** — Use when you have a spec or requirements for a multi-step task, before touching code
- **executing-plans** — Use when you have a written implementation plan to execute in a separate session with review checkpoints
- **subagent-driven-development** — Use when executing implementation plans with independent tasks in the current session
- **dispatching-parallel-agents** — Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
- **using-git-worktrees** — Use when starting feature work that needs isolation from current workspace or before executing implementation plans
- **finishing-a-development-branch** — Use when implementation is complete, all tests pass, and you need to decide how to integrate the work

**Engineering**

- **test-driven-development** — Use when implementing any feature or bugfix, before writing implementation code
- **systematic-debugging** — Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
- **verification-before-completion** — Use when about to claim work is complete, fixed, or passing, before committing or creating PRs
- **refactoring** — MUST USE when restructuring code without changing behavior
- **performance-investigation** — MUST USE for performance issues
- **dependency-management** — MUST USE when updating, migrating, or auditing dependencies
- **requesting-code-review** — Use when completing tasks, implementing major features, or before merging to verify work meets requirements
- **receiving-code-review** — Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable
- **frontend-design** — MUST USE for any frontend, UI, or web interface implementation
- **premise-check** — Validates whether work should exist before investing in it
- **writing-skills** — Use when creating new skills, editing existing skills, or verifying skills work before deployment
- **claude-md-creator** — Creates minimal, high-signal CLAUDE.md and AGENTS.md context files

**Gates**

- **checking-gates** — Use when picking up a user-gate task OR a hook demands re-validation
- **specifying-gates** — Use when a user-gate task has requiresUserSpecification=true OR the agent's "do I know HOW?" self-check returns no

**Memory & context**

- **context-management** — Persists durable state across sessions via state.md; generates project-map.md on request
- **token-efficiency** — Always-on operational standard
- **error-recovery** — Maintains project-specific known-issues.md mapping recurring errors to solutions; consulted by systematic-debugging before investigation
- **self-consistency-reasoner** — Internal technique for high-stakes multi-step inference, invoked by systematic-debugging and verification-before-completion

## Fork subsystems

Capabilities this fork adds on top of the upstream skills library:

- **Context-mode adapter + coexistence contract** — `skills/shared/context-mode-adapter.md` is
  the single source of truth for native-vs-`ctx_*` routing. All plugin tmpfiles use the `sp-`
  namespace, no hook uses `PreCompact`, and WebFetch is owned by context-mode, so the two
  plugins never collide.
- **Safety hooks** — `hooks/safety/` blocks dangerous commands and protects secrets on
  PreToolUse. Fail-open: any internal fault allows the action.
- **Output compression** — `hooks/bash-compress-hook.js` trims noisy Bash output, and **yields
  entirely when context-mode is active** (context-mode owns Bash routing in that mode).
- **Opt-in verification gates** — seven task-gate hooks under `hooks/examples/` enforce
  blockedBy ordering, dispatch matching, and evidence re-validation. All off by default; enable
  by registering them ([hooks/examples/README.md](hooks/examples/README.md)).
- **Model-tier routing** — `docs/superpowers/model-routing.json` (opt-in) maps plan tiers to
  models, enforced by three PreToolUse gates plus a session notice. Run `/onboard` to set it up.
- **Four-layer memory architecture** — auto-capture → `state.md` → durable git-committed
  artifacts → harness memory, with promotion/indexing/resume protocols. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Universal hook manifest** — `plugin.universal.mjs` is the single source compiled by
  `scripts/compile-hooks.mjs` into all three committed hook manifests (`hooks/*.json`).
- **Harness overlays** — Codex, Cursor, Kimi, OpenCode, Gemini/Antigravity, and Pi each get a
  tailored surface (`.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, `.opencode`, `GEMINI.md`,
  `.pi`), generated/synced from this repo.

## Context economy

The SessionStart payload and skill descriptions are always-on context cost — paid on every
session. The fork measures and budgets them. Numbers below measured 2026-07-11 on the
`resync/v7` branch:

- **SessionStart payload: 5,165 B (~1,290 tokens)**, spec-asserted ≤ 5,200 B by
  `tests/session-start-payload.test.js`. Old fork baseline: 14,639 B (~3,660 tokens).
- **All 27 skill descriptions: 5,441 B total, max 298 B**, lint-enforced ≤ 300 B each by
  `tests/lint-skills.mjs`. Old baseline: 10,686 B.
- **Always-on floor: ~2,650 tokens** (payload + descriptions), down from ~6,330 — a **~58%
  measured reduction**.

## Credits

- **Upstream base:** [obra/superpowers](https://github.com/obra/superpowers) by
  [Jesse Vincent](https://blog.fsck.com) and Prime Radiant. The methodology, the skills, and the
  workflow originate there. `.github/FUNDING.yml` and the brainstorming visual-companion brand
  link **intentionally continue to point at upstream** — sponsorship and telemetry flow to the
  original author, not the fork.
- **Ideas re-implemented from** [pcvelz/superpowers](https://github.com/pcvelz/superpowers) and
  [REPOZY/superpowers-optimized](https://github.com/REPOZY/superpowers-optimized).
- **Antigravity port patterns** adapted from the two community Antigravity superpowers repos.

## License

MIT License — see LICENSE file for details.
