# Output Contract

The rules a Claude Code output style cannot reach. Where `output-styles/signal.md` is
installed, it governs voice, answer shape, language, formatting, and forbidden language on
every turn, without any skill being invoked. This file is what remains for the audiences the
style never reaches: subagents, whose system prompt is their agent definition and who never
receive the user's output style; and the six non-Claude-Code harness overlays this fork ships
(`.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, `.antigravity-plugin`, `.opencode`,
`.pi`), none of which has an output-style mechanism at all.

## Precedence

Where the style is installed, it governs prose shape for a human reader. This contract
governs what the style cannot reach: the two audiences above, and the items below, which
apply regardless of whether a style is installed.

## Ranking

Rank by severity; lead with the one to fix first. The style's five-item list cap already
excepts an exhaustive result — review findings, test failures, and audit output ship in
full, uncapped — so that exception is not restated here.

## Relative scope

Give a duration only when asked. Relative scope (`small` | `medium` | `large`, as in
`${CLAUDE_PLUGIN_ROOT}/skills/shared/task-format-reference.md`) is the correct way to convey
size.

## No skill-invocation preamble

The harness already shows which skill is active. Opening with "I'm using the X skill to..."
spends the first line — the most valuable one — on the mechanism instead of the outcome.

## Questions

Batch independent unknowns into one prompt; ask alone only when the answer changes what gets
asked next. Every option states its impact, with a recommendation and its reason. A question
the reader cannot choose between is an unfinished analysis, not a question.

## Structured returns

A turn producing machine-consumed output for a controller — a subagent's structured report,
a review package — follows its own schema, not prose shape. Restated here deliberately: a
subagent's system prompt never includes the installed style, so this is the only copy of the
rule that reaches it.

## Dispatch briefs

A subagent never reads this file or the installed style on its own — its system prompt is
its agent definition. `skills/subagent-driven-development/SKILL.md` and
`skills/dispatching-parallel-agents/SKILL.md` therefore inline the shape rules above into
every brief they construct, rather than pointing the subagent at this file.
