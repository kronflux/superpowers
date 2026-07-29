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

## Transports

`transport` defaults to `"http"` (existing OpenAI-compatible request), so every existing
config is unaffected. `transport: "cli"` spawns a local CLI binary instead:

```json
{
  "transport": "cli",
  "preset": "agy",              // XOR with "command"
  "command": ["my-cli", "--prompt", "{{prompt}}"],
  "model": "gemini-3-pro",       // optional; cfg.active_model wins
  "input_mode": "argv",          // or "stdin"; overrides preset default
  "timeout_ms": 120000,          // default 120000
  "max_argv_bytes": 30000,       // default 30000, argv only
  "cwd": "C:/some/dir",          // default: temp dir, removed after run
  "env": { "VAR": "value" }      // merged OVER parent environment
}
```

`preset` xor `command`. Verified presets:

| preset | no model | with model `X` | default `input_mode` |
|---|---|---|---|
| `agy` | `["agy","-p","{{prompt}}"]` | `["agy","--model","X","-p","{{prompt}}"]` | `argv` |
| `opencode` | `["opencode","run"]` | `["opencode","run","-m","X"]` | `stdin` |
| `claude` | `["claude","-p"]` | `["claude","--model","X","-p"]` | `stdin` |

`input_mode` overrides the preset default: `argv` needs `{{prompt}}` in `command`; `stdin`
must not contain it.

**CLI providers are agentic.** `agy`, `opencode`, and `claude` are not text filters — they carry
file-edit and shell tools. A middleware call that means "summarize this log" invokes an agent
that may decide to act. Every CLI run therefore spawns in a fresh temporary directory, which is
removed when the run ends, so anything it writes lands in a throwaway location rather than your
project. Override `cwd` only when you understand that consequence.

**`claude` as its own middleware.** Configuring the `claude` preset means a Claude session
spawning Claude sessions. It works, and a second profile via `env.CLAUDE_CONFIG_DIR` keeps the
two separate — but the cost is Claude-tier per call, which is the opposite of what offloading
mechanical work is for. Prefer a cheaper provider unless you specifically want it.

**The prompt is not shielded from the target CLI's argument parser.** In `argv` mode the
rendered prompt is inserted as a plain argument, so a prompt beginning with `-` may be read as a
flag by the CLI you are calling. This is not shell injection — commands are spawned with no
shell, as an argument array, so nothing in a prompt can start a subprocess or chain a command.
But if you hand-author a `command` that places `{{prompt}}` as a bare positional, that CLI's own
parser decides what a leading dash means. The shipped presets avoid the worst of this: only
`agy` uses `argv`, and there the prompt is the value of `-p` rather than a bare positional.

**`agy` has a hard size ceiling.** Argv-only (stdin fails parsing), so oversized prompts return
exit 3. `opencode`/`claude` use stdin — no ceiling.

**`env` can override `PATH`.** Merge is `{...parentEnv, ...endpoint.env}`, so it can replace
`PATH` — deliberate (enables a second Claude Code profile via `CLAUDE_CONFIG_DIR`), and adds no
capability: editing `middleware-config.json` can already name any binary in `command`.

## Exit codes

`0` ok — result on stdout or written to `--out`. `1` usage error — missing/unknown `--task`.

`http`: `2` unconfigured — no config found, `active_provider` undefined, or API key env var
unset (localhost/127.0.0.1/::1 may omit it). `3` endpoint failure — non-2xx response.

`cli`:

| condition | exit |
|---|---|
| unknown preset; `preset`+`command` both/neither set; non-string `command` element; bad `input_mode`; `{{prompt}}` present under stdin/missing under argv | 2 |
| spawn ENOENT (binary not found) | 2 |
| rendered prompt over `max_argv_bytes` in argv mode | 3 |
| timeout | 3 |
| non-zero child exit (message carries the stderr tail) | 3 |

`2` and `3` both fall through to the next link in the Fallback policy chain; never surfaced as
a hard error to the user.
