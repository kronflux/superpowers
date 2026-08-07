# LSP Adapter (post-edit fast signal)

Applies when the session `[conductor]` line reports `lsp diagnostics active`.

## What this row is

A language server is attached, so a bad edit surfaces as a diagnostic inside the turn. LSP
exposes NO callable tools — there is nothing to invoke and nothing to route to. This adapter
changes one thing only: what you do *after* an edit.

## Hard rule

Diagnostics are a fast, NON-AUTHORITATIVE first signal.

- They MAY replace a speculative typecheck or build you invented to check your own edit.
- They MUST NEVER replace a verification gate named in a plan's acceptance criteria.
- They never override `superpowers:verification-before-completion`.
- **Diagnostic silence is not evidence.** A language server's coverage is narrower than a
  project's gate: cross-file inference, codegen, lint rules, and tests all live outside it.

Reporting work green because no diagnostic appeared is a verification failure, not a shortcut.

## Chain exception

`routing.md`'s taxonomy is otherwise first-available-wins. This row is NOT. LSP diagnostics and
the project's own gate are sequential and both apply.

## Install offer (once per session, decline per language)

When an edited file's language has an official LSP plugin and no installed server covers it,
`hooks/conductor-nudges.js` surfaces an offer — at most one LSP offer per session, for
whichever language triggers it first; a polyglot repo does not get one offer per language in
the same session. If the offer is deferred rather than declined, it recurs in later sessions
until acted on. Defer it to a natural break in the current task; never install uninvited. On
decline, append the plugin name on its own line to `.superpowers-no-lsp` in the project root —
per-language, so declining one does not silence the others. An empty marker file declines every
language.

## Absent

No language server: unchanged behaviour. Run the project's own typecheck/test command as
before.
