---
description: "Show token usage for this config root (cumulative across sessions sharing it): Claude-side totals (transcript-derived estimate) plus recent middleware per-request usage. Reads hooks-logs; writes nothing."
---

# Token Usage Report

Resolve the active config root: `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`. All three
sources live under it; each may be absent — report "no data yet" for a missing source and
continue with the rest. Read them in a single script or `ctx_execute` run rather than dumping
raw file contents into context.

1. **Config-root totals** — `hooks-logs/session-stats.json`, key `tokens`
   (`{input, output, cacheRead, cacheCreation}`). Cumulative for the current stats window,
   which resets when the stats file ages out. This file lives under the config root, not per
   session: concurrent sessions or projects sharing the same config root fold their deltas into
   the same totals. For a genuinely session-scoped number, filter
   `hooks-logs/claude-usage.jsonl` by `sessionId` instead and sum its records.
2. **Per-turn Claude usage** — `hooks-logs/claude-usage.jsonl`, last 10 records.
3. **Middleware per-request usage** — `hooks-logs/middleware-usage.jsonl`, last 10 records.
   `promptTokens`/`completionTokens` are exact for `http` endpoints; `cli` endpoints report
   `promptBytes`/`outputBytes` instead, because their plain-text output carries no token counts.

Render one compact table per source: totals first, then the two recent-request tables
(timestamp, task or turn, tokens or bytes). Show cache-read and cache-creation tokens as their
own columns — folding them into the input count overstates it.

Close with exactly this caveat:

> Claude-side numbers are a transcript-derived estimate, not billing data; totals reset with
> the session-stats window. Authoritative usage: claude.ai/settings/usage and your provider's
> dashboard.
