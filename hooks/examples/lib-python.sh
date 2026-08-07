#!/usr/bin/env bash
# Shared Python-interpreter resolver for hooks/examples/*.sh.
#
# `command -v python3` is not a reliable liveness check: on Windows, the
# `python3` name on PATH is frequently the Microsoft Store App Execution
# Alias stub at .../WindowsApps/python3. That file exists and is
# executable, so `command -v` reports success — but running it does not run
# Python. It prints an install-from-the-Store nag to stdout and exits
# non-zero instead. Every hook that did `python3 -c "$SCRIPT" ... || echo
# "{}"` treated that failure as "produced no output" rather than
# "interpreter missing", and the jq defaults downstream made every field
# look like a deliberate false/empty answer instead of "we never checked".
#
# Fix: probe each candidate by actually EXECUTING a trivial script
# (`-c pass`), not by asking the shell whether a file with that name exists
# somewhere on PATH. Only a candidate that runs and exits 0 counts.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib-python.sh"
#   if ! sp_resolve_python; then
#       trace "$SOME_ID" "skip" "no-python-interpreter"
#       exit 0   # (or: echo "$ALLOW"; exit 0 for PreToolUse hooks)
#   fi
#   RESULT=$("${SP_PYTHON[@]}" -c "$SCRIPT" ... 2>/dev/null || echo "{}")
#
# On success, sets the array SP_PYTHON (an array, not a string, because the
# `py -3` launcher is two words) and returns 0. On failure, unsets
# SP_PYTHON and returns 1 — callers MUST fail open, never block on a
# missing interpreter.
sp_resolve_python() {
    local c
    for c in python3 python; do
        if command -v "$c" >/dev/null 2>&1 && "$c" -c 'pass' >/dev/null 2>&1; then
            SP_PYTHON=("$c")
            return 0
        fi
    done
    if command -v py >/dev/null 2>&1 && py -3 -c 'pass' >/dev/null 2>&1; then
        SP_PYTHON=("py" "-3")
        return 0
    fi
    unset SP_PYTHON
    return 1
}
