---
description: "Report session usage from the durable log, display conductor capabilities, and lead with collector health. Reads hooks-logs; writes nothing."
---

# Token Usage Report

Resolve the active config root: `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`. Every source
below lives under it and may be absent — report "no data yet" for a missing one and continue.
Read them in a single script or `ctx_execute` run rather than dumping raw files into context.

**First, check collection health.** Read `hooks-logs/usage-aggregator-health.json` and evaluate,
in order:

- **File absent** — the collector has never completed a run under this config root. Say so and
  treat every figure below as absent rather than zero.
- **`lastError` non-null** — collection failed on the most recent run. LEAD the report with that
  error and the fact that all numbers below are stale as of `lastRunAt`.
- **`lastRunAt` more than ~15 minutes old** while you are in an active session — the Stop hook is
  not running. LEAD with that; it is the failure mode that once went unnoticed for days.

Do NOT treat `offset` trailing `transcriptSize` as a fault on its own. Reads are chunked and
first-sight backfill is capped, so the collector is normally some way behind and catches up over
successive turns; a gap there is expected, not a stall.

1. **Session totals** — sum `hooks-logs/claude-usage.jsonl`, filtered to the `sessionId` of
   its most recent record (the command cannot read its own session id; the newest record is
   the current session in practice, though two sessions sharing a config root can interleave —
   say so if their ids differ within the last few records). Report input, output, cache-read
   and cache-creation as separate figures. Do NOT use `session-stats.json` for this: that file
   is config-root-wide and `loadStats` expires it after two hours, so its totals silently reset
   mid-session.
2. **Conductor usage** — per-capability rollup from the `conductor` key on those same records:
   calls and result bytes per capability (codegraph, serena, context7, obsidian, middleware),
   with an approximate token figure at roughly 4 bytes per token. Bytes are the real
   measurement; the token number is an estimate of context consumed, never billing data. If no
   capability appears, say plainly that no conductor tool was used this session.
3. **Middleware per-request usage** — `hooks-logs/middleware-usage.jsonl`, last 10 records.
   `promptTokens`/`completionTokens` are exact for `http` endpoints; `cli` endpoints report
   `promptBytes`/`outputBytes` instead, because their plain-text output carries no token counts.

If the health record has `truncatedBackfill: true`, state that this session's transcript was
already large when collection began and history before that point was never counted.

Render one compact table per section. Close with exactly this caveat:

> Claude-side numbers are a transcript-derived estimate, not billing data. Conductor byte
> counts measure context consumed by tool results, not tokens billed. Authoritative usage:
> claude.ai/settings/usage and your provider's dashboard.
