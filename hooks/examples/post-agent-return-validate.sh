#!/usr/bin/env bash
# PostToolUse hook on Agent: validate the subagent's return content against
# the currently in_progress task's evidence axes. Fires right after Agent
# tool_result arrives — before the coordinator absorbs and reports upward.
#
# If the in_progress task carries metadata `requireEvidenceTokens` (or the
# `requireABCompare: true` shortcut) and the subagent's report lacks tokens
# from one or more axes, this hook blocks with a stderr that names the
# missing axes. Forces the coordinator to re-dispatch on the spot rather
# than grind through "looks good" at task-close time.
#
# Opt in; SUPERPOWERS_AGENT_RETURN_GUARD=0 disables.

TRACE_LOG="${SUPERPOWERS_USERGATE_TRACE_LOG:-/tmp/claude-hooks/user-gate-trace.log}"
mkdir -p "$(dirname "$TRACE_LOG")" 2>/dev/null || true
trace() {
    local tid="${1:-?}" event="${2:-?}" reason="${3:-}"
    printf '%s | post-agent | task=%s | %s%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tid" "$event" \
        "${reason:+ | $reason}" >> "$TRACE_LOG" 2>/dev/null || true
}

if [[ "${SUPERPOWERS_AGENT_RETURN_GUARD:-1}" == "0" ]]; then
    trace "?" "skip" "guard=0"
    exit 0
fi

trap 'trace "?" "error" "trap-ERR"; exit 0' ERR

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
[[ "$TOOL_NAME" != "Agent" ]] && { trace "?" "skip" "tool=$TOOL_NAME"; exit 0; }

RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // .tool_result // empty' 2>/dev/null)
[[ -z "$RESPONSE" ]] && { trace "?" "skip" "no-response"; exit 0; }

TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
[[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]] && { trace "?" "skip" "no-transcript"; exit 0; }

PY_SCAN='
import json, re, sys
path = sys.argv[1]

tasks = {}
next_id = 1
current_inprogress = None

try:
    with open(path) as f:
        lines = f.readlines()
except Exception:
    print(json.dumps({}))
    sys.exit(0)

# Pass 1: collect every TaskCreate tool_use (its tool_use_id, subject,
# description, and a positional fallback id) plus the text of every
# tool_result keyed by tool_use_id. IDs are not reliably 1-based in a real
# session, so the authoritative id comes from the TaskCreate tool_result
# ("Task #<N> created successfully"); the positional counter is kept only
# as a fallback for a TaskCreate whose tool_result is missing.
create_calls = []       # ordered [{tool_use_id, subject, description, fallback_id}]
tool_result_by_id = {}  # tool_use_id -> text

for line in lines:
    try:
        e = json.loads(line)
    except Exception:
        continue
    etype = e.get("type")
    if etype == "user":
        msg = e.get("message") or {}
        content = msg.get("content")
        if isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    tuid = c.get("tool_use_id")
                    inner = c.get("content")
                    text = ""
                    if isinstance(inner, str):
                        text = inner
                    elif isinstance(inner, list):
                        text = "\n".join(
                            ic.get("text", "") or ""
                            for ic in inner
                            if isinstance(ic, dict) and ic.get("type") == "text"
                        )
                    if tuid and text.strip():
                        tool_result_by_id[tuid] = text
        continue
    if etype != "assistant":
        continue
    for c in (e.get("message") or {}).get("content") or []:
        if not isinstance(c, dict) or c.get("type") != "tool_use":
            continue
        if c.get("name") == "TaskCreate":
            inp = c.get("input") or {}
            create_calls.append({
                "tool_use_id": c.get("id"),
                "subject": inp.get("subject", "") or "",
                "description": inp.get("description", "") or "",
                "fallback_id": str(next_id),
            })
            next_id += 1
        elif c.get("name") == "TaskUpdate":
            tid = str((c.get("input") or {}).get("taskId", ""))
            try:
                if int(tid) >= next_id:
                    next_id = int(tid) + 1
            except (ValueError, TypeError):
                pass

id_re = re.compile(r"Task #(\d+) created successfully")
for call in create_calls:
    m2 = id_re.search(tool_result_by_id.get(call["tool_use_id"], ""))
    real_id = m2.group(1) if m2 else call["fallback_id"]
    tasks[real_id] = {"subject": call["subject"], "description": call["description"]}

# Pass 2: TaskUpdate overrides (description edits, in_progress tracking) in
# chronological order — current_inprogress depends on processing order.
for line in lines:
    try:
        e = json.loads(line)
    except Exception:
        continue
    if e.get("type") != "assistant":
        continue
    for c in (e.get("message") or {}).get("content") or []:
        if not isinstance(c, dict) or c.get("type") != "tool_use":
            continue
        if c.get("name") != "TaskUpdate":
            continue
        inp = c.get("input") or {}
        tid = str(inp.get("taskId", ""))
        if not tid:
            continue
        if tid not in tasks:
            tasks[tid] = {"subject": "", "description": ""}
        if inp.get("description"):
            tasks[tid]["description"] = inp["description"]
        status = inp.get("status")
        if status == "in_progress":
            current_inprogress = tid
        elif status in ("completed", "cancelled", "deleted") and current_inprogress == tid:
            current_inprogress = None

