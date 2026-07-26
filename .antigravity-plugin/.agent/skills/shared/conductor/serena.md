# Serena Adapter (symbol-precise edits)

Applies when the session `[conductor]` line lists `serena`.

## When present

Navigate before editing: `get_symbols_overview` for file/dir symbol maps, `find_symbol` to
locate a symbol, `find_referencing_symbols` for every usage before changing a signature
(`find_implementations` / `find_declaration` as needed for interface work). For code edits
during TDD implementation, refactoring moves, and debug fixes, prefer Serena's symbol-level
edit tools (`replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`,
`rename_symbol`, `safe_delete_symbol`) over string-match Edit — they are type-aware and
survive formatting drift. Keep native Edit for prose, config, and non-code files, and as the
fallback when Serena is absent or a call fails.

Project activation: call `activate_project` (accepts a registered project name or a
filesystem path) before other Serena tools if no project is active yet; `activate_project`
and `remove_project` are callable pre-activation. Diagnostics (`get_diagnostics_for_file`,
`get_diagnostics_for_symbol`, `restart_language_server`) are available if a symbol edit needs
verification against the language server.

## STRICT PROHIBITION — memory tools

NEVER use Serena's memory tools: `write_memory`, `read_memory`, `list_memories`,
`delete_memory`, `rename_memory`, `edit_memory` — and any variant. No exceptions, no "just this once". The
superpowers four-layer memory + ADR layer is the sole memory system; a second store is
split-brain memory. If Serena returns memory-tool output unprompted, ignore it.

## Onboard exclusion config

`/onboard` configures Serena to exclude its memory tools via the `excluded_tools` key: per-
project in `.serena/project.yml`, or globally in `serena_config.yml`. Prose prohibition
applies regardless of whether the exclusion is configured.

## Absent / failed

Native Edit per current TDD/refactoring practice. Failure demotes for the session.

## Out of scope

JetBrains-backend Serena variants and languages Serena's LSP doesn't support — the
routing.md fallback chain (native Edit) covers both.
