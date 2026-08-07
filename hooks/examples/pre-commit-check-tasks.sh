#!/usr/bin/env bash
# PreToolUse hook: block git commit while a native task is in progress.
# Add this to your project's .claude/settings.json (see README).
#
# How it works:
# - Triggers on Bash tool calls containing "git commit"
# - Parses the session transcript for TaskCreate/TaskUpdate calls
# - Blocks only when a task has status "in_progress". Pending tasks pass
#   through so per-task commit flows (subagent-driven-development,
#   executing-plans) can commit one task at a time.

# Trace logging — shared with the other hooks/examples/*.sh scripts so a
# no-interpreter skip is visible in one place. Tail with:
#   tail -F /tmp/claude-hooks/user-gate-trace.log
TRACE_LOG="${SUPERPOWERS_USERGATE_TRACE_LOG:-/tmp/claude-hooks/user-gate-trace.log}"
mkdir -p "$(dirname "$TRACE_LOG")" 2>/dev/null || true
trace() {
    local event="${1:-?}" reason="${2:-}"
    printf '%s | pre-commit | %s%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$event" \
        "${reason:+ | $reason}" >> "$TRACE_LOG" 2>/dev/null || true
}

INPUT=$(cat)

ALLOW='{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[[ "$TOOL_NAME" != "Bash" ]] && echo "$ALLOW" && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
# Match `git commit` only when it is an actual command — at the start of the
# line or after a shell separator (`;`, `&&`, `||`, `|`, `(`) — so embedded
# strings like `gh issue create --body "... git commit ..."` do not trigger.
echo "$COMMAND" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+commit([[:space:]]|[;&|)]|$)' || { echo "$ALLOW"; exit 0; }

TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
[[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]] && echo "$ALLOW" && exit 0

# See lib-python.sh: `command -v python3` alone is not a liveness check —
# on Windows it is often the Store App Execution Alias stub, which exists
# on PATH but exits non-zero instead of running anything.
source "$(dirname "${BASH_SOURCE[0]}")/lib-python.sh"
if ! sp_resolve_python; then
    trace "skip" "no-python-interpreter"
    echo "$ALLOW"; exit 0
fi

RESULT=$("${SP_PYTHON[@]}" -c "
import json
tasks = {}
next_id = 1
for line in open('$TRANSCRIPT_PATH'):
    try: entry = json.loads(line)
    except: continue
    if entry.get('type') != 'assistant': continue
    for c in entry.get('message', {}).get('content', []):
        if c.get('type') != 'tool_use': continue
        name, inp = c.get('name', ''), c.get('input', {})
        if name == 'TaskCreate':
            tasks[str(next_id)] = 'open'
            next_id += 1
        elif name == 'TaskUpdate':
            tid = str(inp.get('taskId', ''))
            status = inp.get('status', '')
            if tid and status:
                tasks[tid] = status
                try:
                    if int(tid) >= next_id: next_id = int(tid) + 1
                except ValueError: pass
print(json.dumps({'parsed': True, 'open_tasks': sum(1 for s in tasks.values() if s == 'in_progress')}))
" 2>/dev/null || echo "{}")

# Fail-open: an absent "parsed" sentinel means the parse never completed —
# that is "no information", not "checked, found nothing". Only a parse that
# actually ran gets to block a commit below.
PARSED=$(echo "$RESULT" | jq -r '.parsed // false' 2>/dev/null)
if [[ "$PARSED" != "true" ]]; then
    trace "skip" "parse-produced-no-result"
    echo "$ALLOW"; exit 0
fi

OPEN_TASKS=$(echo "$RESULT" | jq -r '.open_tasks // 0' 2>/dev/null)

if [[ "$OPEN_TASKS" -gt 0 ]]; then
    trace "block" "open-tasks=$OPEN_TASKS"
    echo "COMMIT BLOCKED: $OPEN_TASKS native task(s) still in progress. Finish the current task before committing." >&2
    exit 2
fi

trace "pass" "open-tasks=0"
echo "$ALLOW"
exit 0
