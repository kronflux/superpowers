# Middleware Adapter (mechanical task offload)

Applies when the session `[conductor]` line lists `middleware`.

## When present

Mechanical work — log/error digests, test-failure summaries, boilerplate generation — routes
to `middleware-exec` when configured. Invoke: `node scripts/middleware-exec.mjs --task <name>
[--input-file F] [--out F]` (reads stdin if `--input-file` is omitted). Built-in tasks:
`extract-log-error`, `summarize-test-failure`, `scaffold-tests`; a project or user
`templates{}` entry in `middleware-config.json` overrides or extends these. Never route
review or architecture judgment through it — see Dispatch matrix.

## Input handoff

Default: export the matched section to a scratch file (`ctx_execute` writes it), then pass
`--input-file <scratch>`. Lower-friction alternative when the `context-mode` binary is on
PATH: pipe `context-mode search <query> --project <path> --limit <n>` straight into
middleware-exec's stdin — same FTS5 store, no scratch-file hop, no coupling to context-mode's
internals either way. context-mode inactive: pipe the source file directly into stdin.

## Fallback policy

- Configured (`.claude/middleware-config.json` or `~/.claude/middleware-config.json` resolves
  an endpoint): always used for mechanical work.
- Unconfigured: recommend setup once per session — not once per call. Mechanical work then
  routes to the Claude mechanical-tier subagent via the existing `modelTier` routing.
- Context-heavy jobs falling back to Claude are opt-in only. Default stays the existing
  `ctx_search`/`ctx_execute` methodology; never force bulk content into Claude context as a
  substitute for middleware.

## Dispatch matrix

| Job | Route |
|---|---|
| Mechanical (log digests, test-failure summaries, boilerplate) | `middleware-exec` when configured → Claude mechanical tier → existing methodology |
| Symbol-precise refactors | primary agent + [serena.md](serena.md) adapter |
| Spec / quality-gate review | primary agent — NEVER middleware |

## Exit codes

`0` ok — result on stdout or written to `--out`. `1` usage error — missing/unknown `--task`.
`2` unconfigured — no config file found, `active_provider` undefined, or a remote endpoint's
API key env var is unset (localhost/127.0.0.1/::1 endpoints may omit the key). `3` endpoint
failure — non-2xx HTTP response. `2` and `3` both fall through to the next link in the
Fallback policy chain; never surfaced as a hard error to the user.
