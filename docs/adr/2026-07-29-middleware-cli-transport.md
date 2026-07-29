---
title: A CLI transport for middleware-exec
date: 2026-07-29
status: accepted
tags: [adr, middleware]
---

# A CLI transport for middleware-exec

## Context

`middleware-exec` offloads mechanical text work to a cheap model, but spoke only
OpenAI-compatible HTTP. Several capable local agents — Antigravity's `agy`, `opencode`,
`codex`, `gemini`, and Claude Code itself — expose no such endpoint; they are CLI binaries.
Excluding them ruled out the cheapest and most private options available on a developer
machine.

## Decision

A second transport. `transport` defaults to `"http"`, so every existing config is unaffected.
CLI endpoints declare either a verified `preset` or a free-form `command` argv array, are
spawned with `shell: false`, receive the prompt over stdin or an `{{prompt}}` argv placeholder,
and run in a fresh temporary directory that is removed afterwards. Presets ship only for
binaries whose invocation was verified against the real tool.

## Consequences

- Any CLI can be wired without a code change; presets stay a convenience, not a gate.
- Naming an executable in config is a code-execution surface. It introduces no new trust tier —
  `.claude/settings.json` already runs arbitrary hook commands — and is mitigated by argv-only
  spawning with no shell, not by an allowlist.
- CLI agents carry file and shell tools, so runs are isolated to a temp cwd by default.
- In argv mode the prompt reaches the target CLI's own argument parser unguarded; presets
  minimise the exposure but hand-authored commands should avoid bare positionals.
- `agy` is argv-only, so it cannot accept a prompt larger than `max_argv_bytes`; `opencode` and
  `claude` use stdin and have no such ceiling.
- `codex` and `gemini` get no presets until someone verifies their flags against the binaries.