out = {"task_id": current_inprogress, "subject": "", "axes": []}

if current_inprogress and current_inprogress in tasks:
    t = tasks[current_inprogress]
    out["subject"] = t["subject"]
    m = re.search(r"```json:metadata\s*\n(.*?)\n```", t["description"], re.DOTALL)
    if m:
        try:
            meta = json.loads(m.group(1))
            raw = meta.get("requireEvidenceTokens")
            if isinstance(raw, list) and all(isinstance(a, list) for a in raw):
                out["axes"] = [a for a in raw if a]
            elif meta.get("requireABCompare") is True:
                out["axes"] = [
                    ["baseline", "old", "before", "v0", "v1", "iter-0", "iter0",
                     "original", "pre"],
                    ["new", "refactored", "after", "v2", "iter-1", "iter1",
                     "post", "updated", "replacement"],
                ]
        except Exception:
            pass

out["parsed"] = True
print(json.dumps(out))
'

# See lib-python.sh: `command -v python3` alone is not a liveness check —
# on Windows it is often the Store App Execution Alias stub, which exists
# on PATH but exits non-zero instead of running anything.
source "$(dirname "${BASH_SOURCE[0]}")/lib-python.sh"
if ! sp_resolve_python; then
    trace "?" "skip" "no-python-interpreter"
    exit 0
fi

RESULT=$("${SP_PYTHON[@]}" -c "$PY_SCAN" "$TRANSCRIPT_PATH" 2>/dev/null || echo "{}")

# Fail-open: an absent "parsed" sentinel means the parse never completed —
# that is "no information", not "checked, found nothing". Only a parse that
# actually ran gets to make a blocking decision below.
PARSED=$(echo "$RESULT" | jq -r '.parsed // false' 2>/dev/null)
if [[ "$PARSED" != "true" ]]; then
    trace "?" "skip" "parse-produced-no-result"
    exit 0
fi

TASK_ID=$(echo "$RESULT" | jq -r '.task_id // "?"' 2>/dev/null)
SUBJECT=$(echo "$RESULT" | jq -r '.subject // "?"' 2>/dev/null)
AXES_JSON=$(echo "$RESULT" | jq -c '.axes // []' 2>/dev/null)
AXES_COUNT=$(echo "$AXES_JSON" | jq -r 'length // 0' 2>/dev/null)

# No in_progress task with axes → nothing to enforce.
[[ "${AXES_COUNT:-0}" -le 0 ]] && { trace "$TASK_ID" "pass" "no-axes-for-inprogress"; exit 0; }

trace "$TASK_ID" "parsed" "axes=$AXES_COUNT subject='$SUBJECT'"

# Check the subagent return against each axis.
MISSING_JSON=$("${SP_PYTHON[@]}" -c '
import json, re, sys
response = sys.argv[1]
axes = json.loads(sys.argv[2])
missing = []
for i, tokens in enumerate(axes):
    if not tokens:
        continue
    pattern = r"\b(" + "|".join(re.escape(str(t)) for t in tokens if t) + r")\b"
    if not re.search(pattern, response, re.IGNORECASE):
        missing.append({"index": i, "tokens": tokens})
print(json.dumps(missing))
' "$RESPONSE" "$AXES_JSON" 2>/dev/null || echo "[]")

MISSING_COUNT=$(echo "$MISSING_JSON" | jq -r 'length // 0' 2>/dev/null)

if [[ "${MISSING_COUNT:-0}" -le 0 ]]; then
    trace "$TASK_ID" "pass" "subagent-return-covers-axes"
    exit 0
fi

trace "$TASK_ID" "block" "subagent-return-missing-axes count=$MISSING_COUNT"

{
    echo "SUBAGENT RETURN DOES NOT COVER DECLARED EVIDENCE AXES"
    echo
    echo "Task #$TASK_ID ('$SUBJECT') is in_progress and its metadata declares"
    echo "evidence axes the subagent's report was expected to cover. The"
    echo "returned content is missing a token from these axes:"
    echo
    echo "$MISSING_JSON" | jq -r '.[] | "  axis #\(.index): none of " + (.tokens | join(" | ")) + " appeared"' 2>/dev/null || true
    echo
    echo "This is not a task close — this is the subagent's report you were"
    echo "about to absorb. Either:"
    echo "  1. Re-dispatch the subagent with an explicit instruction to report"
    echo "     observations from every missing axis."
    echo "  2. If the subagent genuinely did not observe one side (e.g. the"
    echo "     baseline run failed and no output exists), dispatch a SECOND"
    echo "     subagent to specifically produce the missing observation."
    echo "  3. If the axis set is wrong for this task (bad plan metadata),"
    echo "     update requireEvidenceTokens via TaskUpdate before continuing —"
    echo "     transparently, not as a bypass."
    echo
    echo "Do NOT proceed to absorb this report and close the task on partial"
    echo "evidence. post-task-complete-revalidate will catch it at close time,"
    echo "but a re-dispatch now is cheaper than a reopen later."
    echo
    echo "(Runtime disable: SUPERPOWERS_AGENT_RETURN_GUARD=0. Trace: $TRACE_LOG)"
} >&2

exit 2
